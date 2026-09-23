import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { api } from '../lib/api';
import { activateNotification } from '../lib/notification-target';

export function Notifications({ session, onNotification }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const current = revision.current;
      return api('/notifications', { token: session.accessToken }).then((data) => { if (active && current === revision.current) { setItems(data.items); setUnread(data.unreadCount); } }).catch((err) => { if (active) setError(err.message); });
    };
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [session.accessToken]);
  async function read(item) {
    if (opening) return;
    setOpening(item.id); setError('');
    try {
      const openedBooking = await activateNotification(item, onNotification, api, session.accessToken);
      if (openedBooking) {
        revision.current += 1;
        setItems(rows => rows.filter(row => row.id !== item.id));
        if (!item.readAt) setUnread(count => Math.max(0, count - 1));
      } else if (!item.readAt) {
        revision.current += 1;
        setItems(rows => rows.map(row => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
        setUnread(count => Math.max(0, count - 1));
      }
      setOpen(false);
    }
    catch (err) { setError(err.message); }
    finally { setOpening(null); }
  }
  async function clearAll() {
    if (opening) return;
    setOpening('clear-all'); setError('');
    try {
      await api('/notifications', { token: session.accessToken, method: 'DELETE' });
      revision.current += 1; setItems([]); setUnread(0);
    } catch (err) { setError(err.message); }
    finally { setOpening(null); }
  }
  return <><Button type="button" variant="ghost" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen(true)} className="relative"><Bell size={19}/>{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{unread > 9 ? '9+' : unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent showCloseButton={false} className="max-h-[80vh] overflow-y-auto"><div className="flex items-center justify-between gap-4"><Button type="button" variant="ghost" onClick={clearAll} disabled={!items.length || Boolean(opening)}>Clear all</Button><DialogClose asChild><Button type="button" variant="ghost" aria-label="Close notifications"><X size={18} /></Button></DialogClose></div><DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Booking and guestlist updates appear here. Email and text delivery are not active yet.</DialogDescription></DialogHeader>{error && <p role="alert">{error}</p>}{opening && <p role="status">{opening === 'clear-all' ? 'Clearing notifications…' : 'Opening your booking…'}</p>}{items.length ? <div className="space-y-2">{items.map((item) => <button type="button" key={item.id} disabled={Boolean(opening)} onClick={() => read(item)} className={`w-full rounded-lg border p-3 text-left ${item.readAt ? 'opacity-70' : ''}`}><strong className="block">{item.title}</strong><span className="text-sm">{item.message}</span><small className="block opacity-70">{new Date(item.createdAt).toLocaleString()}{item.readAt ? '' : ' · Unread'}</small></button>)}</div> : <p>No notifications yet.</p>}</DialogContent></Dialog>
  </>;
}
