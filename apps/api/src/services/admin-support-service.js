const { Op,QueryTypes,Transaction } = require('sequelize');
const { z } = require('zod');
const { mutationTransaction } = require('./mutation-transaction');
const { findAndCountSequential } = require('./transaction-reads');
const { activeUser } = require('./lifecycle-service');
const { pageResult } = require('./business-read-service');
const { conflict,notFound } = require('../domain/errors');
const schemas = require('../http/admin-support-schemas');

const categoryRank = category => ['admission','paid_booking'].includes(category) ? 0 : ['account_access','security'].includes(category) ? 1 : ['guestlist','referral','reporting'].includes(category) ? 2 : 3;
const defaultPriority = category => categoryRank(category) === 0 ? 'high' : 'normal';
const rankSql = alias => `(CASE WHEN ${alias}.category IN ('admission','paid_booking') THEN 0 WHEN ${alias}.category IN ('account_access','security') THEN 10
  WHEN ${alias}.category IN ('guestlist','referral','reporting') THEN 20 ELSE 30 END + CASE ${alias}.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END)`;
const plain = record => record.toJSON ? record.toJSON() : record;
function createAdminSupportService({ models,permissions,notifications,now = () => new Date() }) {
  const db = models.User?.sequelize || models.Event?.sequelize;
  const select = (sql,replacements = {},transaction) => db.query(sql,{ replacements,transaction,type: QueryTypes.SELECT });
  const authorize = (actor,permission,transaction) => permissions.assertInternalPermission(actor,permission,transaction);
  async function read(actor,callback) {
    await authorize(actor,'support.view');
    return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },async transaction => {
      await authorize(actor,'support.view',transaction); return callback(transaction);
    });
  }
  async function list(actor,query) {
    const input = schemas.caseQuery.parse(query);
    return read(actor,async transaction => {
      const clauses = [];
      const values = { search: `%${input.search.replace(/[\\%_]/g,'\\$&')}%`,limit: input.pageSize,offset: (input.page-1)*input.pageSize };
      if (input.search) clauses.push("(c.title ILIKE :search ESCAPE '\\' OR c.description ILIKE :search ESCAPE '\\')");
      if (input.statuses.length) { clauses.push('c.status IN (:statuses)'); values.statuses = [...new Set(input.statuses)]; }
      else if (input.status !== 'all') { clauses.push('c.status=:status'); values.status = input.status; }
      if (input.category !== 'all') { clauses.push('c.category=:category'); values.category = input.category; }
      for (const [key,column] of Object.entries({ organizationId: 'organization_id',customerUserId: 'customer_user_id',assignedAdminUserId: 'assigned_admin_user_id' })) {
        if (input[key]) { clauses.push(`c.${column}=:${key}`); values[key] = input[key]; }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [count] = await select(`SELECT COUNT(*)::integer AS total FROM support_cases c ${where}`,values,transaction);
      const ids = await select(`SELECT c.id FROM support_cases c ${where} ORDER BY ${rankSql('c')},c.created_at,c.id LIMIT :limit OFFSET :offset`,values,transaction);
      const rows = ids.length ? await models.SupportCase.findAll({ where: { id: { [Op.in]: ids.map(row => row.id) } },transaction }) : [];
      const byId = new Map(rows.map(row => [row.id,plain(row)]));
      return pageResult(ids.map(row => byId.get(row.id)),count.total,input.page,input.pageSize);
    });
  }
  async function detail(actor,id) {
    return read(actor,async transaction => {
      const row = await models.SupportCase.findByPk(z.uuid().parse(id),{ transaction });
      if (!row) throw notFound('Support case');
      const history = await findAndCountSequential(models.AuditLog, { where: { entityType: 'SupportCase',entityId: id },order: [['createdAt','DESC'],['id','DESC']],limit: 50,transaction });
      const [conversation] = await select('SELECT id FROM support_conversations WHERE case_id=:id',{ id },transaction);
      return { case: plain(row),supportThreadId: conversation?.id || null,history: history.rows.map(plain),historyMeta: { total: history.count,page: 1,pageSize: 50,hasMore: history.count>50 } };
    });
  }
  async function history(actor,id,query = {}) {
    const input = schemas.historyQuery.parse(query);
    return read(actor,async transaction => {
      if (!await models.SupportCase.findByPk(z.uuid().parse(id),{ attributes: ['id'],transaction })) throw notFound('Support case');
      const result = await findAndCountSequential(models.AuditLog, { where: { entityType: 'SupportCase',entityId: id },order: [['createdAt','DESC'],['id','DESC']],
        limit: input.pageSize,offset: (input.page-1)*input.pageSize,transaction });
      return pageResult(result.rows.map(plain),result.count,input.page,input.pageSize);
    });
  }
  async function references(data,transaction) {
    const lock = transaction.LOCK.SHARE;
    const get = async (model,id,label) => { const row = await model.findByPk(id,{ transaction,lock }); if (!row) throw notFound(label); return row; };
    const result = { ...data };
    if (result.orderId) {
      const order = await get(models.Order,result.orderId,'Purchase');
      if (result.eventId && result.eventId !== order.eventId) throw conflict('The purchase does not belong to this event','SUPPORT_SCOPE_MISMATCH');
      if (result.customerUserId && result.customerUserId !== order.buyerUserId) throw conflict('The purchase does not belong to this customer','SUPPORT_SCOPE_MISMATCH');
      result.eventId = order.eventId; result.customerUserId = order.buyerUserId;
    }
    if (result.eventId) {
      const event = await get(models.Event,result.eventId,'Event');
      if (result.organizationId && result.organizationId !== event.organizationId) throw conflict('The event does not belong to this business','SUPPORT_SCOPE_MISMATCH');
      result.organizationId = event.organizationId;
    }
    if (result.organizationId) await get(models.Organization,result.organizationId,'Business');
    if (result.customerUserId) await get(models.User,result.customerUserId,'Customer');
    if (result.assignedAdminUserId) {
      const assignee = await get(models.User,result.assignedAdminUserId,'Assigned administrator');
      if (!activeUser(assignee) || !assignee.isInternalAdmin) throw conflict('Assign an active internal administrator','SUPPORT_ASSIGNEE_UNAVAILABLE');
      await authorize(result.assignedAdminUserId,'support.manage',transaction);
    }
    return result;
  }
  async function audit(actor,row,action,before,reason,transaction) {
    await models.AuditLog.create({ actorUserId: actor,organizationId: row.organizationId,entityType: 'SupportCase',entityId: row.id,
      action: `admin.support.${action}`,before,after: { ...plain(row),adminReason: reason } },{ transaction });
  }
  async function create(actor,body) {
    await authorize(actor,'support.manage');
    const { reason,...input } = schemas.createCase.parse(body);
    return mutationTransaction(db,async transaction => {
      await authorize(actor,'support.manage',transaction);
      const data = await references(input,transaction);
      const row = await models.SupportCase.create({ ...data,status: 'open',priority: data.priority || defaultPriority(data.category),
        createdByAdminUserId: actor,updatedByAdminUserId: actor },{ transaction });
      await audit(actor,row,'created',null,reason,transaction); return plain(row);
    });
  }
  async function update(actor,id,body) {
    await authorize(actor,'support.manage');
    const { reason,version,...changes } = schemas.updateCase.parse(body);
    return mutationTransaction(db,async transaction => {
      await authorize(actor,'support.manage',transaction);
      const row = await models.SupportCase.findByPk(z.uuid().parse(id),{ transaction,lock: transaction.LOCK.UPDATE });
      if (!row) throw notFound('Support case');
      if (row.version !== version) throw conflict('The case changed. Refresh it before editing.','STALE_VERSION');
      if (row.status === 'closed') throw conflict('Closed cases are retained. Create a related case for further work.','SUPPORT_CASE_CLOSED');
      const allowed = { open: ['open','in_progress','resolved'],in_progress: ['open','in_progress','resolved'],resolved: ['open','in_progress','resolved','closed'] };
      if (changes.status && !allowed[row.status].includes(changes.status)) throw conflict('Resolve this case before closing it.','SUPPORT_STATUS_TRANSITION');
      const data = await references({ ...plain(row),...changes },transaction);
      if (['resolved','closed'].includes(data.status) && (!data.resolution || data.resolution.trim().length < 3)) throw conflict('Record the resolution before resolving or closing the case.','SUPPORT_RESOLUTION_REQUIRED');
      const before = plain(row);
      if (!Object.keys(changes).some(key => JSON.stringify(before[key]) !== JSON.stringify(data[key]))) throw conflict('Choose a change before saving the case.','SUPPORT_NO_CHANGE');
      // The model's version increment and the row lock make duplicate/replayed edits fail.
      await row.update({ ...changes,organizationId: data.organizationId,customerUserId: data.customerUserId,eventId: data.eventId,
        updatedByAdminUserId: actor },{ transaction });
      await audit(actor,row,'updated',before,reason,transaction);
      if (before.status!==row.status) {
        const [conversation] = await select('SELECT id,requester_user_id FROM support_conversations WHERE case_id=:id',{ id },transaction);
        if (conversation?.requester_user_id) await notifications?.emit({ userId: conversation.requester_user_id,kind: 'support_status',title: 'Support case updated',
          message: 'Your support case status changed. Open Messages to view it.',metadata: { threadId: conversation.id } },transaction);
      }
      return plain(row);
    });
  }
  async function needsAttention(actor,query = {}) {
    const input = schemas.attentionQuery.parse(query);
    return read(actor,async transaction => {
      const cte = `WITH attention AS (
        SELECT 'case:'||c.id::text AS id,'support_case'::text AS kind,c.title,c.priority,${rankSql('c')} AS "priorityRank",c.created_at AS "createdAt",
          c.id AS "recordId",'support_case'::text AS "recordType",c.organization_id AS "organizationId",c.event_id AS "eventId",c.customer_user_id AS "customerUserId",
          '/support/'||c.id::text AS "actionPath" FROM support_cases c WHERE c.status IN ('open','in_progress')
        UNION ALL SELECT 'business-access:'||r.id::text,'business_access_request','Business access requested: '||r.business_name,
          'normal',12,r.created_at,r.id,'business_access_request',NULL::uuid,NULL::uuid,NULL::uuid,'/access-requests/'||r.id::text
          FROM business_access_requests r WHERE r.status='pending'
        UNION ALL SELECT 'onboarding:'||i.id::text,'onboarding',CASE WHEN i.expires_at<=:now THEN 'Onboarding invitation expired: ' ELSE 'Onboarding awaiting acceptance: ' END||u.display_name,
          'normal',12,i.created_at,i.id,'onboarding_invitation',NULLIF(i.grants->>'organizationId','')::uuid,NULL::uuid,i.user_id,'/people/'||i.user_id::text
          FROM onboarding_invitations i JOIN users u ON u.id=i.user_id WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
        UNION ALL SELECT 'email:'||e.id::text,'email_failure','Email delivery failed: '||e.template_alias,'high',11,e.created_at,e.id,'email_outbox',NULL::uuid,NULL::uuid,NULL::uuid,'/support?kind=email_failure'
          FROM email_outbox e WHERE e.status='failed'
        UNION ALL SELECT 'export:'||j.id::text,'export_failure','Report export failed','normal',22,j.created_at,j.id,'report_export_job',NULL::uuid,NULL::uuid,j.user_id,'/support?kind=export_failure'
          FROM report_export_jobs j WHERE j.status='failed' AND j.expires_at>:now
        UNION ALL SELECT 'media:'||m.id::text,'media_failure','Event media storage needs recovery','high',11,m.created_at,m.id,'media_asset',NULL::uuid,NULL::uuid,m.uploaded_by_user_id,'/support?kind=media_failure'
          FROM media_assets m WHERE m.last_storage_error IS NOT NULL AND m.cleanup_after<=:now
        UNION ALL SELECT 'notification:'||n.id::text,'notification_failure','Paid booking notifications failed','high',1,n.created_at,n.id,'notification_job',ev.organization_id,o.event_id,o.buyer_user_id,'/support?kind=notification_failure'
          FROM notification_jobs n JOIN orders o ON o.id=n.order_id JOIN events ev ON ev.id=o.event_id WHERE n.status='failed')`;
      const values = { now: now(),kind: input.kind,limit: input.pageSize,offset: (input.page-1)*input.pageSize };
      const where = "WHERE (:kind = 'all' OR kind=:kind)";
      const [count] = await select(`${cte} SELECT COUNT(*)::integer AS total FROM attention ${where}`,values,transaction);
      const items = await select(`${cte} SELECT * FROM attention ${where} ORDER BY "priorityRank","createdAt",id LIMIT :limit OFFSET :offset`,values,transaction);
      const counts = Object.fromEntries((await select(`${cte} SELECT kind,COUNT(*)::integer AS total FROM attention GROUP BY kind`,values,transaction)).map(row => [row.kind,row.total]));
      return { ...pageResult(items,count.total,input.page,input.pageSize),counts,intake: 'admin_created_cases_and_platform_alerts' };
    });
  }
  return { list,detail,history,create,update,needsAttention };
}
module.exports = { createAdminSupportService,categoryRank,defaultPriority };
