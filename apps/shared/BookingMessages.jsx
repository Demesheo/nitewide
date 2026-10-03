import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { actionIdentity, forgetAction } from './action-identity';
import './booking-messages.css';
import { SupportMessages } from './SupportMessages';

const timestamp = value => value ? new Date(value).toLocaleString() : '';
const requestLabel = kind => kind === 'cancellation' ? 'Cancellation request' : kind === 'refund' ? 'Refund request' : 'Question';

export function BookingMessages({ session, side, request, ui, initialBooking, initialThreadId, initialSupportThreadId, onSupportOpened, onOpened, supportContext }) {
  const token = session?.accessToken;
  const { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } = ui;
  const [open, setOpen] = useState(false), [list, setList] = useState(null), [detail, setDetail] = useState(null);
  const [view, setView] = useState('organizer');
  const [supportBusy, setSupportBusy] = useState(false), [supportUnread, setSupportUnread] = useState(0);
  const [supportTarget, setSupportTarget] = useState(null);
  const supportCountRevision = useRef(0);
  useEffect(() => { const contact = () => { setView('support'); setOpen(true); }; window.addEventListener('nitewide:contact-support', contact); return () => window.removeEventListener('nitewide:contact-support', contact); }, []);
  const [selected, setSelected] = useState(null), [booking, setBooking] = useState(null);
  const [page, setPage] = useState(1), [messagePage, setMessagePage] = useState(1), [revision, setRevision] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(false);
  const [body, setBody] = useState(''), [kind, setKind] = useState('question'), [decision, setDecision] = useState(''), [reason, setReason] = useState('');
  const requestRef = useRef(request), mutation = useRef(false), mounted = useRef(true), currentToken = useRef(token), mutationController = useRef(null);
  const [visibleFor, setVisibleFor] = useState(token);
  requestRef.current = request;
  currentToken.current = token;
  const base = `/${side}/messages`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    mutationController.current?.abort(); mutation.current = false;
    setOpen(false); setList(null); setDetail(null); setSelected(null); setBooking(null); setBody(''); setKind('question'); setDecision(''); setReason(''); setError(''); setNotice(''); setBusy(''); setLoading(false); setPage(1); setMessagePage(1); setVisibleFor(token);
    setSupportUnread(0); setSupportBusy(false); setView('organizer'); setSupportTarget(null);
    return () => mutationController.current?.abort();
  }, [token]);
  useEffect(() => { if (token && initialSupportThreadId) { setSupportTarget(initialSupportThreadId); setView('support'); setOpen(true); onSupportOpened?.(); } }, [token, initialSupportThreadId]);
  useEffect(() => {
    if (!token || (!initialBooking && !initialThreadId)) return;
    setView('organizer'); setBooking(initialBooking || null); setSelected(initialThreadId || null); setDetail(null); setBody(''); setKind('question'); setError(''); setNotice(''); setOpen(true); onOpened?.();
  }, [initialBooking, initialThreadId, token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await requestRef.current(`${base}?page=${page}&pageSize=20`, { signal: controller.signal });
        if (!Array.isArray(result?.items)) throw new Error('We couldn’t load messages. Please try again.');
        if (!controller.signal.aborted && currentToken.current === token) setList(result);
        try {
          const countRevision = supportCountRevision.current;
          const support = await requestRef.current('/support/messages?page=1&pageSize=1', { signal: controller.signal });
          if (!controller.signal.aborted && currentToken.current === token && supportCountRevision.current === countRevision) setSupportUnread(support?.unreadCount || 0);
        } catch { /* Support unread counts must not block organizer conversations. */ }
      } catch (err) { if (!controller.signal.aborted && currentToken.current === token && open && !selected && !booking) setError(err.message); }
    }
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const focus = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [base, token, page, revision, open]);
  useEffect(() => {
    if (!token || !open || !selected || view !== 'organizer') return;
    const controller = new AbortController();
    setLoading(true); setError('');
    requestRef.current(`${base}/${encodeURIComponent(selected)}?page=${messagePage}&pageSize=30`, { signal: controller.signal }).then(async result => {
      if (controller.signal.aborted || currentToken.current !== token) return;
      if (!result?.thread || !Array.isArray(result.messages?.items)) throw new Error('We couldn’t open this conversation. Please try again.');
      setDetail(result);
      await requestRef.current(`${base}/${encodeURIComponent(selected)}/read`, { method: 'POST', body: {}, signal: controller.signal });
      if (!controller.signal.aborted && currentToken.current === token) setList(current => current ? { ...current, unreadCount: Math.max(0, current.unreadCount - Number(Boolean(current.items.find(row => row.id === selected)?.unread))), items: current.items.map(row => row.id === selected ? { ...row, unread: false } : row) } : current);
    }).catch(err => { if (!controller.signal.aborted && currentToken.current === token) setError(err.message); }).finally(() => { if (!controller.signal.aborted && currentToken.current === token) setLoading(false); });
    return () => controller.abort();
  }, [base, token, selected, open, messagePage, revision, view]);
  function openThread(row) { setSelected(row.id); setBooking(null); setDetail(null); setMessagePage(1); setBody(''); setKind('question'); setError(''); setNotice(''); setDecision(''); }
  async function send(event) {
    event.preventDefault(); if (!token || mutation.current || !body.trim()) return;
    const scope = `message.${session.user.id}.${side}.${selected || booking.orderId}.${kind}`;
    const payload = { body: body.trim(), ...(selected && kind === 'question' ? {} : { kind }) };
    const path = selected && kind === 'question' ? `${base}/${selected}/replies` : `/customer/orders/${detail?.thread.orderId || booking.orderId}/messages`;
    const controller = new AbortController(); mutationController.current = controller;
    mutation.current = true; setBusy('send'); setError(''); setNotice('');
    try {
      const result = await requestRef.current(path, { method: 'POST', body: { ...payload, idempotencyKey: actionIdentity(scope, payload) }, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || currentToken.current !== token) return;
      forgetAction(scope); setDetail(result); setSelected(result.thread.id); setBooking(null); setBody(''); setKind('question'); setNotice(payload.kind && payload.kind !== 'question' ? 'Request sent. Your booking remains active while the organizer reviews it.' : 'Message sent. The organizer’s reply will appear here.'); setRevision(value => value + 1);
    } catch (err) { if (mounted.current && !controller.signal.aborted && currentToken.current === token) setError(err.message); }
    finally { if (mutationController.current === controller) { mutation.current = false; if (mounted.current && currentToken.current === token) setBusy(''); } }
  }
  async function resolve(event) {
    event.preventDefault();
    if (!token) return;
    const recovering = detail.thread.refundRequest?.status === 'approved';
    const saved = detail.thread.refundRequest;
    if (mutation.current || (!recovering && (!decision || reason.trim().length < 3))) return;
    if (recovering && (!saved.decisionKey || typeof saved.resolution !== 'string')) { setError('The saved refund approval is unavailable. Refresh the conversation before retrying.'); return; }
    const scope = `refund-resolution.${session.user.id}.${detail.thread.orderId}`;
    const payload = recovering ? { decision: 'approve', reason: saved.resolution } : { decision, reason: reason.trim() };
    const controller = new AbortController(); mutationController.current = controller;
    mutation.current = true; setBusy('resolve'); setError('');
    try {
      const result = await requestRef.current(`/business/orders/${detail.thread.orderId}/refund-request`, { method: 'PATCH', body: { ...payload, idempotencyKey: recovering ? saved.decisionKey : actionIdentity(scope, payload) }, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || currentToken.current !== token) return;
      forgetAction(scope); setDetail(current => ({ ...current, canResolveRefund: false, thread: { ...current.thread, refundRequest: result.request } })); setDecision(''); setReason(''); setNotice(decision === 'deny' ? 'Request denied. Your response is visible to the customer.' : 'Refund approved. Stripe confirmation determines the final refund and booking status.'); setRevision(value => value + 1);
    } catch (err) { if (mounted.current && !controller.signal.aborted && currentToken.current === token) setError(err.message); }
    finally { if (mutationController.current === controller) { mutation.current = false; if (mounted.current && currentToken.current === token) setBusy(''); } }
  }
  const thread = detail?.thread, refund = thread?.refundRequest;
  const canRequest = side === 'customer' && (selected ? detail?.canRequestRefund : booking?.canRequestRefund);
  const composing = Boolean(booking || selected);
  if (!token || visibleFor !== token) return null;
  const unread = (list?.unreadCount || 0) + supportUnread;
  return <><Button type="button" variant="ghost" size="icon" className="booking-message-trigger" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`} onClick={() => { setOpen(true); setPage(1); setRevision(value => value + 1); }}><MessageSquare size={19} aria-hidden="true" />{unread > 0 && <span className="booking-message-count">{unread > 9 ? '9+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={value => { if (!mutation.current && !supportBusy) setOpen(value); }}><DialogContent className="booking-messages-dialog" showCloseButton={!busy && !supportBusy} onEscapeKeyDown={event => { if (busy || supportBusy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy || supportBusy) event.preventDefault(); }} aria-busy={Boolean(busy || loading || supportBusy)}>
      <DialogHeader><DialogTitle>{view === 'organizer' && composing ? thread?.eventTitle || booking?.eventTitle || 'Booking conversation' : 'Messages'}</DialogTitle><DialogDescription>Private conversations with organizers and the Nitewide team.</DialogDescription></DialogHeader>
      <div className="support-tabs" role="group" aria-label="Message inbox"><Button variant={view === 'organizer' ? 'default' : 'outline'} disabled={Boolean(busy || supportBusy)} onClick={() => setView('organizer')}>Organizer messages</Button><Button variant={view === 'support' ? 'default' : 'outline'} disabled={Boolean(busy || supportBusy)} onClick={() => setView('support')}>Nitewide support{supportUnread ? ` · ${supportUnread} unread` : ''}</Button></div>
      <div hidden={view !== 'support'}><SupportMessages key={token} session={session} source={side} active={open && view === 'support'} request={request} ui={ui} initialThreadId={supportTarget} onOpened={() => setSupportTarget(null)} onUnreadChange={count => { supportCountRevision.current += 1; setSupportUnread(count); }} initialContext={booking ? { orderId: booking.orderId, eventId: booking.eventId, eventTitle: booking.eventTitle } : detail?.thread ? { orderId: detail.thread.orderId, eventId: detail.thread.eventId, eventTitle: detail.thread.eventTitle, organizationName: detail.thread.organizationName } : supportContext} onBusyChange={setSupportBusy} /></div>
      {view === 'organizer' && <>
      {error && <div className="booking-message-error" role="alert">{error} <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}>Refresh messages</Button></div>}{notice && <p role="status">{notice}</p>}
      {composing ? <><Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => { setBooking(null); setSelected(null); setDetail(null); setError(''); setNotice(''); }}>← All messages</Button>
        {loading && !detail && <p role="status">Opening conversation…</p>}
        {refund && <div className="booking-message-request"><strong>{requestLabel(refund.kind)} · {refund.status.replaceAll('_', ' ')}</strong><small>Requested {timestamp(refund.requestedAt)}</small><p>{refund.reason}</p>{refund.resolution && <p>{typeof refund.resolution === 'string' ? refund.resolution : refund.resolution.reason}</p>}<p className="booking-message-help">Refunds are at the organizer’s discretion. Sending a request does not cancel admission or guarantee a refund.</p></div>}
        {detail && <div className="booking-message-history" aria-label="Conversation">{detail.messages.items.map(message => <article key={message.id} className="booking-message" data-side={message.senderSide}><div className="booking-message-meta"><strong>{message.senderName}</strong> · {timestamp(message.createdAt)}{message.kind !== 'question' && message.kind !== 'reply' ? ` · ${requestLabel(message.kind)}` : ''}</div><p className="booking-message-body">{message.body}</p></article>)}{detail.messages.hasMore && <Button variant="outline" disabled={loading} onClick={() => setMessagePage(value => value + 1)}>Older messages</Button>}{messagePage > 1 && <Button variant="ghost" onClick={() => setMessagePage(1)}>Latest messages</Button>}</div>}
        {side === 'business' && detail?.canResolveRefund && ['pending', 'approved'].includes(refund?.status) && <form className="booking-message-resolution" onSubmit={resolve}>{refund.status === 'approved' ? <><strong>Approved refund needs completion</strong><p className="booking-message-help">Retry the saved approval to check or complete the same refund with Stripe. The original decision and reason are preserved.</p><Button type="submit" disabled={Boolean(busy)}>{busy === 'resolve' ? 'Checking approved refund…' : 'Retry approved refund'}</Button></> : <><strong>Review {requestLabel(refund.kind).toLowerCase()}</strong><p className="booking-message-help">Approval requests a full refund through the booking’s original merchant. Confirm the decision and explain it to the customer.</p><div className="booking-message-actions"><Button type="button" variant={decision === 'deny' ? 'default' : 'outline'} disabled={Boolean(busy)} onClick={() => setDecision('deny')}>Deny request</Button><Button type="button" variant={decision === 'approve' ? 'default' : 'outline'} disabled={Boolean(busy)} onClick={() => setDecision('approve')}>Approve refund</Button></div>{decision && <><label>Reason for your decision<textarea required minLength={3} maxLength={500} value={reason} disabled={Boolean(busy)} onChange={event => setReason(event.target.value)} /></label><Button type="submit" disabled={Boolean(busy) || reason.trim().length < 3}>{busy === 'resolve' ? 'Saving decision…' : `Confirm ${decision === 'approve' ? 'refund approval' : 'denial'}`}</Button></>}</>}</form>}
        {(booking || detail?.canReply) && <form className="booking-message-form" onSubmit={send}>{side === 'customer' && <><p className="booking-message-help">Purchases are generally nonrefundable. The organizer may approve an exception. New refund or cancellation requests must reach the organizer before the event begins; questions and replies remain available afterward.</p>{canRequest && <label>Message type<select value={kind} disabled={Boolean(busy)} onChange={event => setKind(event.target.value)}><option value="question">Question</option><option value="refund">Request refund</option><option value="cancellation">Request cancellation</option></select></label>}</>}<label htmlFor={`booking-message-${side}`}>{kind === 'question' ? 'Your message' : 'Reason for your request'}<textarea id={`booking-message-${side}`} required maxLength={2000} value={body} disabled={Boolean(busy)} onChange={event => setBody(event.target.value)} placeholder={side === 'business' ? 'Reply to the customer…' : 'Ask your event organizer…'} /></label><div className="booking-message-actions"><Button type="submit" disabled={Boolean(busy) || !body.trim()}>{busy === 'send' ? 'Sending…' : kind === 'question' ? 'Send message' : `Send ${requestLabel(kind).toLowerCase()}`}</Button></div></form>}
      </> : <><div className="booking-thread-list">{list?.items.map(row => <button type="button" className="booking-thread" data-unread={Boolean(row.unread)} key={row.id} onClick={() => openThread(row)}><strong>{row.eventTitle}{row.unread ? ' · Unread' : ''}</strong><span>{side === 'business' ? row.customerName : row.organizationName}</span><span>{row.lastMessagePreview}</span><small>{timestamp(row.lastMessageAt)}{row.refundRequest ? ` · ${requestLabel(row.refundRequest.kind)} ${row.refundRequest.status}` : ''}</small></button>)}{list && !list.items.length && <p>No conversations yet.{side === 'customer' ? ' Open a booking and select Contact organizer to start one.' : ' Customer booking questions will appear here.'}</p>}{!list && !error && <p role="status">Loading messages…</p>}</div>{list?.total > 20 && <div className="booking-message-actions"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous conversations</Button><span>Page {page}</span><Button variant="outline" disabled={!list.hasMore} onClick={() => setPage(value => value + 1)}>Next conversations</Button></div>}</>}
      </>}
    </DialogContent></Dialog>
  </>;
}
