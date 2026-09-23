import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { profileConfirmation } from '../src/lib/profile-confirmation.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the header opens an in-place, dismissible profile modal instead of refreshing the workspace', () => {
  const app = read('src/App.jsx');
  assert.match(app, /aria-label="Your profile"/);
  assert.match(app, /onClick=\{\(\) => setProfileOpen\(true\)\}/);
  assert.match(app, /<Dialog open=\{profileOpen\} onOpenChange=\{setProfileOpen\}>/);
  assert.match(app, /<BusinessProfile session=\{session\}/);
  assert.doesNotMatch(app, /aria-label="Refresh data"/);
});

test('profile edit action stays below fields and profile updates use the authenticated API', () => {
  const profile = read('src/components/BusinessProfile.jsx');
  assert.match(profile, /api\('\/auth\/profile', session, \{ method: 'PATCH'/);
  assert.match(profile, /business-profile-actions[^]*?Pencil size=\{16\} \/> Edit/);
  assert.match(read('src/mobile.css'), /\.business-profile-actions > button \{ min-width: 96px; \}/);
});

test('contact edits require a second matching value before Save is enabled', () => {
  const original = { email: 'old@example.com', phone: '+14075550000' };
  const fields = { email: 'new@example.com', phone: '+14075551111' };
  assert.equal(profileConfirmation(original, fields, { email: '', phone: '', phoneTouched: false }).canSave, false);
  assert.equal(profileConfirmation(original, fields, { email: 'wrong@example.com', phone: '+14075551111', phoneTouched: true }).canSave, false);
  assert.equal(profileConfirmation(original, fields, { email: 'NEW@example.com', phone: '+14075551111', phoneTouched: true }).canSave, true);
  assert.equal(profileConfirmation(original, { email: original.email, phone: original.phone }, { email: '', phone: '', phoneTouched: false }).canSave, true);
  assert.equal(profileConfirmation(original, { email: original.email, phone: '' }, { email: '', phone: '', phoneTouched: false }).canSave, false);
  assert.equal(profileConfirmation(original, { email: original.email, phone: '' }, { email: '', phone: '', phoneTouched: true }).canSave, true);
  const profile = read('src/components/BusinessProfile.jsx');
  assert.match(profile, /Confirm email/);
  assert.match(profile, /Confirm phone/);
  assert.match(profile, /disabled=\{busy \|\| !checks.canSave\}/);
});
