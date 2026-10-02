import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, LockKeyhole, Ticket, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from './controls';
import { api } from '@/lib/api';
import { guestlistInvitationLink } from '@/lib/guestlist-invitation-link';

export function GuestlistInviteDialog({ open, onOpenChange, eventId, invitePools, session, onUnauthorized, onSuccess }) {
  const [contact, setContact] = useState('personal');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyButton = useRef(null);

  useEffect(() => {
    if (open && result) copyButton.current?.focus({ preventScroll: true });
  }, [open, result]);

  function changeOpen(next) {
    if (busy) return;
    onOpenChange(next);
    if (!next) { setResult(null); setError(''); setContact('personal'); setCopied(false); }
  }

  async function sendInvite(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const selectedPool = values.get('pool');
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await api(`/business/events/${eventId}/guestlist-invitations`, session, { method: 'POST', body: JSON.stringify({
        pool: selectedPool === 'direct' ? 'direct' : 'own',
        ...(selectedPool === 'direct' ? {} : { eventAffiliateId: selectedPool }),
        name: values.get('name'), inviteBy: contact,
        ...(contact === 'email' ? { email: values.get('email') } : contact === 'phone' ? { phone: values.get('phone') } : {}),
        partySize: Number(values.get('partySize')),
      }) });
      setResult({ link: guestlistInvitationLink(response.token), spots: response.invitation.partySize,
        name: response.invitation.name || values.get('name'), pool: selectedPool === 'direct' ? 'Venue direct guestlist' : 'My allocation' });
      setCopied(false);
      onSuccess?.(response);
    } catch (err) {
      if (err.status === 401) onUnauthorized?.();
      else setError(err.message);
    } finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(result.link); setCopied(true); setError(''); }
    catch { setError('Could not copy the link. Allow clipboard access and try again.'); }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="guestlist-invite-dialog">
      <DialogHeader>
        <DialogTitle>Invite to guestlist</DialogTitle>
        <DialogDescription>{result ? 'Approved and ready to share.' : 'Create entry passes for your guest. No account required.'}</DialogDescription>
      </DialogHeader>
      {result?.link ? <div className="guestlist-invite-success">
        <section className="guestlist-invite-confirmation" aria-label="Invitation summary">
          <div className="guestlist-invite-guest">
            <span className="guestlist-invite-check"><Check size={22} aria-hidden="true"/></span>
            <div><h3>{result.name}</h3><p role="status">{result.spots} {result.spots === 1 ? 'spot approved' : 'spots approved'}</p></div>
          </div>
          <dl className="guestlist-invite-summary">
            <div><dt>Entry passes</dt><dd>{result.spots} {result.spots === 1 ? 'individual pass' : 'separate passes'}</dd></div>
            <div><dt>Guestlist</dt><dd>{result.pool}</dd></div>
          </dl>
        </section>
        <p className="guestlist-invite-note"><LockKeyhole size={16} aria-hidden="true"/><span>Anyone with this link can open the passes. Share it only with your guest.</span></p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="guestlist-invite-success-actions">
          <Button ref={copyButton} type="button" onClick={copyLink}>{copied ? <Check aria-hidden="true"/> : <Copy aria-hidden="true"/>}{copied ? 'Link copied' : 'Copy link'}</Button>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Done</Button>
        </div>
        <span className="sr-only" role="status">{copied ? 'Link copied. Ready to send to your guest.' : ''}</span>
      </div> : <form className="guestlist-invite-form" onSubmit={sendInvite} aria-busy={busy}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Guest invitation details</legend>
          <div className="guestlist-invite-recipient">
            <Field id="invite-name" name="name" label="Guest name" maxLength="120" autoComplete="name" placeholder="e.g. Alex Rivera" required/>
            <Field id="invite-party" name="partySize" label="Spots" type="number" min="1" max="20" defaultValue="1" aria-describedby="invite-spots-hint" required/>
          </div>
          <label className="field" htmlFor="invite-pool"><span>Guestlist pool</span><select id="invite-pool" name="pool" required>{invitePools?.direct && <option value="direct">Venue direct guestlist</option>}{invitePools?.own.map((pool) => <option key={pool.id} value={pool.id}>My allocation{pool.guestlistAllocation != null ? ` · ${pool.guestlistAllocation} places` : ''}</option>)}</select></label>
          <div className="guestlist-invite-contact">
            <label className="field" htmlFor="invite-method"><span>Invite by</span><select id="invite-method" name="inviteBy" value={contact} onChange={(e) => setContact(e.target.value)}><option value="personal">Personal · Share link yourself</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
            {contact === 'email' ? <Field id="invite-email" name="email" label="Email address" type="email" autoComplete="email" required/> : contact === 'phone' ? <Field id="invite-phone" name="phone" label="Phone number" type="tel" autoComplete="tel" placeholder="+14075551212" required/> : <p className="guestlist-invite-contact-hint">No email or phone needed. Copy and send the link yourself.</p>}
          </div>
        </fieldset>
        <p className="guestlist-invite-note" id="invite-spots-hint"><Ticket size={16} aria-hidden="true"/><span>1–20 spots, with a separate pass for each guest. Approved immediately if space is available.</span></p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="guestlist-invitation-actions"><Button variant="outline" type="button" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={busy || (!invitePools?.direct && !invitePools?.own.length)} type="submit">{busy && <LoaderCircle className="nw-loading-icon" aria-hidden="true"/>}{busy ? 'Checking…' : 'Create invitation'}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
