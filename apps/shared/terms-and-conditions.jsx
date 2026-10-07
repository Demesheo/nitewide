import { useId, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Download, X } from 'lucide-react';
import terms from './legal/terms-2026-10-07.json';
import './terms-and-conditions.css';

export const TERMS_VERSION = terms.version;
export const termsAcceptance = { termsAccepted: true, termsVersion: TERMS_VERSION };

function saveTerms() {
  const text = [terms.title, `Version ${terms.version} · Updated ${terms.updated}`, terms.reviewStatus, terms.notice,
    ...terms.sections.flatMap(section => [section.title, ...section.paragraphs])].join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `nitewide-terms-${terms.version}.txt`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TermsLink({ children = 'Terms and conditions', className = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null), heading = useRef(null);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <a ref={trigger} href="#nitewide-terms" className={`nw-terms-link ${className}`} aria-haspopup="dialog" aria-disabled={disabled || undefined}
      onClick={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setOpen(true); }}>{children}</a>
    <Dialog.Portal>
      <Dialog.Overlay className="nw-terms-overlay" />
      <Dialog.Content className="nw-terms-dialog" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <header className="nw-terms-header">
          <p className="nw-terms-eyebrow">NITEWIDE, INC. · LEGAL</p>
          <Dialog.Title ref={heading} tabIndex={-1}>{terms.title}</Dialog.Title>
          <Dialog.Description>For customers and businesses · Updated {terms.updated} · Version {terms.version}</Dialog.Description>
          <Dialog.Close className="nw-terms-close" aria-label="Close terms and conditions"><X size={20} aria-hidden="true" /></Dialog.Close>
        </header>
        <div className="nw-terms-scroll" tabIndex={0} role="region" aria-label="Terms and conditions document">
          <p className="nw-terms-draft">{terms.reviewStatus}</p>
          <p className="nw-terms-notice">{terms.notice}</p>
          {terms.sections.map(section => <section key={section.id}>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </section>)}
        </div>
        <footer className="nw-terms-footer"><button type="button" onClick={saveTerms}><Download size={16} aria-hidden="true" />Save a copy</button><Dialog.Close>Back to form</Dialog.Close></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function TermsAcceptance({ accepted, onChange, disabled = false }) {
  const id = useId(), noticeId = useId();
  return <div className="nw-terms-consent">
    <div className="nw-terms-choice">
      <input id={id} type="checkbox" name="termsAccepted" checked={accepted} required disabled={disabled}
        aria-label="I agree to the terms and conditions of use for Nitewide" aria-describedby={noticeId} onChange={event => onChange(event.target.checked)} />
      <div><label htmlFor={id}>I agree to the </label><TermsLink disabled={disabled}>terms and conditions of use for Nitewide</TermsLink><span>.</span></div>
    </div>
    <p id={noticeId}>Required to create an account. Includes individual arbitration and a class-action waiver, with a 30-day opt-out and exceptions required by law.</p>
  </div>;
}
