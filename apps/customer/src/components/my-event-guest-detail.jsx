import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { LoadingIndicator } from './loading-indicator';
import { GuestlistQuantity } from './guestlist-quantity';
import { api } from '../lib/api';
import { validGuestlistPartySize } from '../lib/guestlist-quantity';
import { myEventActionsReadOnly, myEventGuestActions, myEventGuestDate, myEventGuestStatus, myEventInvitationUrl } from '../lib/my-event-actions';

export function MyEventGuestDetail({ session, detail, capabilities, selected, returnRef, onClose, onChanged, onFailure }) {
  const event = detail.event || detail.summary;
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [copied, setCopied] = useState(false);
  const [approvalDraft, setApprovalDraft] = useState({ context: '', partySize: selected.partySize || 1 });
  const lock = useRef(false), mounted = useRef(true), titleRef = useRef(null), confirmRef = useRef(null), denyRef = useRef(null), revokeRef = useRef(null);
  const failureRef = useRef(onFailure), readOnlyRef = useRef(capabilities.readOnly);
  failureRef.current = onFailure; readOnlyRef.current = capabilities.readOnly;
  const context = `${event.id}:${selected.id}:${session.accessToken}`;
  const currentEntry = entry?.id === selected.id ? entry : null;
  const shown = currentEntry || selected;
  const actions = myEventGuestActions(currentEntry, capabilities);
  const approvalPartySize = approvalDraft.context === context ? approvalDraft.partySize : shown.partySize || 1;
  const canAdjustApproval = actions.review && !actions.admitted && !myEventActionsReadOnly(detail);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setEntry(null); setConfirmation(''); setCopied(false);
    setApprovalDraft({ context, partySize: selected.partySize || 1 });
    api(`/customer/my-events/${event.id}/guestlist-page/${selected.id}`, { token: session.accessToken, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setEntry(data); setApprovalDraft({ context, partySize: data.partySize || 1 }); } })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); failureRef.current(error); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [event.id, selected.id, session.accessToken, retry]);
  useEffect(() => { if (confirmation) confirmRef.current?.focus({ preventScroll: true }); }, [confirmation]);

  function close() { if (!lock.current) onClose(); }
  function keep() {
    const previous = confirmation; setConfirmation(''); setError('');
    requestAnimationFrame(() => (previous === 'reject' ? denyRef : revokeRef).current?.focus({ preventScroll: true }));
  }
  async function decide(decision) {
    if (lock.current || loading || readOnlyRef.current || myEventActionsReadOnly(detail)) return;
    if (decision === 'cancel' ? !actions.revoke : !actions.review) return;
    if (decision === 'approve' && (!canAdjustApproval || !validGuestlistPartySize(approvalPartySize, 20))) return;
    lock.current = true; setBusy(decision); setError('');
    try {
      await api(`/customer/my-events/${event.id}/guestlist/${currentEntry.id}/decision`, { token: session.accessToken, method: 'POST', body: { decision, ...(decision === 'approve' ? { partySize: approvalPartySize } : {}) } });
      await onChanged(decision);
      onClose();
    } catch (error) { setError(error.message); onFailure(error); }
    finally { lock.current = false; setBusy(''); }
  }
  async function copy() {
    if (lock.current || loading || !actions.copy || readOnlyRef.current || myEventActionsReadOnly(detail)) return;
    lock.current = true; setBusy('copy'); setError(''); setCopied(false);
    try {
      const invitation = await api(`/customer/my-events/${event.id}/guestlist/${entry.id}/invitation-link`, { token: session.accessToken });
      if (!mounted.current) return;
      if (readOnlyRef.current || myEventActionsReadOnly(detail)) throw new Error('Sharing has closed for this event.');
      try { await navigator.clipboard.writeText(myEventInvitationUrl(invitation.token, window.location.origin)); }
      catch { throw new Error('Could not copy the invitation link. Allow clipboard access and try again.'); }
      setCopied(true);
    } catch (error) { setError(error.message); onFailure(error); }
    finally { lock.current = false; setBusy(''); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="my-event-action-dialog my-event-guest-dialog" showCloseButton={false} aria-busy={loading || Boolean(busy)}
      onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); returnRef.current?.focus({ preventScroll: true }); }}
      onEscapeKeyDown={(event) => { if (lock.current) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (lock.current) event.preventDefault(); }}>
      <Button type="button" variant="ghost" className="my-event-dialog-close" aria-label="Close guest details" disabled={Boolean(busy)} onClick={close}><X aria-hidden="true" /></Button>
      <DialogHeader><span className="my-event-action-eyebrow">GUEST DETAILS</span><DialogTitle ref={titleRef} tabIndex={-1}>{shown.guestName || 'Guest'}</DialogTitle><DialogDescription>{shown.guestEmail || shown.guestPhone || 'No contact details on file'}</DialogDescription></DialogHeader>
      <p className="my-event-detail-event">{event.title}</p>
      {loading && <LoadingIndicator>Checking the latest guest status…</LoadingIndicator>}
      <dl className="my-event-guest-facts">
        <div><dt>Status</dt><dd><span className="my-event-guest-status" data-status={shown.status}>{myEventGuestStatus(shown.status)}</span></dd></div>
        <div><dt>{shown.status === 'pending' ? 'Requested spots' : 'Spots'}</dt><dd>{shown.partySize || 1}{Number(shown.checkedInSpots) > 0 ? ` · ${shown.checkedInSpots} admitted` : ''}</dd></div>
        <div><dt>Source</dt><dd>{shown.source === 'affiliate' || shown.eventAffiliateId ? `Referred by ${shown.referrerName || 'Unknown referrer'}` : 'Direct guestlist'}</dd></div>
        <div><dt>Requested</dt><dd>{myEventGuestDate(shown.createdAt)}</dd></div>
        {shown.guestEmail && shown.guestPhone && <div><dt>Phone</dt><dd>{shown.guestPhone}</dd></div>}
        {shown.reviewedAt && <div><dt>Reviewed</dt><dd>{myEventGuestDate(shown.reviewedAt)}</dd></div>}
        {shown.reviewerName && <div><dt>Reviewed by</dt><dd>{shown.reviewerName}</dd></div>}
        {shown.checkedInAt && <div><dt>Last admission</dt><dd>{myEventGuestDate(shown.checkedInAt)}</dd></div>}
        {shown.reviewNote && <div className="my-event-guest-fact-wide"><dt>Review note</dt><dd>{shown.reviewNote}</dd></div>}
      </dl>
      {!loading && canAdjustApproval && <section className="my-event-approval-quantity" aria-label="Approval quantity">
        <GuestlistQuantity id="my-event-approved-spots" label="Approved spots" value={approvalPartySize} max={20} disabled={Boolean(busy) || Boolean(confirmation)} decreaseLabel="Decrease approved spots" increaseLabel="Increase approved spots" describedBy="my-event-approved-spots-help" onChange={(partySize) => { if (!lock.current && canAdjustApproval && !confirmation) setApprovalDraft({ context, partySize }); }} />
        <p id="my-event-approved-spots-help">{approvalPartySize} separate entry {approvalPartySize === 1 ? 'pass' : 'passes'} on approval.</p>
      </section>}
      {capabilities.readOnly && <p className="my-event-action-hint">This event is read-only. Invitations, sharing and guestlist review are closed.</p>}
      {!capabilities.readOnly && actions.admitted && <p className="my-event-action-hint">A pass has already been used. This approval cannot be revoked.</p>}
      {confirmation && <section className="my-event-decision-warning" aria-label={confirmation === 'reject' ? 'Confirm denial' : 'Confirm revocation'}><h3>{confirmation === 'reject' ? 'Deny this request?' : 'Revoke this approval?'}</h3><p>{confirmation === 'reject' ? 'The guest will not receive entry passes for this request.' : `All ${shown.partySize || 1} unused entry ${(shown.partySize || 1) === 1 ? 'pass will' : 'passes will'} stop working, and the spots will be released from this guestlist.`}</p></section>}
      {error && <div className="my-event-action-failure"><p className="my-event-action-error" role="alert">{error}</p>{!loading && !entry && <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry guest details</Button>}</div>}
      {copied && <p className="my-event-action-notice" role="status">Private invitation link copied. Share it only with this guest.</p>}
      <div className="my-event-dialog-actions">
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={close}>Close</Button>
        {!loading && entry && !confirmation && actions.copy && <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={copy}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{busy === 'copy' ? 'Copying…' : copied ? 'Invitation link copied' : error ? 'Retry copying invitation link' : 'Copy invitation link'}</Button>}
        {!loading && currentEntry && actions.review && !confirmation && <><Button ref={denyRef} type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setError(''); setConfirmation('reject'); }}>Deny request</Button><Button type="button" disabled={Boolean(busy) || !canAdjustApproval || !validGuestlistPartySize(approvalPartySize, 20)} onClick={() => decide('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve request'}</Button></>}
        {!loading && entry && actions.revoke && !confirmation && <Button ref={revokeRef} type="button" variant="outline" className="my-event-danger-button" disabled={Boolean(busy)} onClick={() => { setError(''); setConfirmation('cancel'); }}>Revoke approval</Button>}
        {confirmation && !capabilities.readOnly && <><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={keep}>{confirmation === 'reject' ? 'Keep request' : 'Keep approval'}</Button><Button ref={confirmRef} type="button" variant="destructive" disabled={Boolean(busy)} onClick={() => decide(confirmation)}>{busy ? (confirmation === 'reject' ? 'Denying…' : 'Revoking…') : (confirmation === 'reject' ? 'Confirm denial' : 'Confirm revocation')}</Button></>}
      </div>
    </DialogContent>
  </Dialog>;
}
