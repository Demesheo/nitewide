const { z } = require('zod');

// Store phone destinations in E.164. Bare 10-digit numbers use the US country
// code for the initial Florida launch; international numbers need a leading +.
function normalizePhone(value) {
  if (value == null || String(value).trim() === '') return null;
  const compact = String(value).trim().replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(compact)) return `+1${compact}`;
  if (/^1\d{10}$/.test(compact)) return `+${compact}`;
  return compact;
}

const optionalPhone = z.preprocess(normalizePhone,
  z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a phone number with its country code, such as +14075551212').nullable().default(null));

module.exports = { normalizePhone, optionalPhone };
