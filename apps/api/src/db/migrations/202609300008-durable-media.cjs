'use strict';
module.exports = {
  async up(q, S) {
    await q.sequelize.transaction(async transaction => {
      const columns = {
        storage_provider: { type: S.STRING(16), allowNull: false, defaultValue: 'local' },
        storage_bucket: { type: S.STRING(63), allowNull: true },
        status: { type: S.STRING(16), allowNull: false, defaultValue: 'ready' },
        managed_upload: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
        sha256: { type: S.STRING(64), allowNull: true },
        cleanup_after: { type: S.DATE, allowNull: false, defaultValue: S.literal("NOW() + INTERVAL '24 hours'") },
        last_storage_error: { type: S.STRING(120), allowNull: true },
      };
      for (const [name, definition] of Object.entries(columns)) await q.addColumn('media_assets', name, definition, { transaction });
      await q.addIndex('media_assets', ['cleanup_after', 'id'], { name: 'media_cleanup_candidates', where: { managed_upload: true, storage_provider: 'r2' }, transaction });
      await q.sequelize.query(`ALTER TABLE media_assets ADD CONSTRAINT media_status CHECK(status IN ('pending','ready','deleting'));
        ALTER TABLE media_assets ADD CONSTRAINT media_provider CHECK(storage_provider IN ('local','r2'));
        ALTER TABLE media_assets ADD CONSTRAINT media_r2_location CHECK(storage_provider <> 'r2' OR (storage_bucket IS NOT NULL AND sha256 IS NOT NULL));
        CREATE FUNCTION guard_event_media() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE old_id uuid; new_id uuid; asset_status text;
        BEGIN
          IF TG_OP <> 'INSERT' THEN old_id := OLD.image_asset_id; END IF;
          IF TG_OP <> 'DELETE' THEN new_id := NEW.image_asset_id; END IF;
          IF TG_OP = 'UPDATE' AND old_id IS NOT DISTINCT FROM new_id THEN RETURN NEW; END IF;
          -- All event writers and cleanup serialize on these rows, in UUID order.
          PERFORM id FROM media_assets WHERE id IN (old_id,new_id) ORDER BY id FOR UPDATE;
          IF new_id IS NOT NULL THEN
            SELECT status INTO asset_status FROM media_assets WHERE id = new_id;
            IF asset_status IS DISTINCT FROM 'ready' THEN
              RAISE EXCEPTION 'Image upload is not ready' USING ERRCODE='23514', CONSTRAINT='event_media_ready';
            END IF;
          END IF;
          UPDATE media_assets SET cleanup_after=NOW()+INTERVAL '24 hours'
            WHERE id IN (old_id,new_id) AND managed_upload AND status='ready';
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER event_media_guard BEFORE INSERT OR UPDATE OF image_asset_id OR DELETE ON events
          FOR EACH ROW EXECUTE FUNCTION guard_event_media();`, { transaction });
    });
  },
  async down(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query('DROP TRIGGER event_media_guard ON events; DROP FUNCTION guard_event_media(); ALTER TABLE media_assets DROP CONSTRAINT media_status, DROP CONSTRAINT media_provider, DROP CONSTRAINT media_r2_location;', { transaction });
      await q.removeIndex('media_assets', 'media_cleanup_candidates', { transaction });
      for (const name of ['storage_provider','storage_bucket','status','managed_upload','sha256','cleanup_after','last_storage_error']) await q.removeColumn('media_assets', name, { transaction });
    });
  },
};
