// Only trust the server's explicit host entitlement, never category, price,
// referral commission, or customer-controlled/local-storage flags.
export const isPremiumHost = (event) => event?.isPremiumHost === true;
