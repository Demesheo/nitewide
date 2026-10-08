import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { ServerPager } from './ServerPager';

export function Notifications({ session, onNavigate, onMessage, onSupportMessage, refreshKey = 0, request = api }) {
  const token = session?.accessToken;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [visibleFor, setVisibleFor] = useState(token);
  const currentToken = useRef(token), callbacks = useRef({ session, request });
  const revision = useRef(0), mutation = useRef(null), previousRefreshKey = useRef(refreshKey);
  currentToken.current = token; callbacks.current = { session, request };
  useEffect(() => {
    revision.current += 1; mutation.current?.abort(); mutation.current = null;
    setOpen(false); setPage(1); setResult(null); setUnread(0); setError(''); setBusy(false); setVisibleFor(token);
    return () => { mutation.current?.abort(); };
  }, [token]);
  useEffect(() => {
    if (previousRefreshKey.current === refreshKey) return;
    previousRefreshKey.current = refreshKey;
    setPage(1); setRefresh(value => value + 1);
  }, [refreshKey]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController(), current = ++revision.current;
    Promise.resolve().then(() => {
      if (!controller.signal.aborted && currentToken.current === token) return callbacks.current.request(`/notifications?page=${page}&pageSize=20`, callbacks.current.session, { signal: controller.signal });
    }).then(data => {
      if (controller.signal.aborted || currentToken.current !== token || revision.current !== current) return;
      if (!Array.isArray(data?.items)) throw new Error('We couldn’t load notifications. Please try again.');
      setResult(data); setUnread(data.unreadCount || 0); setError('');
    }).catch(err => { if (!controller.signal.aborted && currentToken.current === token && revision.current === current) setError(err.message); });
    return () => controller.abort();
  }, [token, page, refresh]);
  const reload = () => setRefresh((value) => value + 1);
  async function markRead(item) {
    if (!token || mutation.current) return false;
    if (item.readAt) return true;
    const controller = new AbortController(); mutation.current = controller; setBusy(true);
    try {
      await callbacks.current.request(`/notifications/${item.id}/read`, session, { method: 'POST', signal: controller.signal });
      if (controller.signal.aborted || currentToken.current !== token) return false;
      revision.current += 1;
      setResult(current => current ? { ...current, items: current.items.map(row => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row) } : current);
      setUnread(count => Math.max(0, count - 1));
      return true;
    } finally {
      if (mutation.current === controller) { mutation.current = null; if (currentToken.current === token) setBusy(false); }
    }
  }
  async function openItem(item) {
    try {
      if (!await markRead(item) || currentToken.current !== token) return;
      if (['support_message', 'support_status'].includes(item.kind) && item.metadata?.threadId) {
        setOpen(false); onSupportMessage?.(item.metadata.threadId);
      } else if (item.metadata?.threadId && onMessage) {
        setOpen(false); onMessage(item.metadata.threadId);
      } else if (item.eventId) {
        setOpen(false);
        onNavigate('events', item.eventId, item.metadata?.entryId,
          item.kind === 'guestlist_request' ? 'guestlist' : null);
      }
    } catch (err) { if (currentToken.current === token) setError(err.message); }
  }
  async function dismiss(item) {
    if (!token || mutation.current) return;
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true); setError('');
    try { await callbacks.current.request(`/notifications/${item.id}`, session, { method: 'DELETE', signal: controller.signal }); if (!controller.signal.aborted && currentToken.current === token) { revision.current += 1; reload(); } }
    catch (err) { if (!controller.signal.aborted && currentToken.current === token) setError(err.message); }
    finally { if (mutation.current === controller) { mutation.current = null; if (currentToken.current === token) setBusy(false); } }
  }
  async function clearAll() {
    if (!token || mutation.current) return;
    if (!window.confirm('Mark all notifications as read and clear them from this inbox?')) return;
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true); setError('');
    try { await callbacks.current.request('/notifications', session, { method: 'DELETE', signal: controller.signal }); if (!controller.signal.aborted && currentToken.current === token) { revision.current += 1; setPage(1); setUnread(0); reload(); } }
    catch (err) { if (!controller.signal.aborted && currentToken.current === token) setError(err.message); }
    finally { if (mutation.current === controller) { mutation.current = null; if (currentToken.current === token) setBusy(false); } }
  }
  if (!token || visibleFor !== token) return null;
  return <><Button type="button" variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
    onClick={() => { setPage(1); reload(); setOpen(true); }} className="relative"><Bell size={18}/>{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{unread > 9 ? '9+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifications</DialogTitle>
      <DialogDescription>Open an update to view its event or guestlist request.</DialogDescription></DialogHeader>
      <div className="notification-actions"><span>{unread.toLocaleString()} unread</span><Button size="sm" variant="outline" disabled={busy} onClick={reload}>Reload notifications</Button><Button size="sm" variant="outline" disabled={busy || !result?.total} onClick={clearAll}>Clear all</Button></div>
      {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={reload}>Try again</Button></div>}
      {result?.items.length ? <div className="space-y-2">{result.items.map((item) => <div key={item.id} className={`notification-row rounded-lg border border-border p-3 ${item.readAt ? 'opacity-70' : 'bg-secondary'}`}>
        <button type="button" disabled={busy} onClick={() => openItem(item)} className="w-full text-left"><strong className="block">{item.title}</strong><span className="text-sm">{item.message}</span><small className="block text-muted-foreground">{new Date(item.createdAt).toLocaleString()}{item.readAt ? '' : ' · Unread'}</small></button>
        <div className="notification-row-actions">{!item.readAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => markRead(item).catch((err) => { if (currentToken.current === token) setError(err.message); })}>Mark read</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss(item)}>Dismiss</Button></div></div>)}</div> : <p className="text-sm text-muted-foreground">No notifications on this page.</p>}
      <ServerPager result={result} page={page} onPageChange={setPage} disabled={busy} label="notifications"/>
    </DialogContent></Dialog>
  </>;
}
