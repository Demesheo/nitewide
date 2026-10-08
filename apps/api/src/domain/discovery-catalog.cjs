// Versioned public Census data stays server-side. No customer coordinates and no
// remote requests are needed to resolve a city, search suggestions or metro group.
const catalog = require('../data/discovery-catalog.json');
const { parseDiscoverySelection, normalizeDiscoveryText, discoveryRegionAliases } = require('../../../shared/discovery-areas.mjs');
const catalogVersion = catalog.version;
const groups = new Map(catalog.groups.map((group) => [group.key, Object.freeze(group)]));
const countyGroups = new Map(catalog.groups.flatMap((group) => group.counties.map((county) => [county, group])));
const aliases = new Map();
const groupMembers = new Map();
const normalize = normalizeDiscoveryText;
const cleanLegalName = (name) => name.replace(/\s+\(balance\)$/i, '').replace(/\s+(?:city and borough|city|town|village|borough|municipality|municipal government|metropolitan government|CDP|zona urbana|comunidad)$/i, '').trim();
const placeAliases = (name) => {
  const clean = cleanLegalName(name);
  const values = new Set([name, clean]);
  for (const value of [...values]) {
    if (/\bSt\.?\s/i.test(value)) values.add(value.replace(/\bSt\.?\s/gi, 'Saint '));
    if (/\bSaint\s/i.test(value)) values.add(value.replace(/\bSaint\s/gi, 'St '));
  }
  // Census legal names differ from these common city selections; aliases identify
  // the same Census place, not additional land or a wider grouping.
  if (clean === 'Urban Honolulu') values.add('Honolulu');
  if (clean === 'Nashville-Davidson') values.add('Nashville');
  if (clean === 'Louisville/Jefferson County metro government') values.add('Louisville');
  return [...values];
};
const identity = (city, region) => `${region}:${normalize(city)}`;
const places = catalog.places.map(([geoid, legalName, region, latitude, longitude, counties, centerCountyFips, groupKey, textMembershipUnambiguous]) => {
  const names = placeAliases(legalName);
  const regionText = discoveryRegionAliases({ region, countryCode: 'US' }).join(' ');
  const place = { geoid, legalName, city: cleanLegalName(legalName), region, latitude, longitude, regionText,
    counties, centerCountyFips, groupKey, textMembershipUnambiguous, names };
  for (const name of names) {
    const key = identity(name, region);
    const matches = aliases.get(key) || [];
    if (!matches.includes(place)) matches.push(place);
    aliases.set(key, matches);
  }
  return place;
});

// Only unambiguous, same-group city/state aliases are eligible for text matching.
// A multi-county place touching a different group needs actual address geography.
for (const place of places) {
  if (!place.groupKey || !place.textMembershipUnambiguous) continue;
  const members = groupMembers.get(place.groupKey) || [];
  for (const city of place.names) {
    const matches = aliases.get(identity(city, place.region));
    if (matches.some((candidate) => !candidate.textMembershipUnambiguous || candidate.groupKey !== place.groupKey)) continue;
    members.push(Object.freeze({ city, region: place.region, countryCode: 'US' }));
  }
  groupMembers.set(place.groupKey, members);
}
for (const [key, members] of groupMembers) groupMembers.set(key, Object.freeze(members));

function placeLabel(place) {
  // Same-state duplicate names retain Census legal suffixes for disambiguation.
  const matches = aliases.get(identity(place.city, place.region)) || [];
  return `${matches.length === 1 ? place.city : place.legalName}, ${place.region}`;
}
function placeScopeKey(place) {
  if (!place.centerCountyFips) return `unresolved:${place.geoid}`;
  return groups.has(place.groupKey) ? `us:${place.groupKey}` : `us:radius:${place.geoid}`;
}
function resolvePlace(place) {
  const group = groups.get(place.groupKey);
  const label = placeLabel(place);
  const common = { key: placeScopeKey(place), version: catalogVersion, label, city: label.slice(0, label.lastIndexOf(',')), region: place.region,
    countryCode: 'US', placeKey: `place:${place.geoid}`, center: Object.freeze({ latitude: place.latitude, longitude: place.longitude }),
    centerLabel: label, centerCountyFips: place.centerCountyFips };
  if (!place.centerCountyFips) return Object.freeze({ ...common, kind: 'city', resolutionStatus: 'unresolved', localities: [common.city], members: [], counties: [] });
  if (group) {
    const members = groupMembers.get(group.key) || [];
    return Object.freeze({ ...common, kind: group.kind, groupLabel: group.label, resolutionStatus: 'resolved',
      counties: group.counties, members, localities: [...new Set(members.map((member) => member.city))] });
  }
  return Object.freeze({ ...common, kind: 'radius', resolutionStatus: 'resolved',
    radiusMeters: catalog.radiusMeters, radiusMiles: 30, counties: [], members: [], localities: [common.city] });
}

