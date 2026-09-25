const { conflict } = require('./errors');
const ADMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;
function admissionOpen(event, now = new Date()) {
  return Boolean(event?.status === 'published' && +now >= +new Date(event.startsAt) - ADMISSION_WINDOW_MS && +now <= +new Date(event.endsAt) + ADMISSION_WINDOW_MS);
}
function assertAdmissionOpen(event, now) {
  if (!admissionOpen(event, now)) throw conflict('Admissions are available from 24 hours before the event starts until 24 hours after it ends.', 'EVENT_NOT_OPEN');
}
module.exports = { ADMISSION_WINDOW_MS, admissionOpen, assertAdmissionOpen };
