export function admissionResult(error) {
  if (error.code === 'CREDENTIAL_ALREADY_USED') return { type: 'already', title: 'Already admitted', message: 'This pass has already been checked in. Do not admit again.', credential: error.details?.credential };
  if (error.code === 'INVALID_CREDENTIAL') return { type: 'invalid', title: 'Invalid', message: 'This code is not a valid pass for the selected event.' };
  return { type: 'error', title: 'Check-in not confirmed', message: error.message || 'Check your connection, then scan again. No admission has been confirmed on this device.' };
}
export function cameraError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error.name)) return 'Camera access was not allowed. Enable Camera for this website in Safari settings, then try again, or use manual check-in.';
  if (error.name === 'NotFoundError') return 'No camera was found. You can scan a photo or check in manually.';
  if (error.name === 'NotReadableError') return 'Your camera is busy. Close other camera apps and try again, or check in manually.';
  return 'The camera could not start. Try again, scan a photo, or use manual check-in.';
}
