import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/lib/api';

export function EventPromoterInvite({ event, session, onUnauthorized }) {
  const [open,setOpen] = useState(false);
  const [email,setEmail] = useState('');
  const [phone,setPhone] = useState('');
  const [rate,setRate] = useState(0);
  const [pending,setPending] = useState([]);
  const [invitation,setInvitation] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [copied,setCopied] = useState(false);
  const base = `/business/events/${event.id}/invitations`;
  const load = async () => setPending(await api(base,session));
  const fail = (e) => { if(e.status === 401) onUnauthorized(); else setError(e.message); };
  async function start() { setOpen(true); setError(''); setInvitation(null); setRate(0); setBusy(true); try {await load();} catch(e) {fail(e);} finally {setBusy(false);} }
  async function invite(address, commissionBps = Math.round(rate*100), invitationPhone = phone) {
    setBusy(true);setError('');setCopied(false);setInvitation(null);
    try { setInvitation(await api(base,session,{method:'POST',body:JSON.stringify({email:address,phone:invitationPhone,commissionBps})}));setEmail('');setPhone('');await load(); }
    catch(e) {fail(e);} finally {setBusy(false);}
  }
  async function revoke(id) {
    setBusy(true);setError('');
    try {await api(`${base}/${id}`,session,{method:'DELETE'});setInvitation(null);await load();} catch(e) {fail(e);} finally {setBusy(false);}
  }
  const link = invitation ? `${window.location.origin}/?invite=${encodeURIComponent(invitation.token)}` : '';
  const mail = invitation ? `mailto:${encodeURIComponent(invitation.email)}?subject=${encodeURIComponent(`Promote ${event.title} on Nitewide`)}&body=${encodeURIComponent(`You're invited to promote ${event.title} at ${invitation.commissionBps/100}% commission on future referred ticket/package sales before fees. View your own sales, performance and referred guestlists for this event using your Nitewide account. This does not join the venue team.\n\nAccept your private invitation: ${link}\n\nExpires ${new Date(invitation.expiresAt).toLocaleString()}.`)}` : '';
  return <><Button size="sm" onClick={start}><Plus/> Add promoter</Button><Dialog open={open} onOpenChange={(value)=>{if(!busy)setOpen(value);}}><DialogContent className="event-person-dialog sm:max-w-lg"><DialogHeader><DialogTitle>Add promoter</DialogTitle><DialogDescription>Invite someone to {event.title} only—not the venue. They can sign in or register, then view their own sales, performance and referred guestlists.</DialogDescription></DialogHeader>
    <form className="event-person-form" onSubmit={(e)=>{e.preventDefault();invite(email);}}><label>Email address<Input type="email" required disabled={busy} maxLength={320} value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Phone (optional)<Input type="tel" inputMode="tel" autoComplete="off" disabled={busy} maxLength={32} value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="+1 407 555 0123" /></label><div className="commission-control"><div><label>Event commission</label><strong>{rate}%</strong></div><Slider aria-label="Invitation commission percentage" min={0} max={40} step={0.5} value={[rate]} onValueChange={([value])=>setRate(value)} disabled={busy}/><div className="commission-scale"><span>0%</span><span>40%</span></div><p className="hint">The promoter sees this rate before accepting. Applies to future referred ticket/package sales before fees; previous sales stay unchanged.</p></div><Button disabled={busy}>{busy?'Working…':'Create invitation'}</Button></form>
    {error && <p role="alert" className="error">{error}</p>}
    {invitation && <div className="event-person-form"><p role="status">Invitation ready for {invitation.email} at {invitation.commissionBps/100}% commission.</p><Input aria-label="Invitation link" readOnly value={link} onFocus={(e)=>e.target.select()}/><div className="event-people-actions"><Button variant="outline" onClick={async ()=>{try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setError('Copy the invitation link from the field above.');}}}>{copied?'Copied':'Copy link'}</Button><Button asChild variant="outline"><a href={mail}>Email invitation</a></Button></div><p className="hint">Email invitation opens your email app; send it there. Nitewide does not send email automatically yet. Only the invited email can accept.</p></div>}
    <div><h3>Pending invitations</h3>{pending.length ? <ul className="event-invitations">{pending.map((item)=><li key={item.id}><span>{item.email}<small>{item.commissionBps/100}%{item.phone ? ` · ${item.phone}` : ''} · Expires {new Date(item.expiresAt).toLocaleDateString()}</small></span><div className="event-people-actions"><Button size="sm" variant="outline" disabled={busy} onClick={()=>invite(item.email,item.commissionBps,item.phone)}>Renew link</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>revoke(item.id)}>Revoke</Button></div></li>)}</ul> : <p className="hint">No pending invitations.</p>}</div>
  </DialogContent></Dialog></>;
}
