const { ZodError } = require('zod');
const { DomainError } = require('../domain/errors');

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validate = (schema, source = 'body') => (req, _res, next) => {
  try { req[source] = schema.parse(req[source]); next(); } catch (error) { next(error); }
};
function createRequireUser({ authenticate, allowDevelopmentUserHeader = false, abuse }) {
  return async (req, _res, next) => {
    try {
      const authorization = req.get('authorization');
      if (authorization?.startsWith('Bearer ')) {
        const user = await authenticate(authorization.slice(7));
        req.userId = user.id;
        req.user = user;
        req.authSessionId = user.authSessionId;
        await abuse?.authenticated(req);
        return next();
      }
      const developmentUserId = req.get('x-user-id');
      if (allowDevelopmentUserHeader && developmentUserId) { req.userId = developmentUserId; await abuse?.authenticated(req); return next(); }
      return next(new DomainError('Sign in is required', { code: 'UNAUTHENTICATED', status: 401 }));
    } catch (error) { return next(error); }
  };
}
function publicError(error) {
  const result = (status, code, message, details) => ({ status, code, message, ...(details === undefined ? {} : { details }) });
  if (error?.type === 'entity.parse.failed') return result(400, 'MALFORMED_JSON', 'Request body must be valid JSON');
  if (error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE') return result(413, 'REQUEST_TOO_LARGE', 'Request exceeds the allowed size');
  if (['encoding.unsupported', 'charset.unsupported'].includes(error?.type)) return result(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request encoding is not supported');
  if (['request.aborted', 'request.size.invalid'].includes(error?.type)) return result(400, 'INVALID_REQUEST', 'Request body could not be read');
  if (error?.name === 'MulterError') return result(400, 'INVALID_UPLOAD', 'Upload fields are not supported');
  if (error instanceof ZodError) {
    // Zod custom messages and enum values can include untrusted data. Preserve
    // field locations for form UX, but never echo input or raw schema errors.
    const details = { formErrors: [], fieldErrors: Object.create(null) };
    for (const issue of error.issues.slice(0, 50)) {
      const field = typeof issue.path[0] === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(issue.path[0]) ? issue.path[0] : undefined;
      if (field) (details.fieldErrors[field] ||= []).push('Invalid value');
      else details.formErrors.push('Invalid value');
    }
    return result(422, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  if (error instanceof DomainError) return result(error.status, error.code, error.message, error.details);
  if (error?.name === 'SequelizeUniqueConstraintError') return result(409, 'DUPLICATE', 'A unique value is already in use');
  if (error?.name === 'SequelizeForeignKeyConstraintError' || error?.original?.code === '23503') return result(409, 'REFERENCE_CONFLICT', 'A referenced record is unavailable or still in use');
  if (error?.name === 'SequelizeOptimisticLockError' || ['40001', '40P01'].includes(error?.original?.code)) return result(409, 'CONCURRENT_UPDATE', 'The data changed during this operation. Refresh and try again.');
  if (error?.original?.constraint === 'event_media_ready') return result(409, 'MEDIA_NOT_READY', 'Image upload is not ready. Please upload it again.');
  if (error?.name === 'SequelizeValidationError' || ['23502', '23514'].includes(error?.original?.code)) return result(422, 'VALIDATION_ERROR', 'Request validation failed');
  if (['57014', '55P03'].includes(error?.original?.code || error?.parent?.code) || ['SequelizeConnectionAcquireTimeoutError', 'SequelizeConnectionTimedOutError'].includes(error?.name)) return result(503, 'DATABASE_TIMEOUT', 'The service is busy. Please try again.');
  // Legacy services attach HTTP status to Error, rather than DomainError.
  // Honor only client statuses and use fixed messages, never arbitrary errors.
  const status = Number(error?.status || error?.statusCode);
  const clientErrors = {
    400: ['BAD_REQUEST', 'Request could not be processed'], 401: ['UNAUTHENTICATED', 'Sign in is required'],
    403: ['FORBIDDEN', 'Forbidden'], 404: ['NOT_FOUND', 'Resource not found'],
    405: ['METHOD_NOT_ALLOWED', 'Operation is not supported for this route'],
    409: ['CONFLICT', 'The request conflicts with current data'], 410: ['GONE', 'This operation is no longer supported'],
    413: ['REQUEST_TOO_LARGE', 'Request exceeds the allowed size'], 415: ['UNSUPPORTED_MEDIA_TYPE', 'Request media type is not supported'],
    422: ['VALIDATION_ERROR', 'Request validation failed'], 429: ['RATE_LIMITED', 'Too many requests'],
  };
  if (clientErrors[status]) return result(status, ...clientErrors[status]);
  return result(500, 'INTERNAL_ERROR', 'Unexpected server error');
}
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    if (req) req.diagnosticError = 'internal';
    // Express must close an interrupted stream, but its default handler logs
    // the forwarded error. Never pass SQL/provider errors or their raw cause.
    const interrupted = new Error('Response stream interrupted');
    interrupted.status = 500; interrupted.code = 'INTERNAL_ERROR';
    return next(interrupted);
  }
  const { status, ...body } = publicError(error);
  if (req) req.diagnosticError = body.code === 'MALFORMED_JSON' ? 'json'
    : body.code === 'REQUEST_TOO_LARGE' ? 'size'
    : body.code === 'DATABASE_TIMEOUT' ? 'database_timeout'
    : status === 422 ? 'validation' : [401, 403].includes(status) ? 'authorization'
    : ['DUPLICATE', 'MEDIA_NOT_READY', 'REFERENCE_CONFLICT'].includes(body.code) ? 'database_constraint'
    : status === 409 ? 'conflict' : status === 429 ? 'rate_limit'
    : [405, 410, 415].includes(status) ? 'unsupported' : status >= 500 ? 'internal' : 'request';
  if (body.code === 'RATE_LIMITED' && Number.isFinite(error.details?.retryAfterSeconds)) res.set('Retry-After', String(Math.max(1, Math.ceil(error.details.retryAfterSeconds))));
  if (req?.requestId) body.requestId = req.requestId;
  return res.status(status).json({ error: body });
}
module.exports = { asyncHandler, validate, createRequireUser, errorHandler, publicError };
