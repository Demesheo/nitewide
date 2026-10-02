import { customerLink } from './customer-link';

export function guestlistInvitationLink(token, location = window.location) {
  const url = new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, location), location.href);
  url.search = '';
  url.searchParams.set('guestlistInvite', token);
  return url.toString();
}
