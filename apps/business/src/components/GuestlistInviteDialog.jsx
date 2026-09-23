import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from './controls';
import { api } from '@/lib/api';
import { customerLink } from '@/lib/customer-link';

export function GuestlistInviteDialog({ open, onOpenChange, eventId, invitePools, session, onUnauthorized, onSuccess }) {
  const [contact, setContact] = useState('email');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function changeOpen(next) {
    if (busy) return;
    onOpenChange(next);
    if (!next) { setResult(null); setError(''); setContact('email'); }
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
        ...(contact === 'email' ? { email: values.get('email') } : { phone: values.get('phone') }),
        partySize: Number(values.get('partySize')),
      }) });
      if (response.token) {
        const url = new URL(customerLink(import.meta.env.VITE_CUSTOMER_URL, window.location), window.location.href);
        url.searchParams.set('guestlistInvite', response.token);
        setResult({ status: 'pending', link: url.toString() });
      } else setResult({ status: 'confirmed' });
      onSuccess?.(response);
    } catch (err) {
      if (err.status === 401) onUnauthorized?.();
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Invite to guestlist</DialogTitle><DialogDescription>Existing customers are confirmed now if space is available. New customers use a private link; space is checked when they sign up or claim it. No email or text is sent yet.</DialogDescription></DialogHeader>
      {result?.status === 'confirmed' ? <p role="status">This customer is confirmed on the guestlist. They can see the update in their Nitewide notifications.</p> : result?.link ? <div className="space-y-3"><p role="status">Invitation ready. Share this private link with the guest. It expires in 7 days and does not reserve a place.</p><Input readOnly aria-label="Guestlist invitation link" value={result.link}/><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(result.link)}>Copy link</Button></div> : <form className="space-y-4" onSubmit={sendInvite}>
        <label className="block text-sm">Guestlist pool<select name="pool" className="mt-1 block w-full rounded-md border border-border bg-secondary p-2" required>{invitePools?.direct && <option value="direct">Venue direct guestlist</option>}{invitePools?.own.map((pool) => <option key={pool.id} value={pool.id}>My allocation{pool.guestlistAllocation != null ? ` · ${pool.guestlistAllocation} places` : ''}</option>)}</select></label>
        <label className="block text-sm">Invite by<select value={contact} onChange={(e) => setContact(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-secondary p-2"><option value="email">Email</option><option value="phone">Phone</option></select></label>
        {contact === 'email' ? <Field id="invite-email" name="email" label="Email address" type="email" required/> : <Field id="invite-phone" name="phone" label="Phone number" type="tel" placeholder="+14075551212" required/>}
        <Field id="invite-party" name="partySize" label="People" type="number" min="1" max="20" defaultValue="1" required/>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="guestlist-invitation-actions"><Button disabled={busy || (!invitePools?.direct && !invitePools?.own.length)} type="submit">{busy ? 'Checking…' : 'Create invitation'}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
