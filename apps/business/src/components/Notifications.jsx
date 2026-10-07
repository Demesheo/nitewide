import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { ServerPager } from './ServerPager';

export function Notifications({ session, onNavigate, onMessage, onSupportMessage }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => api(`/notifications?page=${page}&pageSize=20`, session)
      .then((data) => { if (active) { setResult(data); setUnread(data.unreadCount); setError(''); } })
      .catch((err) => { if (active) setError(err.message); });
    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [session, page, refresh]);
  const reload = () => setRefresh((value) => value + 1);
  async function markRead(item) {
    if (item.readAt) return;
    await api(`/notifications/${item.id}/read`, session, { method: 'POST' });
    setResult((current) => ({ ...current, items: current.items.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row) }));
    setUnread((count) => Math.max(0, count - 1));
  }
  async function openItem(item) {
    try {
      await markRead(item);
      if (['support_message', 'support_status'].includes(item.kind) && item.metadata?.threadId) {
        setOpen(false); onSupportMessage?.(item.metadata.threadId);
      } else if (item.metadata?.threadId && onMessage) {
        setOpen(false); onMessage(item.metadata.threadId);
      } else if (item.eventId) {
        setOpen(false);
        onNavigate('events', item.eventId, item.metadata?.entryId,
          item.kind === 'guestlist_request' ? 'guestlist' : null);
      }
    } catch (err) { setError(err.message); }
  }
  async function dismiss(item) {
    setBusy(true); setError('');
    try { await api(`/notifications/${item.id}`, session, { method: 'DELETE' }); reload(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function clearAll() {
    if (!window.confirm('Mark all notifications as read and clear them from this inbox?')) return;
    setBusy(true); setError('');
    try { await api('/notifications', session, { method: 'DELETE' }); setPage(1); setUnread(0); reload(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <><Button type="button" variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
    onClick={() => setOpen(true)} className="relative"><Bell size={18}/>{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{unread > 9 ? '9+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifications</DialogTitle>
      <DialogDescription>Open an update to view its event or guestlist request.</DialogDescription></DialogHeader>
      <div className="notification-actions"><span>{unread.toLocaleString()} unread</span><Button size="sm" variant="outline" disabled={busy || !result?.total} onClick={clearAll}>Clear all</Button></div>
      {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={reload}>Try again</Button></div>}
      {result?.items.length ? <div className="space-y-2">{result.items.map((item) => <div key={item.id} className={`notification-row rounded-lg border border-border p-3 ${item.readAt ? 'opacity-70' : 'bg-secondary'}`}>
        <button type="button" onClick={() => openItem(item)} className="w-full text-left"><strong className="block">{item.title}</strong><span className="text-sm">{item.message}</span><small className="block text-muted-foreground">{new Date(item.createdAt).toLocaleString()}{item.readAt ? '' : ' · Unread'}</small></button>
        <div className="notification-row-actions">{!item.readAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => markRead(item).catch((err) => setError(err.message))}>Mark read</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss(item)}>Dismiss</Button></div></div>)}</div> : <p className="text-sm text-muted-foreground">No notifications on this page.</p>}
      <ServerPager result={result} page={page} onPageChange={setPage} disabled={busy} label="notifications"/>
    </DialogContent></Dialog>
  </>;
}
