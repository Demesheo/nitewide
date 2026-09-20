class DomainError extends Error {
  constructor(message, { code = 'DOMAIN_ERROR', status = 400, details } = {}) {
    super(message); this.name = 'DomainError'; this.code = code; this.status = status; this.details = details;
  }
}
const notFound = (entity) => new DomainError(`${entity} not found`, { code: 'NOT_FOUND', status: 404 });
const forbidden = (message = 'Forbidden') => new DomainError(message, { code: 'FORBIDDEN', status: 403 });
const conflict = (message, code = 'CONFLICT') => new DomainError(message, { code, status: 409 });
module.exports = { DomainError, notFound, forbidden, conflict };