function resolveNationalDiscoveryArea(selection) {
  const parsed = parseDiscoverySelection(selection);
  if (!parsed) return null;
  if (parsed.countryCode !== 'US') return Object.freeze({ ...parsed, version: catalogVersion, kind: 'city', resolutionStatus: 'unresolved',
    members: [{ city: parsed.city, region: parsed.region, countryCode: parsed.countryCode }], counties: [] });
  const matches = aliases.get(identity(parsed.city, parsed.region));
  if (!matches || matches.length !== 1) return Object.freeze({ ...parsed, version: catalogVersion, kind: 'city', resolutionStatus: 'unresolved',
    members: [{ city: parsed.city, region: parsed.region, countryCode: 'US' }], counties: [] });
  return resolvePlace(matches[0]);
}

function searchDiscoveryAreas(query, limit = 5) {
  if (typeof query !== 'string' || query.length > 120) return { items: [], hasMore: false };
  const qualified = parseDiscoverySelection(query);
  if (qualified && qualified.countryCode !== 'US') return { items: [], hasMore: false };
  const terms = normalize(qualified?.city || query).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!terms.length) return { items: [], hasMore: false };
  const maximum = Math.max(1, Math.min(5, Number.isInteger(limit) ? limit : 5));
  const requestedCity = normalize(qualified?.city || query.split(',')[0]);
  const exactPlace = place => place.names.some(name => normalize(name) === requestedCity);
  const matches = places.filter((place) => place.centerCountyFips && (!qualified || place.region === qualified.region) && place.names.some((name) => {
    const haystack = normalize(qualified ? name : `${name} ${place.regionText}`);
    return terms.every((term) => haystack.includes(term));
  })).filter((place) => {
    const label = placeLabel(place);
    const roundTrip = aliases.get(identity(label.slice(0, label.lastIndexOf(',')), place.region));
    // Identical Census legal names can still refer to multiple places in one
    // state. Never offer a label that would resolve to an unknown/different area.
    return roundTrip?.length === 1 && roundTrip[0] === place;
  }).sort((a, b) => {
    const rank = (place) => exactPlace(place) ? 0 : normalize(place.city).startsWith(terms[0]) ? 1 : 2;
    return rank(a) - rank(b) || placeLabel(a).localeCompare(placeLabel(b), 'en', { sensitivity: 'base' }) || a.geoid.localeCompare(b.geoid);
  });
  // A complete place name is a selection, not a broad substring search through
  // its state name. Unqualified exact names still preserve distinct states.
  const exactMatches = matches.filter(exactPlace);
  const distinct = [];
  const seenScopes = new Set();
  for (const place of exactMatches.length ? exactMatches : matches) {
    const key = placeScopeKey(place);
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    distinct.push(place);
    if (distinct.length > maximum) break;
  }
  return { items: distinct.slice(0, maximum).map((place) => {
    const area = resolvePlace(place);
    return { key: area.key, label: area.label, city: area.city, region: area.region, countryCode: 'US', kind: area.kind, ...(area.groupLabel ? { groupLabel: area.groupLabel } : {}) };
  }), hasMore: distinct.length > maximum };
}

function countyArea(countyFips) {
  const group = typeof countyFips === 'string' && /^\d{5}$/.test(countyFips) ? countyGroups.get(countyFips) : null;
  return group ? { key: `us:${group.key}`, kind: group.kind, groupLabel: group.label, version: catalogVersion } : null;
}

module.exports = { resolveNationalDiscoveryArea, searchDiscoveryAreas, countyArea, catalogVersion };
