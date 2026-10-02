import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { LoadingState } from './LoadingState';

const titles = {disable:'Disable new payments',resume:'Resume payments',disconnect:'Disconnect Stripe account'};
const providerErrors = {
  DISCONNECT_UNCONFIRMED:'Stripe has not confirmed disconnection. New payments are disabled. Wait one minute and retry, or refresh to check the signed Stripe notification. Do not assume the connection was removed.',
  DISCONNECT_NOT_SUPPORTED:'Stripe did not permit disconnection for this account. New payments are disabled, but the Stripe connection remains. You can review it in Stripe’s dashboard.',
  DISCONNECT_OBLIGATIONS:'Stripe found unresolved disputes or could not fully check them. New payments are disabled. Resolve these in Stripe before trying again.',
};
export function PaymentConnectionDialog({ account, mode, base, session, request, onClose, onSaved }) {
  const [impact,setImpact] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [confirmed,setConfirmed] = useState(false), [reason,setReason] = useState(''), [revision,setRevision] = useState(0);
  const pending = useRef(null), retryKey = useRef(account.disconnectStatus === 'pending' ? account.disconnectRequestId : crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController(); setImpact(null); setError('');
    request(`${base}/${account.id}/disconnect-impact`,session,{signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) { setImpact(result); if (result.account.disconnectStatus === 'pending') retryKey.current = result.account.disconnectRequestId; } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  },[base,account.id,session.accessToken,revision]);
  useEffect(() => () => pending.current?.abort(),[]);
  async function submit(event) {
    event.preventDefault();
    if (pending.current || !impact || !confirmed || reason.trim().length < 3) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    try {
      const result = await request(`${base}/${account.id}/${mode}`,session,{method:'POST',signal:controller.signal,
        body:JSON.stringify({confirmed:true,reason:reason.trim(),idempotencyKey:retryKey.current})});
      if (controller.signal.aborted) return;
      const saved = result.account || result;
      onSaved(saved,mode);
      if (mode === 'disconnect' && saved.disconnectStatus !== 'disconnected') {
        setImpact(current => ({...current,account:saved}));
        setError(providerErrors[saved.disconnectErrorCode] || 'Disconnection is still being checked. New payments are disabled. Wait one minute and retry or refresh the status.');
      } else onClose();
    } catch (err) { if (!controller.signal.aborted) { setError(err.message); } }
    finally { if (pending.current === controller) {pending.current = null;setBusy(false);} }
  }
  const disabled = busy || !impact || !confirmed || reason.trim().length < 3 || (mode === 'disconnect' && !impact.canDisconnect);
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}>
    <DialogContent className="payment-connection-dialog" showCloseButton={!busy} onEscapeKeyDown={event => {if(busy) event.preventDefault();}} onPointerDownOutside={event => {if(busy) event.preventDefault();}}>
      <DialogHeader><DialogTitle>{titles[mode]}</DialogTitle><DialogDescription>{account.name} · This account only.</DialogDescription></DialogHeader>
      <form onSubmit={submit} aria-busy={busy}>
        <div className="payment-connection-warning"><AlertTriangle size={20} aria-hidden="true"/><p>{mode === 'disconnect'
          ? 'This removes Nitewide’s Stripe access. It does not close the account or cancel events. Paid bookings stop; existing passes and history stay intact. Later refunds and disputes must be handled in the merchant’s Stripe dashboard.'
          : mode === 'disable' ? 'New paid bookings using this account will stop. Payments already in progress can still complete; existing passes, refunds and history stay intact. You can resume after verifying Stripe readiness.'
          : 'New paid bookings will resume only after Stripe confirms this account is ready.'}</p></div>
        <p className="hint">Free offerings and guestlists remain available. Existing bookings keep their original merchant.</p>
        {!impact && !error && <LoadingState>Checking affected events and bookings…</LoadingState>}
        {impact && <>
          <dl className="payment-impact-grid"><div><dt>Affected live events</dt><dd>{impact.affectedEvents}</dd></div><div><dt>Pending payments</dt><dd>{impact.pendingPayments}</dd></div><div><dt>Payments needing review</dt><dd>{impact.reviewPayments}</dd></div><div><dt>Unresolved refunds</dt><dd>{impact.unresolvedRefunds}</dd></div><div><dt>Unfulfilled paid bookings</dt><dd>{impact.unfulfilledPaidBookings}</dd></div><div><dt>Saved booking history</dt><dd>{impact.historicalBookings}</dd></div></dl>
          {mode === 'disconnect' && impact.blockedReasons.length > 0 && <div className="payment-connection-blockers" role="status"><strong>Resolve these before disconnecting</strong><ul>{impact.blockedReasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>You can disable new payments now without removing Stripe access.</p></div>}
          {mode === 'disconnect' && !impact.providerDisconnectConfigured && <p className="error">Stripe disconnection is not configured. You can still disable new payments.</p>}
          {mode === 'disconnect' && <p className="hint">Open Stripe disputes are checked before disconnection. Reconnecting requires fresh Stripe setup.</p>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        <label htmlFor="payment-connection-reason">Reason<Input id="payment-connection-reason" name="reason" value={reason} disabled={busy} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="Why are you making this change?"/></label>
        <label className="payment-connection-confirm"><input id="payment-connection-confirm" name="confirmed" type="checkbox" checked={confirmed} disabled={busy || !impact} onChange={event => setConfirmed(event.target.checked)}/><span>I understand the impact on paid bookings and Stripe access.</span></label>
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => setRevision(value=>value+1)}>Refresh impact</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={disabled}>{busy ? 'Updating connection…' : titles[mode]}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
