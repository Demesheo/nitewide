const middleware = require('../http/middleware');
const { contractFor } = require('../http/api-contract');

function validate(schema) {
  const handler = middleware.validate(schema);
  handler.requestSchema = schema;
  return handler;
}
function asyncHandler(handler) {
  const wrapped = middleware.asyncHandler(handler);
  return wrapped;
}

// Registration is the inventory: adding a handler also adds its API operation.
// No request bodies, identities or credentials are inspected to build the spec.
function instrumentRouter(router, { requireUser, permissions } = {}) {
  router.contracts = [];
  const guardedPrefixes = [];
  const use = router.use.bind(router);
  router.use = (path, ...handlers) => {
    if (typeof path === 'string' && handlers.flat().includes(requireUser)) guardedPrefixes.push(path);
    return use(path, ...handlers);
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      const flattened = handlers.flat();
      const authenticated = flattened.includes(requireUser) || guardedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
      router.contracts.push(contractFor({ method, path, authenticated,
        requestSchema: flattened.find((handler) => handler.requestSchema)?.requestSchema }));
      const operation = router.contracts.at(-1);
      const check = (req, _res, next) => {
        req.diagnosticRoute = `/api${path}`;
        try {
          if (operation.paramsSchema) operation.paramsSchema.parse(req.params);
          if (operation.querySchema) operation.querySchema.parse(req.query);
          next();
        } catch (error) { next(error); }
      };
      const boundary = flattened.indexOf(requireUser);
      const routeHandlers = [...flattened];
      routeHandlers.splice(boundary >= 0 ? boundary + 1 : 0, 0, check);
      // Role authorization precedes all parameter/body validation on internal
      // operations; domain services still recheck inside write transactions.
      if (path.startsWith('/admin/') && permissions) routeHandlers.splice(boundary >= 0 ? boundary + 1 : 0, 0,
        middleware.asyncHandler(async (req, _res, next) => { await permissions.assertInternal(req.userId); next(); }));
      routeHandlers.unshift((req, _res, next) => { req.diagnosticRoute = `/api${path}`; next(); });
      return register(path, ...routeHandlers);
    };
  }
  router.allowedMethods = (path) => {
    const methods = router.contracts.filter((route) => {
      const pattern = route.path.split('/').map((part) => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
      return new RegExp(`^${pattern}/?$`).test(path);
    }).map((route) => route.method.toUpperCase());
    if (methods.includes('GET')) methods.push('HEAD');
    if (methods.length) methods.push('OPTIONS');
    return [...new Set(methods)].sort();
  };
  return router;
}
module.exports = { instrumentRouter, validate, asyncHandler };
