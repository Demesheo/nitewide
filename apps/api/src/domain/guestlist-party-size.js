const { DomainError } = require('./errors');

const MAX_GUESTLIST_REQUEST_PARTY_SIZE = 5;
const MAX_GUESTLIST_APPROVAL_PARTY_SIZE = 20;

function assertGuestlistPartySize(partySize, maxPartySize) {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > maxPartySize) {
    throw new DomainError(`Choose between 1 and ${maxPartySize} guestlist spots`, {
      code: 'INVALID_GUESTLIST_PARTY_SIZE', status: 422,
    });
  }
  return partySize;
}

module.exports = { MAX_GUESTLIST_REQUEST_PARTY_SIZE, MAX_GUESTLIST_APPROVAL_PARTY_SIZE, assertGuestlistPartySize };
