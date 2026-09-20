const { ZodError } = require('zod');
const { DomainError } = require('../domain/errors');

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validate = (schema, source = 'body') => (req, _res, next) => {
  try { req[source] = schema.parse(req[source]); next(); } catch (error) { next(error); }
};
const requireUser = (req, _res, next) => {
  const userId = req.get('x-user-id');
  if (!userId) return next(new DomainError('x-user-id is required for this development authentication boundary', { code: 'UNAUTHENTICATED', status: 401 }));
  req.userId = userId; next();
};
function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() } });
  if (error instanceof DomainError) return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A unique value is already in use' } });
  console.error(error); return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
module.exports = { asyncHandler, validate, requireUser, errorHandler };

