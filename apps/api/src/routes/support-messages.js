const { asyncHandler,validate } = require('./contract-router');
const schemas = require('../http/support-message-schemas');
function registerSupportMessageRoutes({ router,requireUser,supportMessages: service }) {
  const output = work => asyncHandler(async (req,res) => res.set('Cache-Control','no-store').json({ data: await work(req) }));
  router.post('/support/requests',requireUser,validate(schemas.request),output(req => service.intake(req.userId,req.body)));
  router.post('/support/access-requests',validate(schemas.accessRequest),output(req => service.intake(null,req.body,req.ip)));
  for (const [path,admin] of [['/support/messages',false],['/admin/support/messages',true]]) {
    const who = req => service.identity(req.userId,admin);
    router.get(path,requireUser,output(req => service.list(who(req),req.query)));
    router.get(`${path}/:id`,requireUser,output(req => service.detail(who(req),req.params.id,req.query)));
    router.post(`${path}/:id/replies`,requireUser,validate(schemas.reply),output(req => service.reply(who(req),req.params.id,req.body)));
    router.post(`${path}/:id/read`,requireUser,validate(schemas.read),output(req => service.markRead(who(req),req.params.id,req.body)));
  }
  const guest = req => service.identity(null,false,req.get('X-Support-Recovery-Token'));
  const path = '/support/access-requests/:id';
  router.get(path,output(req => service.detail(guest(req),req.params.id,req.query)));
  router.post(`${path}/replies`,validate(schemas.reply),output(req => service.reply(guest(req),req.params.id,req.body)));
  router.post(`${path}/read`,validate(schemas.read),output(req => service.markRead(guest(req),req.params.id,req.body)));
}
module.exports = { registerSupportMessageRoutes };
