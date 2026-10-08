const { createHash } = require('node:crypto');

const ADDRESS_FIELDS = ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode'];
const normalizeAddressPart = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
function locationAddressHash(location) {
  return createHash('sha256').update(ADDRESS_FIELDS.map(key => normalizeAddressPart(location[key])).join('\n')).digest('hex');
}
function eligiblePublicAddress(location) {
  return location.privacy === 'public' && String(location.countryCode || '').trim().toUpperCase() === 'US'
    && Boolean(String(location.addressLine1 || '').trim() && String(location.city || '').trim() && String(location.region || '').trim());
}
// This hook keeps instances coherent; the database trigger enforces the same
// invalidation for bulk/raw updates and prevents trusting a previous address.
function invalidateLocationGeography(location) {
  const addressChanged = location.isNewRecord || ADDRESS_FIELDS.some(key => location.changed(key)) || location.changed('privacy');
  if (!addressChanged) return;
  for (const key of ['countyFips', 'geocodeAddressHash', 'geocodeSource', 'geocodeBenchmark', 'geocodeVintage', 'geocodedAt', 'geocodeNextAttemptAt']) location.set(key, null);
  if (!location.isNewRecord) for (const key of ['latitude', 'longitude', 'geo']) location.set(key, null);
  location.set('geocodeAttempts', 0);
  location.set('geocodeStatus', eligiblePublicAddress(location) ? 'pending' : 'unsupported');
}
const trustedLocationSql = alias => `${alias}.geocode_status='matched' AND ${alias}.geocode_source='census' AND ${alias}.privacy='public'
  AND upper(btrim(${alias}.country_code))='US' AND ${alias}.geocode_address_hash=location_address_hash(${alias}.address_line1,${alias}.address_line2,${alias}.city,${alias}.region,${alias}.postal_code,${alias}.country_code)
  AND ${alias}.latitude IS NOT NULL AND ${alias}.longitude IS NOT NULL AND ${alias}.geo IS NOT NULL`;
module.exports = { ADDRESS_FIELDS, locationAddressHash, eligiblePublicAddress, invalidateLocationGeography, trustedLocationSql };
