import { useEffect, useRef, useState } from 'react';
import { Check, LockKeyhole, Ticket, X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { LoadingIndicator } from './loading-indicator';
import { api } from '../lib/api';
import { myEventActionsReadOnly, myEventInviteBody, myEventInvitePools, myEventInvitationUrl } from '../lib/my-event-actions';
import { ManualCopyLink, useClipboardCopy } from '../../../shared/clipboard-copy.jsx';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';

export function MyEventInviteDialog({ session, detail, capabilities, onClose, onChanged, onRefresh, onFailure, returnRef }) {
  const event = detail.event || detail.summary;
  const [fields, setFields] = useState({ name: '', partySize: '1', pool: '' });
  const [pools, setPools] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const { copy: copyLink, manualLink } = useClipboardCopy(result?.token);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const nameRef = useRef(null), copyRef = useRef(null), contentRef = useRef(null), focusedForm = useRef(false), failureRef = useRef(onFailure), readOnlyRef = useRef(capabilities.readOnly);
  failureRef.current = onFailure;
  readOnlyRef.current = capabilities.readOnly;
  const options = myEventInvitePools(pools);
  const writable = !capabilities.readOnly && capabilities.canInviteGuestlist;
  const invitationLink = result?.token ? myEventInvitationUrl(result.token, window.location.origin) : '';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/customer/my-events/${event.id}/guestlist-invite-pools`, { token: session.accessToken, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setPools(data);
        setFields((current) => ({ ...current, pool: myEventInvitePools(data).some((item) => item.id === current.pool) ? current.pool : myEventInvitePools(data)[0]?.id || '' }));
      })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); failureRef.current(error, true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [event.id, session.accessToken, retry]);
  useEffect(() => { if (result && !busy) copyRef.current?.focus({ preventScroll: true }); }, [result, busy]);
  useEffect(() => { if (!loading && writable && pools?.open && !focusedForm.current) { nameRef.current?.focus({ preventScroll: true }); focusedForm.current = true; } }, [loading, writable, pools]);

  const change = (key) => (event) => { setFields((current) => ({ ...current, [key]: event.target.value })); setError(''); };
  const close = () => { if (!lock.current && !copying) onClose(); };
  async function submit(event) {
    event.preventDefault();
    if (lock.current || uncertain || !writable || pools?.open !== true || myEventActionsReadOnly(detail)) return;
    let body;
    try { body = myEventInviteBody({ ...fields, inviteBy: 'personal' }); }
    catch (error) { setError(error.message); return; }
    if (!options.some((pool) => pool.id === fields.pool)) { setError('Choose an available guestlist pool.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await api(`/customer/my-events/${(detail.event || detail.summary).id}/guestlist-invitations`, { token: session.accessToken, method: 'POST', body });
      setResult({ token: response.token, name: response.invitation?.name || body.name, spots: response.invitation?.partySize || body.partySize, pool: options.find((item) => item.id === fields.pool)?.label });
      await onChanged();
    } catch (error) {
      if (!error.status || error.status >= 500) {
        setUncertain(true);
        setError('We could not confirm whether this invitation was created. Check the guestlist before creating another invitation.');
      } else setError(error.message);
      onFailure(error);
    }
    finally { lock.current = false; setBusy(false); }
  }
  async function copy() {
    if (lock.current || copying || !writable || readOnlyRef.current || myEventActionsReadOnly(detail)) return;
    lock.current = true; setCopying(true); setError('');
    try { await copyLink(invitationLink); setCopied(true); }
    catch (error) { setError(error.message); setCopied(false); }
    finally { lock.current = false; setCopying(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent ref={contentRef} className="my-event-action-dialog my-event-invite-dialog" showCloseButton={false} aria-busy={busy || copying}
      onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); returnRef.current?.focus({ preventScroll: true }); }}
      onEscapeKeyDown={(event) => { if (lock.current || copying) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (lock.current || copying) event.preventDefault(); }}>
      <Button type="button" variant="ghost" className="my-event-dialog-close" aria-label="Close invitation" disabled={busy || copying} onClick={close}><X aria-hidden="true" /></Button>
      <DialogHeader><span className="my-event-action-eyebrow">GUESTLIST INVITATION</span><DialogTitle>{result ? 'Your guest is on the list' : 'Invite a guest'}</DialogTitle><DialogDescription>{result ? 'Approved and ready for you to share privately.' : 'No guest account needed. Choose 1–20 spots.'}</DialogDescription></DialogHeader>
      {result ? <div className="my-event-invite-success">
        <div className="my-event-invite-confirmation"><span className="my-event-approved-icon"><Check aria-hidden="true" /></span><div><h3>{result.name}</h3><p role="status">{result.spots} {result.spots === 1 ? 'spot approved' : 'spots approved'}</p></div></div>
        <dl className="my-event-guest-facts"><div><dt>Entry passes</dt><dd>{result.spots} separate {result.spots === 1 ? 'single-use pass' : 'single-use passes'}</dd></div><div><dt>Guestlist pool</dt><dd>{result.pool}</dd></div></dl>
        <p className="my-event-action-hint"><LockKeyhole size={18} aria-hidden="true" /><span>Anyone with this private link can open the passes. Copy and share it only with your guest.</span></p>
        {error && <p className="my-event-action-error" role="alert">{error}</p>}
        <ManualCopyLink link={writable ? manualLink : ''}/>
        {!writable && <p className="my-event-action-hint">Sharing has closed for this event.</p>}
        <div className="my-event-dialog-actions clipboard-action-stack"><Button type="button" variant="outline" disabled={busy || copying} onClick={close}>Done</Button><CopyLinkButton component={Button} ref={copyRef} className="clipboard-copy-button" disabled={busy || copying || !writable} onClick={copy} copied={copied} copying={copying} copiedLabel="Invitation link copied" label={error ? 'Retry copying invitation link' : 'Copy invitation link'}/></div>
        {copied && <p className="my-event-action-notice" role="status">Private invitation link copied. Ready to share with your guest.</p>}
      </div> : <form onSubmit={submit} className="my-event-invite-form" aria-busy={busy}>
        <fieldset disabled={busy || uncertain || loading || !writable || pools?.open !== true}><legend className="sr-only">Guest invitation details</legend>
          <div className="my-event-invite-recipient"><label className="my-event-action-field" htmlFor="my-event-invite-name"><span>Guest name</span><input ref={nameRef} id="my-event-invite-name" name="name" value={fields.name} onChange={change('name')} autoComplete="name" maxLength={120} placeholder="e.g. Alex Rivera" required /></label><label className="my-event-action-field" htmlFor="my-event-invite-spots"><span>Spots</span><input id="my-event-invite-spots" name="partySize" type="number" min={1} max={20} step={1} inputMode="numeric" value={fields.partySize} onChange={change('partySize')} aria-describedby="my-event-spots-help" required /></label></div>
          {options.length > 1 ? <label className="my-event-action-field" htmlFor="my-event-invite-pool"><span>Guestlist pool</span><select id="my-event-invite-pool" name="pool" value={fields.pool} onChange={change('pool')} required>{options.map((pool) => <option key={pool.id} value={pool.id}>{pool.label}</option>)}</select></label> : options.length === 1 && <p className="my-event-invite-pool"><span>Guestlist pool</span><strong>{options[0].label}</strong></p>}
          <label className="my-event-action-field" htmlFor="my-event-invite-method"><span>Invite by</span><select id="my-event-invite-method" name="inviteBy" value="personal" disabled><option value="personal">Personal · Share the link yourself</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
        </fieldset>
        {loading && <LoadingIndicator>Checking available guestlists…</LoadingIndicator>}
        {!loading && (!writable || pools?.open === false) && <p className="my-event-action-hint">Invitations are closed for this event.</p>}
        {!loading && pools?.open && !options.length && <p className="my-event-action-hint">There is no guestlist pool available for your access. Ask your event manager to check your allocation.</p>}
        <p className="my-event-action-hint" id="my-event-spots-help"><Ticket size={18} aria-hidden="true" /><span>Each spot creates a separate single-use pass. Approved immediately if space is available.</span></p>
        <p className="my-event-invite-delivery">No email or phone needed. Copy and share the private link with your guest.</p>
        {error && <div className="my-event-action-failure"><p className="my-event-action-error" role="alert">{error}</p>{!pools && !loading && <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry guestlist check</Button>}</div>}
        <div className="my-event-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>{uncertain ? <Button type="button" onClick={() => { onRefresh?.(); close(); }}>Check guestlist</Button> : <Button type="submit" disabled={busy || loading || !writable || pools?.open !== true || !options.length}>{busy ? 'Checking space…' : error && pools ? 'Retry invitation' : 'Create invitation'}</Button>}</div>
      </form>}
    </DialogContent>
  </Dialog>;
}
