const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
function renderOnboardingEmail(variables) {
  const name = String(variables.NAME || 'there'); const url = String(variables.SETUP_URL || '');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new Error('Account setup requires a secure application URL');
  const existing = variables.ACCOUNT_MODE === 'existing';
  const title = existing ? 'Confirm your Nitewide business access' : 'Confirm your email and set up Nitewide';
  const action = existing ? 'Sign in and confirm access' : 'Confirm email and choose password';
  const details = existing ? 'Sign in with this invited email address to accept access. Your existing password will not be changed.' : 'Confirm this email address and choose your own password. Nitewide administrators cannot see or choose your password.';
  const expiry = `This single-use link expires ${variables.EXPIRES_AT || 'in 24 hours'}.`;
  return {
    subject: title,
    text: `Hi ${name},\n\n${title}.\n${details}\n\n${action}: ${url}\n\n${expiry}\nIf you did not expect this invitation, ignore it. No account access is granted until you confirm.`,
    html: `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#13141b;color:#f4f3f9;font-family:Arial,sans-serif"><main lang="en" dir="ltr" style="max-width:600px;margin:auto;padding:32px 24px"><p style="font-size:22px;font-weight:bold">nitewide</p><h1 style="font-size:26px;line-height:1.3">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(name)},</p><p style="font-size:16px;line-height:1.6">${escapeHtml(details)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;min-height:44px;line-height:44px;padding:8px 20px;background:#b9a9ff;color:#13141b;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">${escapeHtml(action)}</a></p><p style="font-size:16px;line-height:1.6">${escapeHtml(expiry)}</p><p style="font-size:16px;line-height:1.6">If you did not expect this invitation, ignore it. No account access is granted until you confirm.</p></main></body></html>`,
  };
}
module.exports = { renderOnboardingEmail };
