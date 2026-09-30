const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/nitewide';
const SSL_URL_OPTIONS = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'sslnegotiation'];

// Shared by the runtime, migration CLI and hosted bootstrap. pg connection-string
// SSL options can replace the explicit TLS object, so normalize them here first.
function databaseConnectionConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const hostedDemo = environment.HOSTED_DEMO === 'true';
  if (production && !environment.DATABASE_URL?.trim()) throw new Error('Production requires an explicit DATABASE_URL');
  let url;
  try { url = new URL(environment.DATABASE_URL || DEFAULT_DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  const sslFlag = environment.DATABASE_SSL || 'false';
  if (!['true', 'false'].includes(sslFlag)) throw new Error('DATABASE_SSL must be true or false');
  const databaseSsl = sslFlag === 'true';
  if (production && !hostedDemo && !databaseSsl) throw new Error('Production requires DATABASE_SSL=true and verified database TLS');
  if (databaseSsl && environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Database TLS certificate verification cannot be disabled');
  if (environment.DATABASE_SSL_CA && environment.DATABASE_SSL_CA_FILE) throw new Error('Configure DATABASE_SSL_CA or DATABASE_SSL_CA_FILE, not both');
  for (const key of SSL_URL_OPTIONS) {
    if (!url.searchParams.has(key)) continue;
    // verify-full is redundant but safe; everything else must be set explicitly
    // using DATABASE_SSL and the CA settings, never via a driver URL override.
    if (key !== 'sslmode' || url.searchParams.getAll(key).some(value => value !== 'verify-full') || !databaseSsl) {
      throw new Error('DATABASE_URL TLS options must use only sslmode=verify-full with DATABASE_SSL=true; configure CA settings separately');
    }
    url.searchParams.delete(key);
  }
  let ca = environment.DATABASE_SSL_CA?.replace(/\\n/g, '\n');
  if (environment.DATABASE_SSL_CA_FILE) ca = fs.readFileSync(environment.DATABASE_SSL_CA_FILE, 'utf8');
  if (ca) {
    if (!databaseSsl) throw new Error('A database CA requires DATABASE_SSL=true');
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw new Error('Database CA must contain PEM certificates');
    try { for (const certificate of certificates) new X509Certificate(certificate); }
    catch { throw new Error('Database CA contains an invalid certificate'); }
  }
  return { databaseUrl: url.toString(), databaseSsl,
    databaseTls: databaseSsl ? { require: true, rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false };
}

module.exports = { databaseConnectionConfig };
