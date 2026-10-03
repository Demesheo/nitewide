import { useEffect, useRef, useState } from 'react';
import { actionIdentity, forgetAction } from './action-identity';
import { CopyLinkButton } from './copy-link-button';
import { ManualCopyLink, useClipboardCopy } from './clipboard-copy';
import './support-messages.css';
import './booking-messages.css';

const categories = { admission: 'Admission', paid_booking: 'Booking problem', account_access: 'Account access', guestlist: 'Guestlist', referral: 'Referral', reporting: 'Report an issue', security: 'Security concern', other: 'Other' };
const time = value => value ? new Date(value).toLocaleString() : '';
export function recoveryFromLocation() {
  const match = typeof window !== 'undefined' && window.location.hash.match(/^#support-access=([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\.([a-f\d]{64})$/i);
  return match ? { id: match[1], token: match[2] } : null;
}
function recoverySecret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''); }
function pendingSecret() { try { const saved = sessionStorage.getItem('nitewide.support.pending-secret'); if (/^[a-f\d]{64}$/.test(saved || '')) return saved; } catch {} const token = recoverySecret(); try { sessionStorage.setItem('nitewide.support.pending-secret', token); } catch {} return token; }

// A panel shared by the app Messages dialog and the Admin Messages workspace.
export function SupportMessages({ session, source = 'customer', request, ui, admin = false, active = true, showHeading = true, initialContext, guestRecovery, initialThreadId, onOpened, onOpenCase, onUnreadChange, onBusyChange }) {
  const { Button } = ui;
  const [list, setList] = useState(null), [detail, setDetail] = useState(null), [selected, setSelected] = useState(guestRecovery?.id || null);
  const [recovery, setRecovery] = useState(guestRecovery || null), [composing, setComposing] = useState(!session && !guestRecovery);
  const [title, setTitle] = useState(''), [category, setCategory] = useState('other'), [body, setBody] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState('');
  const [page, setPage] = useState(1), [messagePage, setMessagePage] = useState(1), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  const [status, setStatus] = useState([]), [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [website, setWebsite] = useState('');
  const [attachContext, setAttachContext] = useState(false);
  const [loadErrorStatus, setLoadErrorStatus] = useState(null);
  const callbacks = useRef({ request, onUnreadChange }); callbacks.current = { request, onUnreadChange };
  const lock = useRef(false), secret = useRef(null), current = useRef(session?.accessToken); current.current = session?.accessToken;
  const mounted = useRef(true);
  const mutationController = useRef(null), identity = `${session?.accessToken || ''}:${source}:${guestRecovery?.id || ''}:${guestRecovery?.token || ''}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const [visibleFor, setVisibleFor] = useState(identity);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { mutationController.current?.abort(); lock.current = false; setBusy(false); setList(null); setDetail(null); setSelected(guestRecovery?.id || null); setRecovery(guestRecovery || null); setComposing(!session && !guestRecovery); setTitle(''); setCategory('other'); setBody(''); setName(''); setEmail(''); setError(''); setNotice(''); setPage(1); setMessagePage(1); setVisibleFor(identity); return () => mutationController.current?.abort(); }, [identity]);
  useEffect(() => { onBusyChange?.(busy); }, [busy]);
  useEffect(() => { const refresh = () => { if (!document.hidden && !lock.current) setRevision(value => value + 1); }; const timer = setInterval(refresh, 30000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh); }; }, []);
  const base = recovery ? `/support/access-requests` : admin ? '/admin/support/messages' : '/support/messages';
  const headers = recovery ? { 'X-Support-Recovery-Token': recovery.token } : undefined;
  const copy = useClipboardCopy(recovery?.id);
  const recoveryLink = recovery ? `${window.location.origin}${window.location.pathname}#support-access=${recovery.id}.${recovery.token}` : '';
  useEffect(() => { if (initialThreadId) { setSelected(initialThreadId); setDetail(null); setComposing(false); setMessagePage(1); onOpened?.(); } }, [initialThreadId]);
  useEffect(() => {
    const controller = new AbortController();
    if (!active || (!session && !recovery)) return;
    setLoading(true); setError(''); setLoadErrorStatus(null);
    if (!selected) setList(null);
    const path = selected ? `${base}/${encodeURIComponent(selected)}?page=${messagePage}&pageSize=30` : `${base}?page=${page}&pageSize=20${admin && status.length ? `&status=${encodeURIComponent(status.join(','))}` : ''}${admin && appliedSearch ? `&search=${encodeURIComponent(appliedSearch)}` : ''}`;
    callbacks.current.request(path, { headers, signal: controller.signal }).then(async result => {
      if (controller.signal.aborted || identityRef.current !== identity) return;
      if (selected) {
        if (!result?.thread || !Array.isArray(result.messages?.items)) throw new Error('Unable to open this conversation.');
        setDetail(result);
        const messageId = result.messages.items.at(-1)?.id;
        if (messageId && messagePage === 1) {
          await callbacks.current.request(`${base}/${selected}/read`, { method: 'POST', body: { messageId }, headers, signal: controller.signal });
          if (!recovery && callbacks.current.onUnreadChange && !controller.signal.aborted) {
            const inbox = await callbacks.current.request(`${base}?page=1&pageSize=1`, { signal: controller.signal });
            if (!controller.signal.aborted && identityRef.current === identity) callbacks.current.onUnreadChange(inbox.unreadCount || 0);
          }
        }
      } else { if (!Array.isArray(result?.items)) throw new Error('Unable to load support messages.'); setList(result); callbacks.current.onUnreadChange?.(result.unreadCount); }
    }).catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoadErrorStatus(err.status || null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session?.accessToken, recovery?.id, recovery?.token, identity, selected, base, page, messagePage, revision, status, appliedSearch, active]);
  async function submit(event) {
    event.preventDefault(); if (lock.current || body.trim().length < 3 || (!selected && session && title.trim().length < 3)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const token = session?.accessToken, attemptIdentity = identity;
    const controller = new AbortController(); mutationController.current = controller;
    const guestCreate = !session && !recovery;
    const scope = `support.${session?.user?.id || 'guest'}.${selected || 'new'}`;
    const payload = selected ? { body: body.trim() } : guestCreate ? { name: name.trim(), email: email.trim(), body: body.trim(), website, recoveryToken: secret.current ||= pendingSecret() } : { source, title: title.trim(), category, body: body.trim(), ...(attachContext ? Object.fromEntries(Object.entries(initialContext || {}).filter(([key, value]) => ['eventId', 'orderId', 'organizationId'].includes(key) && value)) : {}) };
    try {
      const result = await callbacks.current.request(selected ? `${base}/${selected}/replies` : guestCreate ? '/support/access-requests' : '/support/requests', { method: 'POST', headers, signal: controller.signal, body: { ...payload, idempotencyKey: actionIdentity(scope, payload) } });
      if (!mounted.current || controller.signal.aborted || identityRef.current !== attemptIdentity || current.current !== token) return;
      forgetAction(scope); setBody(''); setComposing(false); setNotice(admin ? 'Reply sent privately to the requester.' : 'Message sent. Nitewide replies appear here.');
      if (guestCreate) { const next = { id: result.id, token: result.recoveryToken }; setRecovery(next); setSelected(next.id); window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#support-access=${next.id}.${next.token}`); try { sessionStorage.removeItem('nitewide.support.pending-secret'); } catch {} }
      else { setDetail(result); setSelected(result.thread.id); }
      setRevision(value => value + 1);
    } catch (err) { if (mounted.current && !controller.signal.aborted && identityRef.current === attemptIdentity && current.current === token) setError(err.message); }
    finally { if (mutationController.current === controller) { lock.current = false; if (mounted.current && identityRef.current === attemptIdentity) setBusy(false); } }
  }
  const thread = detail?.thread;
  const recoveryUnavailable = Boolean(recovery && !thread && !loading && error && [404,410].includes(loadErrorStatus));
  if (visibleFor !== identity) return null;
  return <section className="support-messages" aria-busy={busy || loading}>
    {showHeading && <h2>{admin ? 'Nitewide support messages' : 'Contact Nitewide'}</h2>}
    <p className="booking-message-help">{admin ? 'Review customer, business, and account-access messages. Replies are private to the requester; open the linked support case to manage its status.' : recovery ? 'Your private account-access conversation with Nitewide.' : session ? 'Private messages with Nitewide. Organizer conversations and refund requests stay in Organizer messages.' : 'Help with signing in or accessing your account. Sign in for other support questions.'}</p>
    {error && <p role="alert" className="booking-message-error">{error} <Button variant="outline" type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Retry loading</Button></p>}
    {notice && <p role="status">{notice}</p>}
    {admin && !selected && <form className="support-filter" onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()); setPage(1); }}><fieldset><legend>Case status (all when none selected)</legend>{['open','in_progress','resolved','closed'].map(value => <label key={value}><input type="checkbox" checked={status.includes(value)} onChange={event => { const checked = event.target.checked; setStatus(previous => checked ? [...previous,value] : previous.filter(item => item !== value)); setList(null); setPage(1); }}/>{value.replaceAll('_',' ')}</label>)}</fieldset><label>Search support messages<input value={search} maxLength={180} onChange={event => setSearch(event.target.value)}/></label><Button type="submit">Search</Button></form>}
    {admin && thread && <div className="support-recovery"><p>{thread.requesterName || thread.contactName || 'Requester'}{thread.contactEmail ? ` · ${thread.contactEmail}` : ''}</p>{thread.contactVerified === false || thread.source === 'account_access' ? <p>Unverified identity. Submitted email does not establish account ownership.</p> : null}{thread.caseId && onOpenCase && <Button variant="outline" onClick={() => onOpenCase(thread.caseId)}>Open support case</Button>}</div>}
    {recovery && !recoveryUnavailable && <div className="support-recovery"><p>Save your private link to read replies. It expires 90 days after your request. Anyone with it can access this conversation; it does not sign you in or verify account ownership.</p><CopyLinkButton component={Button} copied={copied} label="Copy private recovery link" onClick={() => { copy.copy(recoveryLink).then(() => setCopied(true)).catch(err => setError(err.message)); }} /><ManualCopyLink link={copy.manualLink}/></div>}
    {selected && <>{!recovery && <Button variant="ghost" disabled={busy} onClick={() => { setSelected(null); setDetail(null); setBody(''); setMessagePage(1); }}>← All support messages</Button>}{thread && <><h3>{thread.title}</h3><p className="support-status">{categories[thread.category] || 'Account access'} · {thread.status?.replaceAll('_', ' ')}{thread.eventTitle ? ` · ${thread.eventTitle}` : ''}{thread.organizationName ? ` · ${thread.organizationName}` : ''}</p><div className="booking-message-history" aria-label="Support conversation">{detail.messages.items.map(message => <article className="booking-message" key={message.id}><div className="booking-message-meta"><strong>{message.senderName}</strong> · {time(message.createdAt)}</div><p className="booking-message-body">{message.body}</p></article>)}</div>{detail.messages.hasMore && <Button variant="outline" disabled={loading} onClick={() => setMessagePage(value => value + 1)}>Older messages</Button>}{messagePage > 1 && <Button variant="ghost" onClick={() => setMessagePage(1)}>Latest messages</Button>}</>}</>}
    {loading && <p role="status">Loading support messages…</p>}
    {!selected && !composing && <><div className="booking-thread-list">{list?.items.map(row => <button className="booking-thread" type="button" key={row.id} data-unread={row.unread} onClick={() => { setSelected(row.id); setDetail(null); setBody(''); }}><strong>{row.title}{row.unread ? ' · Unread' : ''}</strong>{admin && <span>{row.requesterName || row.contactName || 'Requester'} · {row.source?.replaceAll('_',' ')}{row.contactEmail ? ` · ${row.contactEmail}` : ''}{row.contactVerified === false ? ' · Unverified identity' : ''}</span>}<span>{row.status?.replaceAll('_', ' ')}</span><span>{row.lastMessagePreview}</span><small>{time(row.lastMessageAt)}</small></button>)}{list && !list.items.length && <p>No support conversations yet.</p>}</div>{list?.total > 20 && <div className="booking-message-actions"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!list.hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>}{!admin && <Button type="button" onClick={() => setComposing(true)}>Report an issue</Button>}</>}
    {(composing || (selected && detail?.canReply)) && <form className="booking-message-form" onSubmit={submit}>
      {composing && session && (initialContext?.eventTitle || initialContext?.organizationName) && <label className="support-context"><input type="checkbox" checked={attachContext} disabled={busy} onChange={event => setAttachContext(event.target.checked)}/>Include {initialContext.orderId ? 'this booking for ' : ''}{initialContext.eventTitle || initialContext.organizationName}</label>}
      {!session && !recovery && <label className="support-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)}/></label>}
      {composing && <>{session ? <><label>Subject<input required minLength={3} maxLength={160} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>Issue category<select value={category} disabled={busy} onChange={event => setCategory(event.target.value)}>{Object.entries(categories).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{initialContext?.eventTitle && <p>Event: {initialContext.eventTitle}</p>}</> : <><label>Your name<input autoComplete="name" required maxLength={120} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label><label>Email<input type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label><p className="booking-message-help">Replies are available through your private recovery link. Your email does not grant access to an account.</p></>}</>}
      <label>{selected ? 'Your reply' : 'Describe the issue'}<textarea required minLength={3} maxLength={2000} disabled={busy} value={body} onChange={event => setBody(event.target.value)} /></label>
      <div className="booking-message-actions"><Button type="submit" disabled={busy || body.trim().length < 3 || (composing && session && title.trim().length < 3)}>{busy ? 'Sending…' : selected ? 'Send reply' : 'Send to Nitewide'}</Button>{composing && session && <Button variant="ghost" type="button" disabled={busy} onClick={() => setComposing(false)}>Back to support messages</Button>}</div>
    </form>}
    {selected && thread && !detail.canReply && <p>{['resolved', 'closed'].includes(thread.status) ? admin ? 'This conversation is closed. Open its linked support case to manage the status.' : 'This conversation is closed. Start a new support request if you need more help.' : 'Your role can view this conversation but cannot send replies.'}</p>}
    {recovery && (['resolved','closed'].includes(thread?.status) || recoveryUnavailable) && <>{thread && <p className="booking-message-help">Save the current recovery link first if you want to return to this conversation.</p>}<Button type="button" variant="outline" disabled={busy} onClick={() => { setRecovery(null); setSelected(null); setDetail(null); setComposing(true); setBody(''); setTitle(''); setCategory('account_access'); setName(''); setEmail(''); setWebsite(''); setNotice(''); setError(''); setLoadErrorStatus(null); setLoading(false); setMessagePage(1); setCopied(false); secret.current = null; forgetAction(`support.${session?.user?.id || 'guest'}.new`); try { sessionStorage.removeItem('nitewide.support.pending-secret'); } catch {} const url = new URL(window.location.href); if (url.hash.startsWith('#support-access=')) { url.hash = ''; window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`); } }}>{session ? 'Start a new support request' : 'Start a new account-access request'}</Button></>}
  </section>;
}

export function ContactNitewide({ session, source, request, ui }) {
  const { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } = ui;
  const [recovery, setRecovery] = useState(recoveryFromLocation), [open, setOpen] = useState(Boolean(recovery)), [busy, setBusy] = useState(false);
  return <><Button variant="ghost" type="button" className="contact-nitewide-link" onClick={() => { const saved = recoveryFromLocation(); if (session && !saved) window.dispatchEvent(new CustomEvent('nitewide:contact-support')); else { setRecovery(saved); setOpen(true); } }}>Contact Nitewide</Button><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="booking-messages-dialog" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Contact Nitewide</DialogTitle><DialogDescription>Private account-access support.</DialogDescription></DialogHeader><SupportMessages key={session?.accessToken || 'guest'} session={session} source={source} request={request} ui={ui} guestRecovery={recovery} showHeading={false} onBusyChange={setBusy}/></DialogContent></Dialog></>;
}
