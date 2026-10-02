import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { AdmissionPassView } from './admission-pass-view';
import { LoadingIndicator } from './loading-indicator';
import brandLogo from '../assets/nitewide-logo-v1.png';

const unavailable = {
  full: 'This guestlist is full. Contact the person who invited you.',
  event_closed: 'This event is no longer accepting invitations.',
  unavailable: 'This invitation is no longer available. Contact the person who invited you.',
};

export function GuestlistInvitationPage({ token }) {
  const [pass, setPass] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer'; meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const path = `/guestlist-invitations/${encodeURIComponent(token)}`;
    let ready = false, refreshing = false;
    setPass(null); setIndex(0); setError('');
    async function refresh() {
      if (!ready || refreshing || document.hidden || controller.signal.aborted) return;
      refreshing = true;
      try { const result = await api(`${path}/pass`, { signal: controller.signal }); if (!controller.signal.aborted) { setPass(result); setError(''); } }
      catch (err) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          // Never leave a stale QR on screen after revocation or a failed refresh.
          setPass(null); setError(err.message);
        }
      } finally { refreshing = false; }
    }
    async function open() {
      try {
        const result = await api(`${path}/claim`, { method: 'POST', signal: controller.signal });
        if (!result.entryId) throw new Error(unavailable[result.status] || 'This invitation is no longer available.');
        ready = true; await refresh();
      } catch (err) { if (err.name !== 'AbortError' && !controller.signal.aborted) setError(err.message); }
    }
    open();
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [token, revision]);

  const approved = pass && ['confirmed','checked_in'].includes(pass.status);
  return <div className="guest-invitation-page">
    <header><a href="/" className="brand" aria-label="Nitewide home"><img className="brand-logo" src={brandLogo} alt="" width="192" height="192"/>nitewide</a><a className="guest-invitation-home" href="/"><ArrowLeft size={16} aria-hidden="true"/> Discover events</a></header>
    <main>
      <div className="guest-invitation-heading"><p className="eyebrow">YOUR GUESTLIST PASSES</p><h1>{approved ? `You're on the list, ${pass.guestName}.` : 'Your guestlist invitation'}</h1><p>No account needed. Keep this link private—it provides access to your entry passes.</p>{pass && <p>{approved ? <>{pass.partySize} {pass.partySize === 1 ? 'spot' : 'spots'} approved{pass.tickets.length > 1 ? ' · A separate pass for each guest' : ''}</> : 'This approval is no longer available. Contact the person who invited you.'}</p>}</div>
      {error ? <div className="guest-invitation-error" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRevision(v => v + 1)}>Try again</Button></div> : !pass ? <LoadingIndicator>Opening your entry passes…</LoadingIndicator> : <AdmissionPassView ticket={pass} index={index} onIndex={setIndex}/>}
    </main>
  </div>;
}
