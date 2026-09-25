import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionResult, cameraError } from '../src/lib/admissions.js';
test('only an authoritative duplicate result is displayed as already admitted', () => {
  assert.equal(admissionResult({ code: 'CREDENTIAL_ALREADY_USED', details: { credential: { name: 'Jordan' } } }).title, 'Already admitted');
  assert.equal(admissionResult({ code: 'INVALID_CREDENTIAL' }).title, 'Invalid');
  assert.equal(admissionResult(new Error('Network interrupted')).title, 'Check-in not confirmed');
  assert.equal(admissionResult({ code: 'EVENT_NOT_OPEN', message: 'Closed' }).type, 'error');
});
test('camera permission and hardware failures offer manual recovery', () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Error']) assert.match(cameraError({ name }), /manual/);
});
