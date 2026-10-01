const crypto = require('node:crypto');

const BUSINESS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Names are display data, not identity. A UUID suffix keeps identically named
// businesses distinct without relying on city or a race-prone availability check.
function createBusinessSlug(name) {
  const normalized = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const prefix = normalized.slice(0, 143).replace(/-+$/g, '') || 'business';
  return `${prefix}-${crypto.randomUUID()}`;
}

module.exports = { BUSINESS_SLUG_PATTERN, createBusinessSlug };
