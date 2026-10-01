const { randomUUID,createHash } = require('node:crypto');
const { QueryTypes, Transaction } = require('sequelize');
const { DomainError, notFound, forbidden, conflict } = require('../domain/errors');
const { base } = require('./business-read-service');
const format = require('./report-export-format');

const SMALL_EXPORT_ROWS = 1000;
const BATCH_ROWS = 250;
const TTL_HOURS = 24;
function createReportExportService({ models, businessRead, reports, historicalReports = reports, smallLimit = SMALL_EXPORT_ROWS }) {
  const db = models.Event?.sequelize;
  const select = (sql, replacements = {}, transaction) => db.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  let active = null; let stopping = false;
  async function authorizationStamp(userId, transaction, audience = 'business') {
    if (!transaction) return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (snapshot) => {
      await select("SELECT set_config('jit','off',true)", {}, snapshot);
      return authorizationStamp(userId, snapshot, audience);
    });
    if (audience === 'admin') {
      const admin = await historicalReports.authorize(userId,transaction);
      // Global report access does not depend on the business membership graph.
      // Versioning invalidates an old export after role revocation/regrant,
      // without hashing every platform event on each download/status request.
      return createHash('sha256').update(JSON.stringify(['admin',userId,admin.internalAdminRole || 'platform_owner',admin.version ?? 0])).digest('hex');
    }
    const actor = await businessRead.actor(userId, { transaction });
    // Conservatively invalidate exports when effective access changes. Order,
    // payment and check-in activity deliberately do not change this stamp.
    const [result] = await select(`SELECT encode(digest(jsonb_build_array(:isAdmin,:reportRole,
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(e.id,e.lifecycle_state,e.status,e.organization_id,e.location_id)
        ORDER BY e.id),'[]') FROM events e WHERE ${base}),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(oo.id,oo.organization_id,oo.role,oo.lifecycle_state) ORDER BY oo.id),'[]') FROM organization_owners oo WHERE oo.user_id = :userId),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(oe.id,oe.organization_id,oe.status) ORDER BY oe.id),'[]') FROM organization_employees oe WHERE oe.user_id = :userId),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(oa.id,oa.organization_id,oa.status,oa.starts_at,oa.ends_at) ORDER BY oa.id),'[]') FROM org_affiliates oa WHERE oa.user_id = :userId),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(ea.id,ea.event_id,ea.status,ea.access_scope,ea.source_org_affiliate_id,ea.venue_access_id,ea.starts_at,ea.ends_at) ORDER BY ea.id),'[]') FROM event_affiliates ea WHERE ea.user_id = :userId),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(va.id,va.organization_id,va.location_id,va.role,va.status,va.version,ov.id) ORDER BY va.id),'[]')
        FROM venue_access va LEFT JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id WHERE va.user_id=:userId)
    )::text,'sha256'),'hex') AS stamp`, { ...actor, reportRole: 'business' }, transaction);
    return result.stamp;
  }
  function publicJob(job) {
    return { id: job.id, status: job.status, totalRows: Number(job.total_rows), processedRows: Number(job.processed_rows),
      progress: job.status === 'ready' ? 100 : job.snapshot_at && Number(job.total_rows) ? Math.floor(Number(job.processed_rows) / Number(job.total_rows) * 100) : 0,
      snapshotAt: job.snapshot_at, createdAt: job.created_at, expiresAt: job.expires_at,
      filename: job.metadata.filename || null, error: job.last_error,
      audience: job.input.audience || 'business',
      statusUrl: `/${job.input.audience === 'admin' ? 'admin' : 'business'}/reports/exports/${job.id}`, downloadUrl: `/${job.input.audience === 'admin' ? 'admin' : 'business'}/reports/exports/${job.id}/download` };
  }
  async function owned(userId, id, { verify = true, transaction } = {}) {
    const [job] = await select('SELECT * FROM report_export_jobs WHERE id=:id AND user_id=:userId AND expires_at>NOW()', { id, userId }, transaction);
    if (!job) throw notFound('Export');
    if (verify && job.auth_stamp !== await authorizationStamp(userId, transaction, job.input.audience)) throw forbidden('Your access changed. Create a new export using your current access.');
    return job;
  }
  async function list(userId, audience) {
    await businessRead.actor(userId);
    if (audience === 'admin') await historicalReports.authorize(userId);
    const rows = await select(`SELECT * FROM report_export_jobs WHERE user_id=:userId AND expires_at>NOW()
      ${audience ? "AND COALESCE(input->>'audience','business')=:audience" : ''} ORDER BY created_at DESC,id DESC LIMIT 20`, { userId, audience });
    return rows.map(publicJob);
  }
  async function status(userId, id) { return publicJob(await owned(userId, id)); }
  const snapshotOptions = { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ };
  async function admitExport(callback) {
    // SSI makes the pending-count predicate and inserted job one operation:
    // concurrent submissions cannot all observe and consume the last slot.
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, callback); }
      catch (error) {
        if ((error.original?.code || error.parent?.code) !== '40001') throw error;
        if (attempt === 3) throw new DomainError('Export requests are busy. Please retry.', { status: 429, code: 'EXPORT_BUSY' });
      }
    }
  }
  async function plans(userId, input, transaction) {
    const reportService = input.audience === 'admin' ? historicalReports : reports;
    const kinds = input.exportTable ? [input.exportTable] : input.audience === 'admin' ? ['businesses','events','offerings','purchases','team'] : ['events', 'offerings', 'team'];
    const prepared = [];
    let fixedInput = input;
    for (const kind of kinds) {
      const definition = await reportService.prepareTable(userId, kind, input.exportTable ? fixedInput : { ...fixedInput, sort: 'sales_desc' }, { transaction });
      prepared.push({ kind, ...definition });
      fixedInput = { ...input, startDate: definition.range.startDate, endDate: definition.range.endDate };
    }
    return prepared;
  }
  async function capture(job, transaction, prepared, status = 'rendering') {
    await select("SELECT set_config('jit','off',true)", {}, transaction);
    await select("SELECT set_config('statement_timeout','120000',true)", {}, transaction);
    if (job.auth_stamp !== await authorizationStamp(job.user_id, transaction, job.input.audience)) throw forbidden('Export access changed before the snapshot was captured.');
    const input = job.input;
    const definitions = prepared || await plans(job.user_id, input, transaction);
    const reportService = input.audience === 'admin' ? historicalReports : reports;
    const range = definitions[0].range;
    const fixedInput = { ...input, startDate: range.startDate, endDate: range.endDate };
    const summary = !input.exportTable || input.exportTable === 'team' ? await reportService.summary(job.user_id, fixedInput, { transaction }) : null;
    const metadata = { selected: input.exportTable || null, range, salesCents: summary?.summary.salesCents || 0,
      offering: Boolean(input.offeringId || input.offeringKind), audience: input.audience || 'business', financial: summary?.financial || null,
      filename: `nitewide-${input.audience === 'admin' ? 'admin' : 'business'}-${input.exportTable ? `${input.exportTable}-` : ''}${range.startDate}-${range.endDate}.csv` };
    let offset = 0;
    for (const definition of definitions) {
      const [count] = await select(`WITH inserted AS (INSERT INTO report_export_rows(job_id,sequence,section,payload)
        SELECT :id, :offset + ROW_NUMBER() OVER (ORDER BY ${definition.sort}), :kind, to_jsonb(r)
        FROM (${definition.sql}) r RETURNING sequence) SELECT COUNT(*)::bigint AS total FROM inserted`,
      { ...definition.values, id: job.id, kind: definition.kind, offset }, transaction);
      offset += Number(count.total);
    }
    if (summary && !input.exportTable) {
      await select(`INSERT INTO report_export_rows(job_id,sequence,section,payload)
        SELECT :id, :offset + ordinality,'daily',value FROM jsonb_array_elements(CAST(:daily AS jsonb)) WITH ORDINALITY`,
      { id: job.id, offset, daily: JSON.stringify(summary.daily) }, transaction);
      offset += summary.daily.length;
    }
    const [updated] = await select(`UPDATE report_export_jobs SET metadata=CAST(:metadata AS jsonb),total_rows=:total,
      snapshot_at=transaction_timestamp(),status=:status,updated_at=NOW() WHERE id=:id RETURNING *`,
    { id: job.id, metadata: JSON.stringify(metadata), total: offset, status }, transaction);
    return updated;
  }
  async function rowsAfter(id, sequence) {
    return select('SELECT sequence,section,payload FROM report_export_rows WHERE job_id=:id AND sequence>:sequence ORDER BY sequence LIMIT :batch', { id, sequence, batch: BATCH_ROWS });
  }
  function csvHeaders(response, metadata) {
    response.set('Content-Type', 'text/csv; charset=utf-8');
    response.set('Content-Disposition', `attachment; filename="${metadata.filename}"`);
    response.set('Cache-Control', 'no-store');
  }
  async function write(response, content) {
    if (response.destroyed) return false;
    if (!response.write(content)) await new Promise((resolve) => {
      const finish = () => { response.off('drain', finish); response.off('close', finish); resolve(); };
      response.once('drain', finish); response.once('close', finish);
    });
    return !response.destroyed;
  }
  async function request(userId, input, response) {
    let immediate = false;
    const job = await admitExport(async (transaction) => {
      await select("SELECT set_config('jit','off',true)", {}, transaction);
      await select("SELECT set_config('statement_timeout','30000',true)", {}, transaction);
      const authStamp = await authorizationStamp(userId, transaction, input.audience);
      const prepared = await plans(userId, input, transaction);
      let count = 0;
      for (const plan of prepared) {
        const [value] = await select(plan.countSql, plan.values, transaction);
        count += Number(value.total);
      }
      if (!input.exportTable) count += Math.round((Date.parse(prepared[0].range.endDate) - Date.parse(prepared[0].range.startDate)) / 86400000) + 1;
      immediate = count <= smallLimit;
      const [pending] = await select("SELECT COUNT(*)::integer AS total FROM report_export_jobs WHERE user_id=:userId AND status IN ('queued','snapshotting','rendering') AND expires_at>NOW()", { userId }, transaction);
      if (!immediate && pending.total >= 3) throw new DomainError('You already have three exports preparing. Wait for one to finish.', { status: 429, code: 'EXPORT_LIMIT' });
      const [created] = await select(`INSERT INTO report_export_jobs(id,user_id,input,auth_stamp,status,total_rows,
        created_at,updated_at,expires_at,lease_until) VALUES (:id,:userId,CAST(:input AS jsonb),:authStamp,:status,:count,
        NOW(),NOW(),NOW()+INTERVAL '${TTL_HOURS} hours',NOW()+INTERVAL '5 minutes') RETURNING *`,
      { id: randomUUID(), userId, input: JSON.stringify({ ...input, startDate: prepared[0].range.startDate, endDate: prepared[0].range.endDate }), authStamp, status: immediate ? 'snapshotting' : 'queued', count }, transaction);
      // Immediate streams cannot be claimed by a worker even if the client is slow.
      return immediate ? capture(created, transaction, prepared, 'streaming') : created;
    });
    if (!immediate) { response.status(202).json({ data: publicJob(job) }); return; }
    // Slow clients never keep a PostgreSQL snapshot transaction open.
    try {
      await owned(userId, job.id);
      csvHeaders(response, job.metadata);
      if (!(await write(response, format.header(job.metadata)))) return;
      let sequence = 0;
      while (!response.destroyed) {
        const rows = await rowsAfter(job.id, sequence);
        if (!rows.length) break;
        for (const row of rows) if (!(await write(response, format.line(row.section, row.payload, job.metadata)))) return;
        sequence = Number(rows.at(-1).sequence);
      }
      response.end();
    } catch (error) { if (response.headersSent) response.destroy(error); else throw error; }
    finally { await select('DELETE FROM report_export_jobs WHERE id=:id', { id: job.id }); }
  }
  async function processJob(job) {
    if (!job.snapshot_at) job = await db.transaction(snapshotOptions, async (transaction) => {
      const [locked] = await select('SELECT * FROM report_export_jobs WHERE id=:id AND lease_token=:token FOR UPDATE', { id: job.id, token: job.lease_token }, transaction);
      if (!locked) throw conflict('Export lease lost');
      return capture(locked, transaction);
    });
    while (!stopping) {
      const rows = await rowsAfter(job.id, Number(job.processed_rows));
      const done = rows.length === 0;
      const content = rows.map((row) => format.line(row.section, row.payload, job.metadata)).join('');
      job = await db.transaction(async (transaction) => {
        const [locked] = await select('SELECT * FROM report_export_jobs WHERE id=:id AND lease_token=:token FOR UPDATE', { id: job.id, token: job.lease_token }, transaction);
        if (!locked) throw conflict('Export lease lost');
        if (Number(locked.processed_rows) === 0) await select(`INSERT INTO report_export_chunks(job_id,sequence,content)
          VALUES (:id,0,:header) ON CONFLICT DO NOTHING`, { id: job.id, header: format.header(job.metadata) }, transaction);
        if (!done) await select(`INSERT INTO report_export_chunks(job_id,sequence,content) VALUES (:id,:sequence,:content)
          ON CONFLICT DO NOTHING`, { id: job.id, sequence: Number(rows.at(-1).sequence), content }, transaction);
        const [updated] = await select(`UPDATE report_export_jobs SET processed_rows=:processed,status=:status,
          lease_until=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=:id RETURNING *`,
        { id: job.id, processed: done ? Number(job.processed_rows) : Number(rows.at(-1).sequence), status: done ? 'ready' : 'rendering' }, transaction);
        if (done) await select('DELETE FROM report_export_rows WHERE job_id=:id', { id: job.id }, transaction);
        return updated;
      });
      if (done) break;
    }
    if (stopping) await select('UPDATE report_export_jobs SET lease_until=NOW() WHERE id=:id AND lease_token=:token AND status=\'rendering\'', { id: job.id, token: job.lease_token });
  }
  async function runNext() {
    if (stopping) return false;
    await select("DELETE FROM report_export_jobs WHERE expires_at<=NOW() AND NOT (status='ready' AND lease_until>NOW())");
    const [job] = await select(`UPDATE report_export_jobs SET lease_token=:token,lease_until=NOW()+INTERVAL '5 minutes',
      status=CASE WHEN snapshot_at IS NULL THEN 'snapshotting' ELSE 'rendering' END,updated_at=NOW()
      WHERE id=(SELECT id FROM report_export_jobs WHERE expires_at>NOW() AND
        (status='queued' OR (status IN ('snapshotting','rendering') AND lease_until<NOW()))
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, { token: randomUUID() });
    if (!job) return false;
    try { await processJob(job); }
    catch (error) {
      await select(`UPDATE report_export_jobs SET status='failed',last_error=:error,updated_at=NOW()
        WHERE id=:id AND lease_token=:token`, { id: job.id, token: job.lease_token,
        error: error.status === 403 ? 'Access changed; create a new export.' : 'Export failed; please retry.' });
      throw error;
    }
    return true;
  }
  function drain() {
    if (active) return active;
    active = runNext().finally(() => { active = null; });
    return active;
  }
  async function stop() { stopping = true; if (active) await active.catch(() => {}); }
  async function retry(userId, id) {
    return admitExport(async (transaction) => {
      const job = await owned(userId, id, { transaction });
      if (job.status !== 'failed') throw conflict('Only failed exports can be retried');
      const [pending] = await select("SELECT COUNT(*)::integer AS total FROM report_export_jobs WHERE user_id=:userId AND status IN ('queued','snapshotting','rendering') AND expires_at>NOW()", { userId }, transaction);
      if (pending.total >= 3) throw new DomainError('You already have three exports preparing. Wait for one to finish.', { status: 429, code: 'EXPORT_LIMIT' });
      const [updated] = await select(`UPDATE report_export_jobs SET status='queued',lease_token=NULL,lease_until=NULL,
        last_error=NULL,updated_at=NOW() WHERE id=:id AND status='failed' RETURNING *`, { id }, transaction);
      if (!updated) throw conflict('Export is already being retried');
      return publicJob(updated);
    });
  }
  async function download(userId, id, response) {
    const job = await admitExport(async (transaction) => {
      const checked = await owned(userId, id, { transaction });
      if (checked.status !== 'ready') throw new DomainError('The export is not ready yet', { status: 409, code: 'EXPORT_NOT_READY' });
      const [pinned] = await select(`UPDATE report_export_jobs SET lease_until=GREATEST(lease_until,NOW()+INTERVAL '31 minutes')
        WHERE id=:id AND expires_at>NOW() RETURNING *`, { id }, transaction);
      if (!pinned) throw notFound('Export');
      return pinned;
    });
    // A download may cross its expiry. Pin its chunks for this bounded stream;
    // slow clients do not hold a database transaction open or lose later chunks.
    const deadline = setTimeout(() => response.destroy(new Error('Export download timed out')), 30 * 60 * 1000);
    deadline.unref();
    csvHeaders(response, job.metadata);
    let sequence = -1;
    try {
      while (!response.destroyed) {
        const chunks = await select('SELECT sequence,content FROM report_export_chunks WHERE job_id=:id AND sequence>:sequence ORDER BY sequence LIMIT 4', { id, sequence });
        if (!chunks.length) break;
        for (const chunk of chunks) if (!(await write(response, chunk.content))) return;
        sequence = Number(chunks.at(-1).sequence);
      }
      if (!response.destroyed && sequence !== Number(job.processed_rows)) throw new Error('Export download is incomplete');
      response.end();
    } catch (error) { if (response.headersSent) response.destroy(error); else throw error; }
    finally { clearTimeout(deadline); }
  }
  return { request, list, status, retry, download, drain, stop, authorizationStamp, publicJob, processJob };
}
module.exports = { createReportExportService, SMALL_EXPORT_ROWS, BATCH_ROWS, TTL_HOURS };
