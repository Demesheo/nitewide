import { privacyPolicyLink, customerHomeLink } from './privacy-links.mjs';

export function PrivacyLink({ children = 'Privacy policy', newTab = false, disabled = false, className = '' }) {
  return <a className={`nw-terms-link ${className}`} href={privacyPolicyLink(import.meta.env.VITE_CUSTOMER_URL, window.location)}
    {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }}>{children}</a>;
}

export function ReturnToNitewide() {
  return <a className="nw-terms-link" href={customerHomeLink(import.meta.env.VITE_CUSTOMER_URL, window.location)}>Return to Nitewide</a>;
}
