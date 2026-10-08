#!/usr/bin/env node
// Offline generated data only. Inputs are pinned public Census datasets; no API keys.
// Arguments: metro workbook rows JSON, Gazetteer ZIP, GeoInfo155 JSON,
//            center-county JSON, output JSON, original metro workbook XLSX.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Product-approved full-metro exceptions to division-based discovery.
// Keep county membership in the official CBSA instead of assembling city lists.
const wholeMetroExceptions = ['12060', '16980', '19100', '19820', '37980', '41860', '42660', '45300'];
const wholeMetroCodes = new Set(wholeMetroExceptions);
// Partial combinations are explicitly Nitewide markets, not official CBSA codes.
const divisionCombinations = [
  { key: 'market:boston-ma', kind: 'metro', label: 'Boston-Cambridge-Newton-Framingham, MA', cbsa: '14460', divisionCodes: ['14454', '15764'] },
];
const divisionOverrides = new Map(divisionCombinations.flatMap((group) => group.divisionCodes.map((code) => [code, group])));
if (divisionOverrides.size !== divisionCombinations.reduce((count, group) => count + group.divisionCodes.length, 0)) throw new Error('Overlapping division combinations');
const countyCombinations = [
  { key: 'market:dc-core', kind: 'metro', label: 'Washington, DC and close-in Maryland/Virginia suburbs', cbsa: '47900',
    counties: ['11001', '24031', '24033', '51013', '51059', '51510', '51600', '51610'] },
];
const countyOverrides = new Map(countyCombinations.flatMap((group) => group.counties.map((county) => [county, group])));
if (countyOverrides.size !== countyCombinations.reduce((count, group) => count + group.counties.length, 0)) throw new Error('Overlapping county combinations');
// These original divisions lose counties to the approved DC core. Their
// remaining land must not keep an official title/code that implies the core.
const residualDivisionMarkets = [
  { key: 'market:dc-outer-va-wv', kind: 'metro', label: 'Outer Virginia-Jefferson County, WV', cbsa: '47900', divisionCode: '11694' },
  { key: 'market:frederick-md', kind: 'metro', label: 'Frederick County, MD', cbsa: '47900', divisionCode: '23224' },
  { key: 'market:charles-md', kind: 'metro', label: 'Charles County, MD', cbsa: '47900', divisionCode: '47764' },
];
const residualOverrides = new Map(residualDivisionMarkets.map((group) => [group.divisionCode, group]));

