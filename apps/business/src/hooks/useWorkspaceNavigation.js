import { useEffect, useState } from 'react';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { scrollWorkspaceTo } from '@/lib/workspace-scroll';

// URL state belongs to navigation, not to the bootstrap response. Back/Forward
// must restore the view without refetching the whole workspace or losing filters.
export function useWorkspaceNavigation() {
  const [initial] = useState(readWorkspaceLocation);
  const [page, setPage] = useState(initial.section);
  const [selectedVenues, setSelectedVenues] = useState(initial.venueIds);
  const [days, setDays] = useState(initial.days);
  const [eventToOpen, setEventToOpen] = useState(initial.eventId);
  const [guestlistEntryToOpen, setGuestlistEntryToOpen] = useState(initial.entryId);
  const [eventTabToOpen, setEventTabToOpen] = useState(initial.tab);
  const [eventNavigationRevision, setEventNavigationRevision] = useState(0);

  useEffect(() => { if (window.matchMedia('(max-width: 850px)').matches)
    scrollWorkspaceTo({ top: 0, behavior: 'instant' }); }, [page]);
  useEffect(() => {
    const restore = () => { const state = readWorkspaceLocation();
      setPage(state.section); setEventToOpen(state.eventId); setGuestlistEntryToOpen(state.entryId);
      setEventTabToOpen(state.tab);
      setSelectedVenues(state.venueIds); setDays(state.days);
      setEventNavigationRevision((value) => value + 1);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  function navigate(value, eventId = null, entryId = null, eventTab = null, destination = {}) {
    writeWorkspaceLocation({ ...destination, section: value, event: eventId, entry: entryId, tab: eventTab });
    setPage(value); setEventToOpen(eventId); setGuestlistEntryToOpen(entryId); setEventTabToOpen(eventTab);
    setSelectedVenues(destination.venueIds || []); setDays('30');
    setEventNavigationRevision((revision) => revision + 1);
  }
  function chooseVenues(ids) { setSelectedVenues(ids); writeWorkspaceLocation({ venueIds: ids }); }
  function chooseDays(value) { setDays(value); writeWorkspaceLocation({ days: value }); }
  function selectEvent(id) { setEventToOpen(id);
    writeWorkspaceLocation({ event: id, entry: null, tab: null }); }

  return { page, setPage, selectedVenues, setSelectedVenues,
    days, eventToOpen, guestlistEntryToOpen, eventTabToOpen, eventNavigationRevision,
    navigate, chooseVenues, chooseDays, selectEvent };
}
