import { useState } from 'react';
import { Copy, BookmarkPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { saveEventTemplate } from '@/lib/event-reuse';

export function EventReuseActions({ event, session, onDuplicate, onSaved }) {
  const [open, setOpen] = useState(false);
  const [copyOfferings, setCopyOfferings] = useState(true);
  const [copyImage, setCopyImage] = useState(false);
  const [copyTeam, setCopyTeam] = useState(false);
  const [copyAllocations, setCopyAllocations] = useState(false);
  const [error, setError] = useState('');
  function saveTemplate() {
    try { saveEventTemplate(session.user.id, event); onSaved('Template saved on this device. It contains event setup only, not attendees or message history.'); }
    catch { setError('This device could not save the template. Check available browser storage.'); }
  }
  return <><details className="event-secondary-actions"><summary>More event actions</summary><div className="event-reuse-actions"><Button variant="outline" onClick={() => setOpen(true)}><Copy size={16}/>Duplicate</Button>
    <Button variant="ghost" onClick={saveTemplate}><BookmarkPlus size={16}/>Save template on this device</Button></div></details>
    {error && <p role="alert" className="error">{error}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="event-reuse-dialog"><DialogHeader><DialogTitle>Duplicate this event</DialogTitle>
      <DialogDescription>The copy opens in the editor as a new draft. Dates move to a future week at the same local clock time; review the venue and publication settings before saving.</DialogDescription></DialogHeader>
      <div className="event-reuse-choices"><label className="check-field"><input type="checkbox" checked={copyOfferings} onChange={(event) => setCopyOfferings(event.target.checked)}/> Copy ticket and package setup</label>
        <small>Fresh inventory only. Sold counts, historical prices, purchase records, QR codes, and absolute sales windows are not copied. Password tiers reopen inactive and hidden until reviewed.</small>
        <label className="check-field"><input type="checkbox" checked={copyImage} onChange={(event) => setCopyImage(event.target.checked)}/> Reuse the event cover image</label>
        <label className="check-field"><input type="checkbox" checked={copyTeam} onChange={(event) => { setCopyTeam(event.target.checked); if (!event.target.checked) setCopyAllocations(false); }}/> Copy active event team and commission terms</label>
        <label className="check-field"><input type="checkbox" checked={copyAllocations} disabled={!copyTeam} onChange={(event) => setCopyAllocations(event.target.checked)}/> Also copy promoter guestlist allocations</label>
        <small>No guest entries, invitations, tokens or past sales are copied. Team access and commissions become active on the new draft only if selected.</small></div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => { setOpen(false); onDuplicate(event, { copyOfferings, copyImage, copyTeam, copyAllocations }); }}>Continue to draft editor</Button></DialogFooter>
    </DialogContent></Dialog></>;
}
