import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { api } from '../lib/api';
import { ManualCopyLink, useClipboardCopy } from '../../../shared/clipboard-copy.jsx';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';
import './rundown-sharing.css';
import { publicTarget } from '../../../shared/public-links.mjs';

const itemKey = item => item.kind === 'personal' ? 'personal' : `business:${item.organizationId}`;
const unavailable = () => new Error('We couldn’t load rundown sharing. Please try again.');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, window.location.origin);
    const target = publicTarget(url.pathname);
    const validPath = target?.kind === 'rundowns' && !url.search;
    const validLegacy = url.pathname === '/' && [...url.searchParams.keys()].length === 1 && uuidPattern.test(url.searchParams.get('rundown') || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin || url.username || url.password
      || (!validPath && !validLegacy) || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

function validItem(item) {
  return Boolean(item && ['personal', 'business'].includes(item.kind) && typeof item.name === 'string' && item.name.trim()
    && (item.kind === 'personal' ? item.organizationId === null : typeof item.organizationId === 'string' && uuidPattern.test(item.organizationId))
    && typeof item.published === 'boolean' && typeof item.canPublish === 'boolean'
    && (item.published ? publicUrl(item.url) : item.url === null));
}

function RundownShareAction({ item, session, context, onPublished, onDenied }) {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyOnly, setCopyOnly] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(true), controller = useRef(null);
  const buttonRef = useRef(null), copyRef = useRef(null);
  const { copy, manualLink } = useClipboardCopy(`${context}:${itemKey(item)}`);
  const url = item.published ? publicUrl(item.url) : null;
  const personal = item.kind === 'personal';
  const viewUrl = new URL('/', window.location.origin);
  viewUrl.searchParams.set('rundownPreview', personal ? 'personal' : item.organizationId);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  async function copyUrl() {
    if (lock.current || !url) return;
    lock.current = true; setSharing(true); setCopied(false); setError(''); setNotice('');
    try {
      await copy(url);
      if (mounted.current) { setCopied(true); setNotice('Rundown link copied. Ready to share.'); }
    } catch (cause) {
      if (mounted.current) { setError(cause.message); setOpen(true); }
    } finally { if (mounted.current) { lock.current = false; setSharing(false); } }
  }

  async function share() {
    if (lock.current) return;
    if (!item.published) { if (item.canPublish) prepareLink(); return; }
    if (!url) return;
    if (!navigator.share || copyOnly) { copyUrl(); return; }
    lock.current = true; setSharing(true); setError(''); setNotice('');
    try {
      // Start in this tap. Preparing a link or recovering from a failed share
      // requires a fresh gesture before opening the native share sheet.
      await navigator.share({ title: `${item.name} · Upcoming events`, url });
      if (mounted.current) setOpen(false);
    } catch (cause) {
      if (mounted.current && cause.name !== 'AbortError') { setCopyOnly(true); setError('Sharing isn’t available. Copy your link below.'); setOpen(true); }
    } finally { if (mounted.current) { lock.current = false; setSharing(false); } }
  }

  async function prepareLink() {
    if (lock.current || item.published || !item.canPublish) return;
    lock.current = true; setPreparing(true); setError(''); setNotice('');
    controller.current = new AbortController();
    try {
      const result = await api('/customer/rundowns', { token: session.accessToken, signal: controller.current.signal,
        body: personal ? { kind: 'personal' } : { kind: 'business', organizationId: item.organizationId } });
      if (!mounted.current || controller.current.signal.aborted) return;
      if (!validItem(result) || !result.published || itemKey(result) !== itemKey(item)) throw new Error('We couldn’t confirm your rundown link. Reload sharing before trying again.');
      onPublished(result);
      setNotice('Your rundown link is ready.');
      setOpen(true);
    } catch (cause) {
      if (!mounted.current || controller.current.signal.aborted) return;
      if (cause.status === 401 || cause.status === 403 || !cause.status || cause.status >= 500) onDenied(cause);
      else setError(cause.message || 'We couldn’t prepare this link. Please try again.');
    } finally { if (mounted.current) { lock.current = false; setPreparing(false); } }
  }

  const close = () => { if (!lock.current) { setOpen(false); setError(''); } };
  return <div className="rundown-share-action">
    <div className="rundown-share-buttons">
      <Button asChild variant="outline" className="dark-glass-action rundown-action-button"><a href={viewUrl.toString()} target="_blank" rel="noopener noreferrer" title="Opens in a new tab">View</a></Button>
      <Button ref={buttonRef} type="button" variant="outline" className="dark-glass-action rundown-action-button" disabled={preparing || sharing || (!item.published && !item.canPublish)} onClick={share}>
        {preparing ? 'Preparing link…' : sharing ? 'Sharing…' : 'Share'}
      </Button>
    </div>
    {!item.published && !item.canPublish && <p className="rundown-sharing-note">Sharing isn’t available for your current access.</p>}
    {!open && error && <p className="rundown-sharing-error" role="alert">{error}</p>}
    {!open && notice && <p className="rundown-sharing-note" role="status">{notice}</p>}
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent className="rundown-share-dialog" showCloseButton={false} aria-busy={preparing || sharing}
        onOpenAutoFocus={event => { event.preventDefault(); copyRef.current?.focus({ preventScroll: true }); }}
        onCloseAutoFocus={event => { event.preventDefault(); buttonRef.current?.focus({ preventScroll: true }); }}
        onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }} onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Share your rundown</DialogTitle>
          <DialogDescription>{item.name}’s upcoming events stay up to date at this link.</DialogDescription></DialogHeader>
        {error && <p className="rundown-sharing-error" role="alert">{error}</p>}
        <ManualCopyLink link={manualLink} />{notice && <p className="rundown-sharing-note" role="status">{notice}</p>}
        <div className="rundown-share-dialog-actions">
          <Button type="button" variant="ghost" disabled={preparing || sharing} onClick={close}>Done</Button>
          <CopyLinkButton component={Button} ref={copyRef} disabled={sharing || !url} copying={sharing} copied={copied} onClick={copyUrl} label="Copy link" copiedLabel="Link copied" />
          {typeof navigator.share === 'function' && !copyOnly && <Button type="button" variant="outline" disabled={sharing || !url} onClick={share}>Share</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

export function RundownSharing({ session, refreshKey = 0, accessChecking = false, onUnauthorized, onRecheck }) {
  const identity = session?.user?.id && session?.accessToken ? `${session.user.id}:${session.accessToken}` : '';
  const [revision, setRevision] = useState(0);
  const key = `${identity}:${refreshKey}:${revision}`;
  const [snapshot, setSnapshot] = useState(null);
  const [selection, setSelection] = useState('personal');
  const callbacks = useRef({ onUnauthorized });
  callbacks.current = { onUnauthorized };
  useEffect(() => {
    if (!identity) { setSnapshot(null); return; }
    if (accessChecking || snapshot?.key === key && !snapshot.loading && !snapshot.error) return;
    const controller = new AbortController();
    setSnapshot({ key, loading: true, items: [], error: '', denied: false });
    Promise.resolve().then(() => controller.signal.aborted ? undefined : api('/customer/rundowns', { token: session.accessToken, signal: controller.signal }))
      .then(data => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.items) || !data.items.every(validItem) || new Set(data.items.map(itemKey)).size !== data.items.length) throw unavailable();
        setSnapshot({ key, loading: false, items: data.items, error: '', denied: false });
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const denied = cause.status === 401 || cause.status === 403;
        setSnapshot({ key, loading: false, items: [], error: denied ? 'Your sharing access has changed. Recheck your event access.' : cause.message || unavailable().message, denied });
        if (cause.status === 401 || cause.code === 'BUSINESS_ACCESS_REQUIRED') callbacks.current.onUnauthorized?.(cause);
      });
    return () => controller.abort();
  }, [key, identity, session?.accessToken, accessChecking]);

  if (!identity) return null;
  const current = snapshot?.key === key ? snapshot : null;
  const items = current?.items || [];
  const selected = items.find(item => itemKey(item) === selection) || items[0];
  function published(item) { setSnapshot(value => value?.key === key ? { ...value, items: value.items.map(old => itemKey(old) === itemKey(item) ? item : old) } : value); }
  function failed(cause) {
    const denied = cause.status === 401 || cause.code === 'BUSINESS_ACCESS_REQUIRED';
    setSnapshot({ key, loading: false, items: [], error: denied ? 'Your sharing access has changed. Recheck your event access.'
      : cause.status === 403 ? 'Your sharing access has changed. Reload sharing to check your permissions.'
        : 'We couldn’t confirm your link. Reload sharing before trying again.', denied });
    if (cause.status === 401 || cause.code === 'BUSINESS_ACCESS_REQUIRED') callbacks.current.onUnauthorized?.(cause);
  }

  return <section className="rundown-sharing" aria-label="Your rundown" aria-busy={!current || current.loading}>
    <p className="rundown-sharing-description">Share your upcoming events on one page</p>
    {!current || current.loading ? <p className="rundown-sharing-note">Loading rundown sharing…</p> : current.error ? <div className="rundown-sharing-feedback"><p className="rundown-sharing-error" role="alert">{current.error}</p>
      {current.denied ? onRecheck && <Button type="button" variant="ghost" onClick={onRecheck}>Recheck event access</Button>
        : <Button type="button" variant="ghost" onClick={() => setRevision(value => value + 1)}>Reload rundown sharing</Button>}</div> : <div className="rundown-sharing-controls">
      {items.length > 1 && <div className="rundown-choice"><Select value={itemKey(selected)} onValueChange={setSelection}>
        <SelectTrigger className="rundown-choice-trigger" aria-label="Rundown"><SelectValue /></SelectTrigger>
        <SelectContent className="rundown-choice-menu" position="popper" side="bottom" align="start" sideOffset={6} collisionPadding={12}>
          {items.map(item => <SelectItem key={itemKey(item)} value={itemKey(item)}>{item.kind === 'personal' ? 'My rundown' : item.name}</SelectItem>)}
        </SelectContent>
      </Select></div>}
      {selected && <RundownShareAction key={`${key}:${itemKey(selected)}`} item={selected} session={session} context={key} onPublished={published} onDenied={failed} />}
    </div>}
  </section>;
}
