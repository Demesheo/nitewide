const { createHash,timingSafeEqual } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { z } = require('zod');
const { mutationTransaction } = require('./mutation-transaction');
const { assertActiveUser,assertActiveEvent } = require('./lifecycle-service');
const { DomainError,notFound,conflict } = require('../domain/errors');
const schemas = require('../http/support-message-schemas');
const hash = value => createHash('sha256').update(value).digest('hex');
const page = (items,total,input) => ({ items,total,...input,hasMore: input.page*input.pageSize<total });
function createSupportMessageService({ models,permissions,notifications,sequelize,now = () => new Date() }) {
  // Router/contract construction also runs with narrow model fixtures. Capture
  // the injected connection without requiring any model at registration time.
  const db = sequelize || models.User?.sequelize || models.Event?.sequelize;
  const select = (sql,replacements,transaction) => db.query(sql,{ replacements,transaction,type: QueryTypes.SELECT });
  const run = work => mutationTransaction(db,work);
  const lock = (key,transaction) => select('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))',{ key: `support/${key}` },transaction);
  const identity = (userId,admin = false,token) => ({ userId,admin,token });
  const readerKey = who => who.admin ? `admin:${who.userId}` : 'requester';
  async function actor(who,permission,transaction) {
    if (who.admin) return permissions.assertInternalPermission(who.userId,permission,transaction);
    if (who.userId) { const user = await models.User.findByPk(who.userId,{ transaction,lock: transaction.LOCK.SHARE }); assertActiveUser(user); return user; }
  }
  async function conversation(who,id,transaction,forUpdate = false) {
    await actor(who,'support.view',transaction);
    const [row] = await select(`SELECT t.*,c.status FROM support_conversations t JOIN support_cases c ON c.id=t.case_id WHERE t.id=:id ${forUpdate ? 'FOR UPDATE OF t,c' : ''}`,{ id: z.uuid().parse(id) },transaction);
    if (!row) throw notFound('Conversation');
    if (!who.admin) {
      if (who.userId ? row.requester_user_id !== who.userId : !schemas.token.safeParse(who.token).success || !row.recovery_token_hash || +now()>+new Date(row.created_at)+90*86400000 || !timingSafeEqual(Buffer.from(hash(who.token)),Buffer.from(row.recovery_token_hash))) throw notFound('Conversation');
    }
    return row;
  }
  const unreadSql = `EXISTS (SELECT 1 FROM support_messages m WHERE m.conversation_id=t.id AND m.sender_side=:otherSide
    AND m.created_at>COALESCE((SELECT r.last_read_at FROM support_message_reads r WHERE r.conversation_id=t.id AND r.reader_key=:readerKey),'-infinity'::timestamptz))`;
  const joins = 'FROM support_conversations t JOIN support_cases c ON c.id=t.case_id LEFT JOIN events e ON e.id=c.event_id LEFT JOIN organizations org ON org.id=c.organization_id';
  const projection = who => `t.id,${who.admin ? 'c.title,c.category,c.event_id AS "eventId",c.organization_id AS "organizationId",c.order_id AS "orderId",e.title AS "eventTitle",org.name AS "organizationName"' :
    `t.public_context->>'title' AS title,t.public_context->>'category' AS category,t.public_context->>'eventId' AS "eventId",t.public_context->>'organizationId' AS "organizationId",t.public_context->>'orderId' AS "orderId",t.public_context->>'eventTitle' AS "eventTitle",t.public_context->>'organizationName' AS "organizationName"`},c.status,t.source,
    t.last_message_at AS "lastMessageAt",t.last_message_preview AS "lastMessagePreview",${unreadSql} AS unread
    ${who.admin ? ',t.case_id AS "caseId",t.contact_name AS "contactName",t.contact_email AS "contactEmail",t.contact_verified AS "contactVerified",COALESCE(u.display_name,t.contact_name) AS "requesterName"' : ''}`;
  const summaryJoins = who => `${joins} ${who.admin ? 'LEFT JOIN users u ON u.id=t.requester_user_id' : ''}`;
  async function summary(who,id,transaction) {
    const [row] = await select(`SELECT ${projection(who)} ${summaryJoins(who)} WHERE t.id=:id`,{ id,otherSide: who.admin ? 'requester' : 'admin',readerKey: readerKey(who) },transaction);
    return row;
  }
  async function detailIn(who,id,query,transaction) {
    const input = schemas.pageQuery.parse(query);
    const row = await conversation(who,id,transaction);
    const [count] = await select('SELECT COUNT(*)::integer AS total FROM support_messages WHERE conversation_id=:id',{ id },transaction);
    const thread = await summary(who,id,transaction);
    const items = await select(`SELECT id,sender_side AS "senderSide",CASE WHEN sender_side='admin' THEN 'Nitewide' ELSE :requesterName END AS "senderName",body,created_at AS "createdAt"
      FROM support_messages WHERE conversation_id=:id ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset`,{ id,requesterName: who.admin ? thread.requesterName || 'Requester' : 'You',limit: input.pageSize,offset: (input.page-1)*input.pageSize },transaction);
    let canReply = row.status==='open'||row.status==='in_progress';
    if (who.admin && canReply) {
      try { await permissions.assertInternalPermission(who.userId,'support.manage',transaction); }
      catch (error) { if (error.status!==403) throw error; canReply = false; }
    }
    return { thread,messages: page(items.reverse(),count.total,input),canReply };
  }
  const detail = (who,id,query = {}) => run(transaction => detailIn(who,id,query,transaction));
  async function list(who,query = {}) {
    const parsed = (who.admin ? schemas.adminQuery : schemas.pageQuery).parse(query);
    const input = { page: parsed.page,pageSize: parsed.pageSize };
    return run(async transaction => {
      await actor(who,'support.view',transaction);
      const values = { userId: who.userId,otherSide: who.admin ? 'requester' : 'admin',readerKey: readerKey(who),limit: input.pageSize,offset: (input.page-1)*input.pageSize,
        status: parsed.status || 'all',statuses: (parsed.status || 'all').split(','),search: `%${(parsed.search || '').replace(/[\\%_]/g,'\\$&')}%` };
      const scope = who.admin ? "(:status = 'all' OR c.status IN (:statuses)) AND (c.title ILIKE :search OR t.last_message_preview ILIKE :search)" : 't.requester_user_id=:userId';
      const [count] = await select(`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE ${unreadSql})::integer AS "unreadCount" ${joins} WHERE ${scope}`,values,transaction);
      const items = await select(`SELECT ${projection(who)} ${summaryJoins(who)} WHERE ${scope} ORDER BY t.last_message_at DESC,t.id DESC LIMIT :limit OFFSET :offset`,values,transaction);
      return { ...page(items,count.total,input),unreadCount: count.unreadCount };
    });
  }
  async function acknowledge(who,id,messageId,transaction) {
    const [message] = await select('SELECT created_at FROM support_messages WHERE id=:messageId AND conversation_id=:id',{ id,messageId },transaction);
    if (!message) throw notFound('Message');
    await select(`INSERT INTO support_message_reads(conversation_id,reader_key,last_read_at) VALUES(:id,:readerKey,:at)
      ON CONFLICT(conversation_id,reader_key) DO UPDATE SET last_read_at=GREATEST(support_message_reads.last_read_at,EXCLUDED.last_read_at) RETURNING conversation_id`,{ id,readerKey: readerKey(who),at: message.created_at },transaction);
  }
  async function markRead(who,id,body) {
    const input = schemas.read.parse(body);
    return run(async transaction => { await conversation(who,id,transaction,true); await acknowledge(who,id,input.messageId,transaction); return { read: true }; });
  }
  async function persist(who,row,input,transaction) {
    const retryScope = who.admin ? `admin:${who.userId}` : who.userId ? `user:${who.userId}` : `guest:${row.id}`;
    await lock(`${retryScope}/${input.idempotencyKey}`,transaction);
    const [previous] = await select('SELECT * FROM support_messages WHERE retry_scope=:retryScope AND idempotency_key=:key',{ retryScope,key: input.idempotencyKey },transaction);
    if (previous) {
      if (previous.conversation_id!==row.id || previous.body!==input.body) throw conflict('Message retry does not match.','MESSAGE_IDEMPOTENCY_CONFLICT');
      return previous.id;
    }
    if (row.status==='resolved'||row.status==='closed') throw conflict('This case is complete. Submit a new request for more help.','SUPPORT_CASE_CLOSED');
    const [rate] = await select("SELECT COUNT(*)::integer AS total FROM support_messages WHERE conversation_id=:id AND created_at>:since",{ id: row.id,since: new Date(+now()-60000) },transaction);
    if (rate.total>=20) throw new DomainError('Please wait before sending another message.',{ code: 'SUPPORT_RATE_LIMIT',status: 429 });
    const at = new Date(Math.max(+now(),+new Date(row.last_message_at)+1));
    const [message] = await select(`INSERT INTO support_messages(conversation_id,sender_user_id,sender_side,body,retry_scope,idempotency_key,created_at)
      VALUES(:id,:userId,:side,:body,:retryScope,:key,:at) RETURNING id`,{ id: row.id,userId: who.userId || null,side: who.admin ? 'admin' : 'requester',body: input.body,retryScope,key: input.idempotencyKey,at },transaction);
    await select('UPDATE support_conversations SET last_message_at=:at,last_message_preview=:preview,updated_at=:at WHERE id=:id RETURNING id',{ id: row.id,at,preview: input.body.slice(0,200) },transaction);
    if (who.admin && row.requester_user_id) await notifications?.emit({ userId: row.requester_user_id,kind: 'support_message',title: 'Nitewide replied',
      message: 'You have a new support reply. Open Messages to read it.',metadata: { threadId: row.id } },transaction);
    return message.id;
  }
  async function reply(who,id,body) {
    const input = schemas.reply.parse(body);
    await run(async transaction => {
      await actor(who,who.admin ? 'support.manage' : 'support.view',transaction);
      const row = await conversation(who,id,transaction,true);
      await persist(who,row,input,transaction);
    });
    return detail(who,id);
  }
  async function context(userId,input,transaction) {
    let { organizationId = null,eventId = null,orderId = null } = input;
    if (input.source==='business') await permissions.assertBusinessAccess(userId,transaction);
    if (orderId) {
      // Determine the event before taking domain locks, matching commerce's
      // event -> order order so support cannot deadlock a booking mutation.
      const order = await models.Order.findByPk(orderId,{ transaction });
      if (!order || (input.source==='customer' && order.buyerUserId!==userId)) throw notFound('Booking');
      if (eventId && eventId!==order.eventId) throw conflict('Booking and event do not match.','SUPPORT_SCOPE_MISMATCH');
      eventId = order.eventId;
    }
    if (eventId) {
      const event = await models.Event.findByPk(eventId,{ transaction,lock: transaction.LOCK.SHARE });
      if (!event) throw notFound('Event');
      if (orderId) {
        const order = await models.Order.findByPk(orderId,{ transaction,lock: transaction.LOCK.SHARE });
        if (!order || order.eventId!==eventId || (input.source==='customer' && order.buyerUserId!==userId)) throw notFound('Booking');
      }
      if (input.source==='business') {
        const { base,orderAccess } = require('./business-read-service');
        const [accessible] = await select(`SELECT e.id FROM events e WHERE e.id=:eventId AND ${base}`,{ userId,eventId,isAdmin: false,canManageEvents: false },transaction);
        if (!accessible) throw notFound('Event');
        if (orderId) {
          const [accessibleOrder] = await select(`SELECT o.id FROM orders o JOIN events e ON e.id=o.event_id WHERE o.id=:orderId AND ${base} AND ${orderAccess}`,{ userId,eventId,orderId,isAdmin: false,canManageEvents: false },transaction);
          if (!accessibleOrder) throw notFound('Booking');
        }
      }
      else if (!orderId) {
        if (event.status!=='published') throw notFound('Event');
        try { await assertActiveEvent(models,event,transaction); }
        catch (error) { if (![403,404].includes(error.status)) throw error; throw notFound('Event'); }
      }
      if (organizationId && organizationId!==event.organizationId) throw conflict('Event and business do not match.','SUPPORT_SCOPE_MISMATCH');
      organizationId = event.organizationId;
    } else if (organizationId) {
      if (input.source!=='business') throw notFound('Business');
      const { organizationMember } = require('./business-read-service');
      const [accessible] = await select(`SELECT org.id FROM organizations org WHERE org.id=:organizationId AND org.status='active' AND org.lifecycle_state='active'
        AND (${organizationMember.replaceAll('e.organization_id','org.id')} OR EXISTS (SELECT 1 FROM venue_access va
          JOIN organization_venues ov ON ov.organization_id=va.organization_id AND ov.location_id=va.location_id
          JOIN locations loc ON loc.id=va.location_id AND loc.lifecycle_state='active'
          WHERE va.organization_id=org.id AND va.user_id=:userId AND va.status='active'))`,{ userId,organizationId },transaction);
      if (!accessible) throw notFound('Business');
    }
    return { organizationId,eventId,orderId };
  }
  async function intake(userId,body,abuseIdentity) {
    const guest = !userId,input = (guest ? schemas.accessRequest : schemas.request).parse(body);
    const who = identity(userId,false,input.recoveryToken);
    const abuseKey = hash(guest ? `ip:${abuseIdentity}` : `user:${userId}`);
    const requestHash = hash(JSON.stringify(input));
    const id = await run(async transaction => {
      const user = await actor(who,'support.view',transaction);
      const retryIdentity = guest ? hash(input.recoveryToken) : userId;
      await lock(`intake-retry/${retryIdentity}`,transaction);
      const [existing] = await select(`SELECT * FROM support_conversations WHERE ${guest ? 'recovery_token_hash=:retryIdentity' : 'requester_user_id=:retryIdentity AND request_key=:key'}`,{ retryIdentity,key: input.idempotencyKey },transaction);
      if (existing) {
        if (existing.request_hash!==requestHash) throw conflict('Request retry does not match.','MESSAGE_IDEMPOTENCY_CONFLICT');
        return existing.id;
      }
      await lock(`intake-rate/${abuseKey}`,transaction);
      const [rate] = await select('SELECT COUNT(*)::integer AS total FROM support_conversations WHERE abuse_key=:abuseKey AND created_at>:since',{ abuseKey,since: new Date(+now()-3600000) },transaction);
      if (rate.total>=(guest ? 5 : 15)) throw new DomainError('Please wait before submitting another request.',{ code: 'SUPPORT_RATE_LIMIT',status: 429 });
      const refs = guest ? {} : await context(userId,input,transaction);
      const category = guest ? 'account_access' : input.category;
      const caseRow = await models.SupportCase.create({ ...refs,title: input.title,description: input.body,category,
        customerUserId: !guest && input.source==='customer' ? userId : null,priority: require('./admin-support-service').defaultPriority(category),status: 'open' },{ transaction });
      const event = refs.eventId ? await models.Event.findByPk(refs.eventId,{ transaction }) : null;
      const org = refs.organizationId ? await models.Organization.findByPk(refs.organizationId,{ transaction }) : null;
      const publicContext = { title: input.title,category,eventId: refs.eventId || null,organizationId: refs.organizationId || null,orderId: refs.orderId || null,eventTitle: event?.title || null,organizationName: org?.name || null };
      const [row] = await select(`INSERT INTO support_conversations(case_id,requester_user_id,source,contact_name,contact_email,contact_verified,recovery_token_hash,request_key,request_hash,abuse_key,public_context,last_message_at,last_message_preview,created_at,updated_at)
        VALUES(:caseId,:userId,:source,:name,:email,:verified,:tokenHash,:key,:requestHash,:abuseKey,CAST(:publicContext AS jsonb),:at,'',:at,:at) RETURNING *`,{
        caseId: caseRow.id,userId: userId || null,source: guest ? 'account_access' : input.source,name: guest ? input.name : user.displayName,email: guest ? input.email.toLowerCase() : user.email,verified: !guest && Boolean(user.emailVerifiedAt),
        tokenHash: guest ? hash(input.recoveryToken) : null,key: input.idempotencyKey,requestHash,abuseKey,publicContext: JSON.stringify(publicContext),at: now() },transaction);
      await persist(who,{ ...row,status: 'open' },input,transaction);
      return row.id;
    });
    return guest ? { id,recoveryToken: input.recoveryToken,status: 'open' } : detail(who,id);
  }
  return { identity,intake,list,detail,reply,markRead };
}
module.exports = { createSupportMessageService,hash };
