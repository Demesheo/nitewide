import { useEffect } from 'react';
import policy from '../../../shared/legal/privacy-2026-10-09.json';
import { ContactNitewide } from './messages';
import { TermsLink } from '../../../shared/terms-and-conditions.jsx';
import { customerHomeLink } from '../../../shared/privacy-links.mjs';
import './privacy-page.css';

export function PrivacyPage() {
  const home = customerHomeLink(import.meta.env.VITE_CUSTOMER_URL, window.location);
  useEffect(() => { document.title = `${policy.title} | Nitewide`; }, []);
  return <div className="privacy-page">
    <a className="privacy-skip" href="#privacy-document">Skip to privacy policy</a>
    <header className="privacy-header"><a href={home} aria-label="Nitewide home">nitewide<span>.</span></a><a href={home}>Return to Nitewide</a></header>
    <main id="privacy-document" className="privacy-document">
      <header><p className="privacy-eyebrow">NITEWIDE, INC. · PRIVACY</p><h1>{policy.title}</h1>
        <p className="privacy-summary">{policy.summary}</p><p className="privacy-date">Effective {policy.updated} · Version {policy.version}</p></header>
      <nav className="privacy-contents" aria-label="Privacy policy contents"><h2>On this page</h2><ol>{policy.sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title.replace(/^\d+\. /, '')}</a></li>)}</ol></nav>
      {policy.sections.map(section => <section id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}
      <div className="privacy-contact"><ContactNitewide privacy/><p>No account required. Save the private recovery link to read our replies.</p></div>
      <aside className="privacy-providers" aria-label="Provider privacy information"><h2>Provider privacy information</h2><ul>{policy.providerLinks.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></li>)}</ul></aside>
    </main>
    <footer className="privacy-footer"><a href={home}>Return to Nitewide</a><TermsLink/><a href="#privacy-document">Back to top</a><small>© {new Date().getFullYear()} Nitewide, Inc.</small></footer>
  </div>;
}
