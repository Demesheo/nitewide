import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { eventShareUrl } from '../lib/event-share';
import { myEventAccessLost, myEventActionsReadOnly, myEventOperationsClosed } from '../lib/my-event-actions';
import { MyEventGuestlist } from './my-event-guestlist';
import './my-event-actions.css';

export function MyEventActions({ session, detail, onChanged, onUnauthorized }) {
  const event = detail.event || detail.summary;
  const [now, setNow] = useState(Date.now);
  const [closed, setClosed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const lock = useRef(false), mounted = useRef(true);
  const context = `${event.id}:${session.accessToken}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const readOnly = closed || myEventActionsReadOnly(detail, now);
  const capabilities = { ...detail.capabilities, readOnly };
  const canShare = !readOnly && capabilities.canShareReferral;
  const currentDetail = useRef(detail), currentReadOnly = useRef(readOnly);
  currentDetail.current = detail; currentReadOnly.current = readOnly;

  useEffect(() => {
    setClosed(false); setCopyError(''); setCopied(false); setCopying(false); lock.current = false;
  }, [event.id, session.accessToken]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const update = () => setNow(Date.now());
    const end = Date.parse(event.endsAt);
    const endTimer = Number.isFinite(end) ? window.setTimeout(update, Math.max(0, Math.min(end - Date.now() + 10, 2_147_483_647))) : null;
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.clearTimeout(endTimer); window.removeEventListener('focus', update); };
  }, [event.endsAt]);

  function handleFailure(error) {
    if (myEventAccessLost(error, true)) { onUnauthorized?.(error); return; }
    if (myEventOperationsClosed(error)) {
      setClosed(true);
      Promise.resolve(onChanged?.()).catch(() => {});
    }
  }

  async function copyReferral() {
    if (lock.current || !canShare || myEventActionsReadOnly(detail)) return;
    lock.current = true; setCopying(true); setCopied(false); setCopyError('');
    const eventId = event.id;
    try {
      const referral = await api(`/customer/my-events/${eventId}/referral-link`, { token: session.accessToken });
      if (!mounted.current || currentContext.current !== context) return;
      if (!referral.code || referral.eventId !== eventId) throw new Error('Your referral link is unavailable. Refresh the event and try again.');
      if (currentReadOnly.current || !currentDetail.current.capabilities.canShareReferral || myEventActionsReadOnly(currentDetail.current)) throw new Error('Sharing has closed for this event.');
      try { await navigator.clipboard.writeText(eventShareUrl(eventId, window.location.origin, referral.code)); }
      catch { throw new Error('Could not copy your referral link. Allow clipboard access and try again.'); }
      setCopied(true);
    } catch (error) {
      if (!mounted.current || currentContext.current !== context) return;
      handleFailure(error); setCopyError(error.message);
    } finally {
      if (mounted.current && currentContext.current === context) { lock.current = false; setCopying(false); }
    }
  }

  return <div className="my-event-actions">
    <section className="my-event-referral-panel" aria-labelledby="my-event-referral-heading">
      <span className="my-event-action-icon"><Link size={22} aria-hidden="true" /></span>
      <div className="my-event-referral-copy"><h2 id="my-event-referral-heading">Your referral link</h2><p>{readOnly ? 'Sharing is closed for this event.' : canShare ? 'Share your own link to keep referrals attributed to you.' : 'A referral link is not available for your current access.'}</p></div>
      <Button type="button" variant="outline" disabled={!canShare || copying} aria-busy={copying} onClick={copyReferral}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copying ? 'Copying…' : copied ? 'Referral link copied' : copyError && canShare ? 'Retry copying referral link' : 'Copy my referral link'}</Button>
      {copyError && <p className="my-event-action-error my-event-referral-feedback" role="alert">{copyError}</p>}
      {copied && <p className="my-event-action-notice my-event-referral-feedback" role="status">Your referral link is copied and ready to share.</p>}
    </section>
    <MyEventGuestlist key={`${event.id}:${session.accessToken}`} session={session} detail={detail} capabilities={capabilities} onChanged={onChanged} onUnauthorized={onUnauthorized} onClosed={() => setClosed(true)} />
  </div>;
}
