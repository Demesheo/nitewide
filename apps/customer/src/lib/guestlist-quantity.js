export const customerGuestlistMaxPartySize = 5;

export function customerGuestlistPartyLimit(maxPartySize = customerGuestlistMaxPartySize) {
  const reported = Number(maxPartySize);
  return Number.isInteger(reported) && reported > 0 ? Math.min(customerGuestlistMaxPartySize, reported) : customerGuestlistMaxPartySize;
}

export function validGuestlistPartySize(value, max = customerGuestlistMaxPartySize) {
  return Number.isInteger(value) && value >= 1 && value <= max;
}
