import { useRef, useState } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { applyConnectionSelection, toggleConnectionSelection } from '../lib/connections';

export function ConnectionFilter({ people, selected, onApply, upcoming, loading }) {
  const trigger = useRef(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState([]), [search, setSearch] = useState('');
  const availableIds = people.map((person) => person.id);
  const visible = people.filter((person) => person.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedCount = draft.filter((id) => availableIds.includes(id)).length;
  function changeOpen(value) {
    if (value) { setDraft(selected === null ? availableIds : [...selected]); setSearch(''); }
    setOpen(value);
  }
  return <>
    <Button ref={trigger} variant="outline" className="connections-filter-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => changeOpen(true)} disabled={!people.length}>
      <Users size={16} /> {selected === null ? 'All connections' : `${selected.length} ${selected.length === 1 ? 'connection' : 'connections'}`} <ChevronDown size={14} />
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="connection-filter-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>Choose your connections</DialogTitle><DialogDescription>See upcoming events from the people you choose.</DialogDescription></DialogHeader>
        <Input aria-label="Search people" placeholder="Search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="connection-filter-tools"><span>{selectedCount} selected</span><Button variant="ghost" onClick={() => setDraft(availableIds)}>Select all</Button><Button variant="ghost" onClick={() => setDraft([])}>Clear</Button></div>
        <div className="connection-filter-list" role="group" aria-label="Connections to include">
          {visible.map((person) => {
            const count = upcoming.filter((group) => group.referrals.some((entry) => entry.referrer.id === person.id)).length;
            return <label className="connection-filter-option" key={person.id}>
              <input type="checkbox" checked={draft.includes(person.id)} onChange={() => setDraft((current) => toggleConnectionSelection(current, person.id))} aria-label={person.name} />
              <span><strong>{person.name}</strong><small>{person.bookings} {person.bookings === 1 ? 'booking' : 'bookings'} · {person.guestlistEvents} guestlist {person.guestlistEvents === 1 ? 'event' : 'events'}</small><small>{loading ? 'Finding events…' : `${count} upcoming ${count === 1 ? 'event' : 'events'}`}</small></span>
            </label>;
          })}
          {!visible.length && <p className="connection-filter-empty">No matching connections.</p>}
        </div>
        <div className="connection-filter-actions"><Button variant="ghost" onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={!selectedCount} onClick={() => { onApply(applyConnectionSelection(draft, availableIds)); setOpen(false); }}>Apply filters</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
