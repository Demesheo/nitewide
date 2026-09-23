export function profileConfirmation(original, fields, confirmation) {
  const emailChanged = fields.email.trim().toLowerCase() !== original.email.trim().toLowerCase();
  const phoneChanged = fields.phone.trim() !== (original.phone || '').trim();
  const emailMatches = !emailChanged || (confirmation.email.trim().length > 0 && confirmation.email.trim().toLowerCase() === fields.email.trim().toLowerCase());
  const phoneMatches = !phoneChanged || (confirmation.phoneTouched && confirmation.phone.trim() === fields.phone.trim());
  return { emailChanged, phoneChanged, emailMatches, phoneMatches, canSave: emailMatches && phoneMatches };
}
