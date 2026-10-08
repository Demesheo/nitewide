// Browser-safe qualified selection parsing. Official nationwide membership,
// representative city points and radius matching stay in the API catalog.
export function normalizeDiscoveryText(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[.'’]/g, '').replace(/[\s_-]+/g, ' ');
}

const usRegions = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico', GU: 'Guam', VI: 'Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};
const regionsByCountry = {
  US: usRegions,
  CA: { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' },
  AU: { ACT: 'Australian Capital Territory', NSW: 'New South Wales', NT: 'Northern Territory', QLD: 'Queensland', SA: 'South Australia', TAS: 'Tasmania', VIC: 'Victoria', WA: 'Western Australia' },
};
const countryNames = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
  ca: 'CA', canada: 'CA', gb: 'GB', uk: 'GB', 'united kingdom': 'GB',
  au: 'AU', australia: 'AU', nz: 'NZ', 'new zealand': 'NZ',
  mx: 'MX', mexico: 'MX', fr: 'FR', france: 'FR', de: 'DE', germany: 'DE',
};
function countryCode(value) {
  const clean = normalizeDiscoveryText(value);
  return countryNames[clean] || (/^[a-z]{2}$/.test(clean) ? clean.toUpperCase() : null);
}
function regionCode(value, country) {
  const clean = normalizeDiscoveryText(value);
  for (const [code, name] of Object.entries(regionsByCountry[country] || {})) {
    if ([code, name, `${country}-${code}`].some((alias) => normalizeDiscoveryText(alias) === clean)) return code;
  }
  return country === 'US' ? null : String(value).trim();
}
export function discoveryRegionAliases(area) {
  const name = regionsByCountry[area.countryCode]?.[area.region];
  return [...new Set([area.region, name, `${area.countryCode}-${area.region}`].filter(Boolean).map(normalizeDiscoveryText))];
}

// Qualified selection parsing is deliberately lightweight for the browser.
// Nationwide membership and city points are resolved by the API's pinned catalog.
export function parseDiscoverySelection(selection) {
  if (typeof selection !== 'string' || selection.length > 120) return null;
  const parts = selection.split(',').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part)) return null;
  const [city, requestedRegion, requestedCountry] = parts;
  const country = requestedCountry ? countryCode(requestedCountry) : 'US';
  if (!country) return null;
  const region = regionCode(requestedRegion, country);
  if (!region) return null;
  const normalizedCity = normalizeDiscoveryText(city);
  if (!normalizedCity || normalizedCity === 'all cities' || normalizedCity === 'private location') return null;
  const label = `${city}, ${region}${country === 'US' ? '' : `, ${country}`}`;
  return Object.freeze({ key: `${country.toLowerCase()}:${normalizeDiscoveryText(region)}:${normalizedCity}`, label, city, region, countryCode: country, localities: Object.freeze([city]) });
}
