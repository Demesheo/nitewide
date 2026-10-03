import { useEffect, useRef, useState } from 'react';
import { Link } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { eventShareUrl } from '../lib/event-share';
import { myEventAccessLost, myEventActionsReadOnly, myEventOperationsClosed } from '../lib/my-event-actions';
import { MyEventGuestlist } from './my-event-guestlist';
import './my-event-actions.css';
import { ManualCopyLink, useClipboardCopy, usePrefetchedLink } from '../../../shared/clipboard-copy.jsx';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';

export function MyEventActions({ session, detail, onChanged, onUnauthorized }) {
  const event = detail.event || detail.summary;
  const [now, setNow] = useState(Date.now);
  const [closed, setClosed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const lock = useRef(false), mounted = useRef(true);
  const context = `${event.id}:${session.accessToken}`;
  const { copy, manualLink } = useClipboardCopy(context);
  const currentContext = useRef(context);
  currentContext.current = context;
  const readOnly = closed || myEventActionsReadOnly(detail, now);
  const capabilities = { ...detail.capabilities, readOnly };
  const canShare = !readOnly && capabilities.canShareReferral;
  const referral = usePrefetchedLink(context, canShare, async signal => {
    const result = await api(`/customer/my-events/${event.id}/referral-link`, { token: session.accessToken, signal });
    if (!result.code || result.eventId !== event.id) throw new Error('Your referral link is unavailable. Refresh the event and try again.');
    return eventShareUrl(event.id, window.location.origin, result.code);
  }, handleFailure);

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
    if (lock.current || !canShare || !referral.link || myEventActionsReadOnly(detail)) return;
    lock.current = true; setCopying(true); setCopied(false); setCopyError('');
    try {
      await copy(referral.link);
      if (mounted.current && currentContext.current === context) setCopied(true);
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
      {referral.error ? <Button type="button" variant="outline" onClick={referral.retry}>Retry loading referral link</Button> : <CopyLinkButton component={Button} disabled={!canShare || !referral.link || copying} onClick={copyReferral} copied={copied} copying={copying || referral.loading} loadingLabel={referral.loading ? 'Preparing referral link…' : 'Copying…'} copiedLabel="Referral link copied" label={copyError && canShare ? 'Retry copying referral link' : 'Copy my referral link'}/>}
      {(copyError || referral.error) && <p className="my-event-action-error my-event-referral-feedback" role="alert">{copyError || referral.error}</p>}
      <ManualCopyLink link={canShare && referral.link ? manualLink : ''}/>
      {copied && <p className="my-event-action-notice my-event-referral-feedback" role="status">Your referral link is copied and ready to share.</p>}
    </section>
    <MyEventGuestlist key={`${event.id}:${session.accessToken}`} session={session} detail={detail} capabilities={capabilities} onChanged={onChanged} onUnauthorized={onUnauthorized} onClosed={() => setClosed(true)} />
  </div>;
}
