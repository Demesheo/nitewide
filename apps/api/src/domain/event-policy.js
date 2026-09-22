const { conflict } = require('./errors');
function eventFinished(event, now = new Date()) {
  return event.status === 'completed' || new Date(event.endsAt) <= now;
}
function assertEventEditable(event, now = new Date()) {
  if (eventFinished(event, now)) throw conflict('Past events are read-only. Their sales and attendance history remain available.', 'EVENT_FINISHED');
}
function offeringSaleState(offering, offerings, now = new Date()) {
  if (!offering.isActive) return 'inactive';
  if (offering.inventoryMode === 'finite' && offering.quantitySold >= offering.quantityTotal) return 'sold_out';
  if (offering.salesEndAt && now >= new Date(offering.salesEndAt)) return 'closed';
  if (offering.salesStartAt && now < new Date(offering.salesStartAt)) return 'scheduled';
  if (offering.releaseAfterOfferingId) {
    const previous = offerings.find((o) => o.id === offering.releaseAfterOfferingId);
    // A ladder advances after sellout, the predecessor's window ends, or an
    // editor manually closes that predecessor. The successor's own window
    // remains an independent requirement (checked above).
    const released = previous && (
      !previous.isActive ||
      (previous.salesEndAt && now >= new Date(previous.salesEndAt)) ||
      (previous.inventoryMode === 'finite' && previous.quantitySold >= previous.quantityTotal)
    );
    if (!released) return 'waiting_for_tier';
  }
  return 'on_sale';
}
module.exports = { eventFinished, assertEventEditable, offeringSaleState };
