import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';

export function Notifications({ session, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => api('/notifications', session).then((data) => { if (active) { setItems(data.items); setUnread(data.unreadCount); setError(''); } }).catch((err) => { if (active) setError(err.message); });
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [session]);
  async function read(item) {
    try { if (!item.readAt) { await api(`/notifications/${item.id}/read`, session, { method: 'POST' }); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)); setUnread((count) => Math.max(0, count - 1)); } if (item.eventId) { setOpen(false); onNavigate(item.kind === 'guestlist_request' ? 'guestlists' : 'events', item.eventId, item.metadata?.entryId); } }
    catch (err) { setError(err.message); }
  }
  return <><Button type="button" variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen(true)} className="relative"><Bell size={18}/>{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{unread > 9 ? '9+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Open an update to view its event or guestlist request. Email and text delivery are not active yet.</DialogDescription></DialogHeader>{error && <p role="alert" className="error">{error}</p>}{items.length ? <div className="space-y-2">{items.map((item) => <button type="button" key={item.id} onClick={() => read(item)} className={`w-full rounded-lg border border-border p-3 text-left ${item.readAt ? 'opacity-70' : 'bg-secondary'}`}><strong className="block">{item.title}</strong><span className="text-sm">{item.message}</span><small className="block text-muted-foreground">{new Date(item.createdAt).toLocaleString()}{item.readAt ? '' : ' · Unread'}</small></button>)}</div> : <p className="text-sm text-muted-foreground">No notifications yet.</p>}</DialogContent></Dialog>
  </>;
}
