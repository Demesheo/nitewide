import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { BusinessAccessRequestForm } from './BusinessAccessRequestForm';
import { LoadingState } from './LoadingState';
import { api } from '@/lib/api';

export function OrganizationRequestDialog({ session, onClose, onUnauthorized }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/account/organization-requests?statuses=pending&pageSize=1', session, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPending(result.items[0] || null); })
      .catch(failure => { if (!controller.signal.aborted) { if (failure.status === 401) onUnauthorized?.(); else setError(failure.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, retry, onUnauthorized]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="organization-request-dialog" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle className="sr-only">Start an organization</DialogTitle>
      <DialogDescription className="sr-only">Request a separate organization for manual Nitewide review without changing any existing membership.</DialogDescription>
      {loading ? <LoadingState>Checking your requests…</LoadingState>
        : error ? <div className="organization-request-pending"><h2>We couldn’t load your requests.</h2><p className="error" role="alert">{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button></div>
          : pending ? <section className="organization-request-pending"><span className="eyebrow"><Clock3 size={16} aria-hidden="true"/> AWAITING REVIEW</span><h2>{pending.businessName}</h2>
            <p role="status">You already have an organization request awaiting Nitewide’s manual review.</p><p>No new access has been granted. You can continue using your existing organizations with their current roles.</p><Button onClick={onClose}>Back to workspace</Button></section>
            : <BusinessAccessRequestForm session={session} onBack={onClose} onBusyChange={setBusy} onUnauthorized={onUnauthorized}/>}
    </DialogContent>
  </Dialog>;
}
