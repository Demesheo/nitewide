import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passwordConfirmationError } from "../src/lib/password-confirmation.js";

test("registration requires a nonempty exact password confirmation", () => {
  assert.equal(passwordConfirmationError("ExamplePass1", ""), "Please confirm your password.");
  assert.equal(passwordConfirmationError("", ""), "Please confirm your password.");
  assert.equal(passwordConfirmationError("ExamplePass1", "ExamplePass2"), "Passwords do not match.");
  assert.equal(passwordConfirmationError("ExamplePass1", "examplePass1"), "Passwords do not match.");
  assert.equal(passwordConfirmationError("ExamplePass1", "ExamplePass1 "), "Passwords do not match.");
  assert.equal(passwordConfirmationError("ExamplePass1", "ExamplePass1"), "");
});

test("confirmation is registration-only, accessible, and checked before the API call", () => {
  const source = readFileSync(new URL("../src/components/auth-dialog.jsx", import.meta.url), "utf8");
  assert.match(source, /name="confirmPassword"[\s\S]*?type="password"[\s\S]*?autoComplete="new-password"/);
  assert.match(source, /aria-invalid=\{showMismatch/);
  assert.match(source, /aria-describedby=\{showMismatch \? confirmationErrorId/);
  assert.match(source, /disabled=\{busy \|\| \(register && Boolean\(confirmationError\)\)\}/);
  assert.ok(source.indexOf('passwordConfirmationError(body.password, form.get("confirmPassword"))') < source.indexOf('await api('));
  assert.match(source, /const body = \{ email: form.get\("email"\), password: form.get\("password"\) \}/);
  assert.doesNotMatch(source, /confirmPassword:\s*form.get/);
});
