const { QueryTypes } = require('sequelize');

function createMediaCleanupService({ models, storage, enabled = false, intervalMs = 3600000, now = () => Date.now() }) {
  const db = models.MediaAsset.sequelize;
  let active, stopping = false, nextRun = 0;
  async function run() {
    let removed = 0;
    // Bounded work. No bucket-wide listing/deletion; only application-managed R2 rows.
    for (let count = 0; count < 25 && !stopping; count++) {
      const asset = await db.transaction(async transaction => {
        const [candidate] = await db.query(`SELECT a.id FROM media_assets a
          WHERE a.managed_upload AND a.storage_provider='r2' AND a.cleanup_after<=NOW()
            AND NOT EXISTS(SELECT 1 FROM events e WHERE e.image_asset_id=a.id)
          ORDER BY a.cleanup_after,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED`, { transaction, type: QueryTypes.SELECT });
        if (!candidate) return null;
        const row = await models.MediaAsset.findByPk(candidate.id, { transaction });
        // Recheck with a fresh READ COMMITTED snapshot after acquiring the asset lock.
        if (await models.Event.unscoped().count({ where: { imageAssetId: row.id }, transaction })) return null;
        await row.update({ status: 'deleting', cleanupAfter: new Date(now() + 300000) }, { transaction });
        return row;
      });
      if (!asset) break;
      try {
        await storage.forAsset(asset).remove(asset);
        await models.MediaAsset.destroy({ where: { id: asset.id, status: 'deleting' } });
        removed++;
      } catch {
        // Keep the tombstone for retries, including DELETE success + DB failure.
        await models.MediaAsset.update({ lastStorageError: 'CLEANUP_FAILED' }, { where: { id: asset.id, status: 'deleting' } });
      }
    }
    return removed;
  }
  function drain() {
    if (!enabled || stopping || active || now() < nextRun) return active || Promise.resolve(0);
    active = run().finally(() => { nextRun = now() + intervalMs; active = null; });
    return active;
  }
  async function stop() { stopping = true; if (active) await active; storage.close?.(); }
  return { enabled, drain, stop };
}
module.exports = { createMediaCleanupService };
