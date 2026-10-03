const { z } = require('zod');
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const categories = z.enum(['admission','paid_booking','account_access','guestlist','referral','reporting','security','other']);
const reply = z.object({ body: z.string().trim().min(1).max(4000),idempotencyKey: z.uuid() }).strict();
const request = reply.extend({ source: z.enum(['customer','business']),title: z.string().trim().min(3).max(180),category: categories,
  organizationId: z.uuid().optional(),eventId: z.uuid().optional(),orderId: z.uuid().optional() });
const token = z.string().regex(/^[a-f0-9]{64}$/);
const accessRequest = reply.extend({ name: z.string().trim().min(1).max(120),email: z.email().max(254),title: z.string().trim().min(3).max(180).default('Account access help'),website: z.literal(''),recoveryToken: token });
const read = z.object({ messageId: z.uuid() }).strict();
const adminQuery = pageQuery.extend({ search: z.string().trim().max(180).default(''),status: z.string().max(80).default('all').refine(value => value==='all' || value.split(',').every(s => ['open','in_progress','resolved','closed'].includes(s))) });
const count = z.number().int().nonnegative(),time = z.iso.datetime({ offset: true });
const thread = z.object({ id: z.uuid(),title: z.string(),category: categories,status: z.enum(['open','in_progress','resolved','closed']),
  source: z.enum(['customer','business','account_access']),eventId: z.uuid().nullable(),organizationId: z.uuid().nullable(),orderId: z.uuid().nullable(),
  eventTitle: z.string().nullable(),organizationName: z.string().nullable(),lastMessageAt: time,lastMessagePreview: z.string(),unread: z.boolean() });
const adminThread = thread.extend({ caseId: z.uuid(),contactName: z.string().nullable(),contactEmail: z.string().nullable(),contactVerified: z.boolean(),requesterName: z.string().nullable() });
const message = z.object({ id: z.uuid(),senderSide: z.enum(['admin','requester']),senderName: z.string(),body: z.string(),createdAt: time });
const page = item => z.object({ items: z.array(item),total: count,page: count,pageSize: count,hasMore: z.boolean() });
const inbox = admin => page(admin ? adminThread : thread).extend({ unreadCount: count });
const detail = admin => z.object({ thread: admin ? adminThread : thread,messages: page(message),canReply: z.boolean() });
const receipt = z.object({ id: z.uuid(),recoveryToken: token,status: z.literal('open') });
module.exports = { pageQuery,adminQuery,categories,reply,request,accessRequest,read,token,inbox,detail,receipt };
