const { ZodError } = require('zod');
const { DomainError } = require('../domain/errors');

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validate = (schema, source = 'body') => (req, _res, next) => {
  try { req[source] = schema.parse(req[source]); next(); } catch (error) { next(error); }
};
function createRequireUser({ authenticate, allowDevelopmentUserHeader = false }) {
  return async (req, _res, next) => {
    try {
      const authorization = req.get('authorization');
      if (authorization?.startsWith('Bearer ')) {
        const user = await authenticate(authorization.slice(7));
        req.userId = user.id;
        req.user = user;
        return next();
      }
      const developmentUserId = req.get('x-user-id');
      if (allowDevelopmentUserHeader && developmentUserId) { req.userId = developmentUserId; return next(); }
      return next(new DomainError('Sign in is required', { code: 'UNAUTHENTICATED', status: 401 }));
    } catch (error) { return next(error); }
  };
}
function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() } });
  if (error instanceof DomainError) return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A unique value is already in use' } });
  if (error.name === 'SequelizeOptimisticLockError' || ['40001', '40P01'].includes(error.original?.code)) return res.status(409).json({ error: { code: 'CONCURRENT_UPDATE', message: 'The data changed during this operation. Refresh and try again.' } });
  console.error(error); return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
module.exports = { asyncHandler, validate, createRequireUser, errorHandler };
