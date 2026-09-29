import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const management = readFileSync(new URL('../src/components/Management.jsx', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../src/components/OnboardingForm.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../src/components/Analytics.jsx', import.meta.url), 'utf8');
const managementCss = readFileSync(new URL('../src/management.css', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../api/src/services/admin-management-service.js', import.meta.url), 'utf8');

test('grouped resource picker keeps every management resource reachable', () => {
  const registryKeys = [...registry.matchAll(/^  ([a-z_]+): \{ model:/gm)].map((match) => match[1]);
  const groupSource = management.match(/const resourceGroups = \[([\s\S]*?)\n\];/)?.[1] || '';
  const groupedKeys = new Set([...groupSource.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
  assert.ok(registryKeys.length >= 25, `expected at least 25 registered types, found ${registryKeys.length}`);
  assert.match(management, /const groupedResources = resourceGroups\.map\(/);
  assert.match(management, /const otherResources = resources\.filter\(\(item\) => !groupedKeys\.has\(item\.key\)\)/);
  assert.match(management, /<optgroup label="Other records">\{otherResources\.map/);
  assert.match(management, /\{groupedResources\.map\(\(\[title, items\]\) => <optgroup/);
  for (const key of registryKeys) assert.ok(groupedKeys.has(key) || management.includes('otherResources'), `${key} must be grouped or retained in Other records`);
  for (const label of ['People & access', 'Venues & events', 'Sales & admissions', 'Communications & history']) assert.ok(groupSource.includes(label));
});

test('Management preserves search, server paging, refresh, details, and create/edit routing', () => {
  assert.match(management, /page=\' \+ page \+ '\&pageSize=25\&search=\' \+ encodeURIComponent\(search\)/);
  assert.match(management, /setSearch\(event\.target\.value\); setPage\(1\)/);
  assert.match(management, /movePage\(page - 1\)/);
  assert.match(management, /movePage\(page \+ 1\)/);
  assert.match(management, /setRefresh\(\(value\) => value \+ 1\)/);
  assert.match(management, /resource\?\.canCreate && <Button/);
  assert.match(management, /Manage record/);
  assert.match(management, /api\('\/admin\/management\/' \+ requested \+ '\/' \+ record\.id\)/);
  assert.match(management, /record\.createdAt && <small>Created/);
  assert.match(management, /<summary>Record details<\/summary>/);
  assert.match(management, /navigator\.clipboard\.writeText\(id\)/);
  assert.match(management, /<DialogDescription>\{record\.id\}<\/DialogDescription>/);
  assert.match(management, /Object\.entries\(record\)\.map/);
  assert.match(management, /method: record \? 'PATCH' : 'POST'/);
});

test('onboarding has three persisted stages and only sends after explicit review', () => {
  assert.match(onboarding, /const \[step, setStep\] = useState\(0\)/);
  assert.match(onboarding, /const \[recipient, setRecipient\]/);
  assert.match(onboarding, /const \[organization, setOrganization\]/);
  assert.match(onboarding, /const \[venues, setVenues\]/);
  assert.match(onboarding, /const \[reason, setReason\]/);
  assert.match(onboarding, /const steps = \['Recipient', business \? 'Business & venues' : 'Creator profile', 'Review & invite'\]/);
  assert.match(onboarding, /aria-label="Onboarding progress"/);
  assert.match(onboarding, /step < 2\) \{ setStep\(step \+ 1\); return; \}/);
  assert.match(onboarding, /setStep\(step - 1\); setError\(''\)/);
  assert.match(onboarding, /step === 0 && <section aria-label="Recipient">/);
  assert.match(onboarding, /step === 1 && \(business \? <section aria-label="Business and venues">/);
  assert.match(onboarding, /step === 1 && \(business \?[^]*<section aria-label="Creator profile">/);
  assert.match(onboarding, /step === 2 && <section aria-label="Review and invite">/);
  assert.match(onboarding, /<Button type="submit" disabled=\{busy\}>\{busy \? 'Preparing…' : step === 2 \? 'Prepare and invite recipient' : 'Continue'\}/);
  assert.match(onboarding, /api\('\/admin\/onboarding', \{ method: 'POST', body: JSON\.stringify\(\{ kind, recipient, \...\(business \? \{ organization, venues \} : \{\}\), reason \}\) \}\)/);
  assert.match(onboarding, /Required audit reason[\s\S]*?minLength=\{3\}[\s\S]*?required/);
  assert.match(onboarding, /Review invitation[\s\S]*?Account type[\s\S]*?Recipient[\s\S]*?Business[\s\S]*?Venues/);
});

test('onboarding supports the three account kinds, preserves venue drafts, and validates before POST', () => {
  for (const kind of ['organization', 'venue', 'independent_creator']) assert.ok(onboarding.includes(`value="${kind}"`));
  assert.match(onboarding, /if \(value === 'venue'\) setVenues\(\(previous\) => \[previous\[0\] \|\| blankVenue\(\)\]\)/);
  assert.match(onboarding, /kind === 'organization' && <Button type="button"[^]*Add another venue/);
  assert.match(onboarding, /disabled=\{venues\.length >= 25\}/);
  assert.match(onboarding, /required=\{\['name', 'addressLine1', 'city', 'countryCode', 'timezone'\]\.includes\(key\)\}/);
  assert.match(onboarding, /required=\{key !== 'phone'\}/);
  assert.match(onboarding, /The recipient chooses their own password\./);
  assert.match(onboarding, /No password or setup link is exposed to administrators\./);
});

test('mobile Admin keeps Overview actions usable and Analytics search full-width', () => {
  assert.match(dashboard, /className="demo-action"/);
  assert.match(stylesCss, /@media\(max-width:600px\)[\s\S]*?\.head-actions \.demo-action\{order:3;flex:0 0 100%/);
  assert.match(analytics, /className="analytics-search relative min-w-52 flex-1"/);
  assert.match(stylesCss, /\.analytics-toolbar \.analytics-search\{grid-column:1\/-1;min-width:0;width:100%\}/);
  assert.match(stylesCss, /@media\(max-width:420px\)\{\.analytics-toolbar\{grid-template-columns:1fr\}/);
  assert.match(managementCss, /@media \(max-width: 720px\)[\s\S]*?\.management-toolbar \{ display: grid; grid-template-columns: 1fr/);
});