function buildCatalog(metroRows, placesText, relationships, centers, sources) {
  const groups = new Map();
  const countyGroups = new Map();
  const seenWholeMetros = new Set();
  const seenCombinedDivisions = new Set();
  const seenCombinedCounties = new Set();
  for (const row of metroRows.slice(3)) {
    if (row[4] !== 'Metropolitan Statistical Area') continue; // Micro areas use radius.
    const wholeMetro = wholeMetroCodes.has(String(row[0]));
    const combination = divisionOverrides.get(String(row[1]));
    const county = String(row[9]).padStart(2, '0') + String(row[10]).padStart(3, '0');
    if (!/^\d{5}$/.test(county)) throw new Error('Invalid OMB county code');
    const countyCombination = countyOverrides.get(county);
    const residual = residualOverrides.get(String(row[1]));
    for (const policy of [combination, countyCombination, residual]) {
      if (policy && (policy.cbsa !== String(row[0]) || wholeMetro)) throw new Error('Invalid partial metro combination');
    }
    if (combination && countyCombination) throw new Error('Overlapping partial metro policies');
    const market = countyCombination || combination || residual;
    if (wholeMetro) seenWholeMetros.add(String(row[0]));
    if (combination) seenCombinedDivisions.add(String(row[1]));
    if (countyCombination) seenCombinedCounties.add(county);
    const kind = market?.kind || (row[1] && !wholeMetro ? 'division' : 'metro');
    const code = String(kind === 'division' ? row[1] : row[0]).padStart(5, '0');
    const key = market?.key || `${kind}:${code}`;
    const group = groups.get(key) || { key, kind, label: market?.label || (kind === 'division' ? row[5] : row[3]), counties: [] };
    if (countyGroups.has(county) && countyGroups.get(county) !== key) throw new Error('Overlapping discovery groups');
    group.counties.push(county);
    countyGroups.set(county, key);
    groups.set(key, group);
  }
  if (wholeMetroExceptions.some((code) => !seenWholeMetros.has(code)) || [...divisionOverrides.keys()].some((code) => !seenCombinedDivisions.has(code))
    || [...countyOverrides.keys()].some((county) => !seenCombinedCounties.has(county)) || residualDivisionMarkets.some((group) => !groups.has(group.key))) {
    throw new Error('Approved metro policy is missing a source component; review the source vintage before regeneration');
  }
  const countyParts = new Map();
  for (const row of relationships.rows) {
    const values = countyParts.get(row.GEOID) || new Set();
    values.add(row.countyFips);
    countyParts.set(row.GEOID, values);
  }
  const lines = placesText.trim().split(/\r?\n/);
  const headers = lines.shift().split('|').map((value) => value.trim());
  const places = lines.map((line) => {
    const source = Object.fromEntries(line.split('|').map((value, index) => [headers[index], value.trim()]));
    const latitude = Number(source.INTPTLAT), longitude = Number(source.INTPTLONG);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid Census internal point');
    const counties = [...(countyParts.get(source.GEOID) || [])].sort();
    const centerCounty = centers.counties[source.GEOID] || null;
    if (centerCounty && !counties.includes(centerCounty)) throw new Error('Center county is not a place county');
    const groupKey = centerCounty ? countyGroups.get(centerCounty) || null : null;
    // Text-only event membership is safe only when *every* portion is in this group.
    const unambiguous = Boolean(groupKey && counties.length && counties.every((county) => countyGroups.get(county) === groupKey));
    return [source.GEOID, source.NAME, source.USPS, latitude, longitude, counties, centerCounty, groupKey, unambiguous];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  if (places.length < 30000 || groups.size < 350) throw new Error('Incomplete nationwide source data');
  return {
    version: 'census-2025-omb-2023-v1',
    pointDescription: 'Census representative internal point used as city center, not customer GPS or venue coordinates',
    radiusMeters: 48280.32,
    policy: { divisionsPreferred: true, wholeMetroExceptions, divisionCombinations, countyCombinations, residualDivisionMarkets, micropolitanUsesRadius: true },
    sources,
    placeColumns: ['geoid', 'legalName', 'region', 'latitude', 'longitude', 'countyFips', 'centerCountyFips', 'groupKey', 'textMembershipUnambiguous'],
    groups: [...groups.values()].map((group) => ({ ...group, counties: [...new Set(group.counties)].sort() })).sort((a, b) => a.key.localeCompare(b.key)),
    places,
  };
}

if (require.main === module) {
  const [metroPath, placesPath, relationshipsPath, centersPath, outputPath, workbookPath] = process.argv.slice(2);
  if (!workbookPath) throw new Error('Expected six source/output paths');
  const digest = (path) => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  const relationships = JSON.parse(fs.readFileSync(relationshipsPath, 'utf8'));
  const centers = JSON.parse(fs.readFileSync(centersPath, 'utf8'));
  const catalog = buildCatalog(JSON.parse(fs.readFileSync(metroPath, 'utf8')),
    execFileSync('unzip', ['-p', placesPath], { encoding: 'utf8', maxBuffer: 10000000 }), relationships, centers,
    [
      { url: 'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx', sha256: digest(workbookPath), transformedRowsSha256: digest(metroPath), vintage: 'July 2023 OMB' },
      { url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip', sha256: digest(placesPath), vintage: '2025' },
      { url: 'https://www2.census.gov/programs-surveys/geoinfo/2025/geoinfo2025.csv', sha256: relationships.metadata.sourceSha256, sourceBytes: relationships.metadata.sourceBytes, vintage: '2025', selection: 'SUMLEVEL155 GEOCOMP00 GEOVARIANT00' },
      centers.metadata,
    ]);
  fs.mkdirSync(require('node:path').dirname(outputPath), { recursive: true });
  // One line per place keeps generated diffs reviewable without megabytes of indentation.
  const { places, ...metadata } = catalog;
  fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2).slice(0, -2) + ',\n  "places": [\n' + places.map((place) => '    ' + JSON.stringify(place)).join(',\n') + '\n  ]\n}\n');
  console.log(JSON.stringify({ groups: catalog.groups.length, places: places.length, centersUnresolved: places.filter((place) => !place[6]).length, outputPath }));
}
module.exports = { buildCatalog };
