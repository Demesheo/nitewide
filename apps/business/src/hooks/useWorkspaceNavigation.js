import { useEffect, useState } from 'react';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';

// URL state belongs to navigation, not to the bootstrap response. Back/Forward
// must restore the view without refetching the whole workspace or losing filters.
export function useWorkspaceNavigation() {
  const [initial] = useState(readWorkspaceLocation);
  const [page, setPage] = useState(initial.section);
  const [selectedOrganizations, setSelectedOrganizations] = useState(initial.organizationIds);
  const [selectedVenues, setSelectedVenues] = useState(initial.venueIds);
  const [days, setDays] = useState(initial.days);
  const [eventToOpen, setEventToOpen] = useState(initial.eventId);
  const [guestlistEntryToOpen, setGuestlistEntryToOpen] = useState(initial.entryId);
  const [eventTabToOpen, setEventTabToOpen] = useState(initial.tab);
  const [eventNavigationRevision, setEventNavigationRevision] = useState(0);

  useEffect(() => { if (window.matchMedia('(max-width: 850px)').matches)
    window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  useEffect(() => {
    const restore = () => { const state = readWorkspaceLocation();
      setPage(state.section); setEventToOpen(state.eventId); setGuestlistEntryToOpen(state.entryId);
      setEventTabToOpen(state.tab); setSelectedOrganizations(state.organizationIds);
      setSelectedVenues(state.venueIds); setDays(state.days);
      setEventNavigationRevision((value) => value + 1);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  function navigate(value, eventId = null, entryId = null, eventTab = null) {
    writeWorkspaceLocation({ section: value, event: eventId, entry: entryId, tab: eventTab });
    setPage(value); setEventToOpen(eventId); setGuestlistEntryToOpen(entryId); setEventTabToOpen(eventTab);
    setSelectedOrganizations([]); setSelectedVenues([]); setDays('30');
    setEventNavigationRevision((revision) => revision + 1);
  }
  function chooseOrganizations(ids) { setSelectedOrganizations(ids); setSelectedVenues([]);
    writeWorkspaceLocation({ organizationIds: ids, venueIds: [] }); }
  function chooseVenues(ids) { setSelectedVenues(ids); writeWorkspaceLocation({ venueIds: ids }); }
  function chooseDays(value) { setDays(value); writeWorkspaceLocation({ days: value }); }
  function selectEvent(id) { setEventToOpen(id);
    writeWorkspaceLocation({ event: id, entry: null, tab: null }); }

  return { page, setPage, selectedOrganizations, setSelectedOrganizations, selectedVenues, setSelectedVenues,
    days, eventToOpen, guestlistEntryToOpen, eventTabToOpen, eventNavigationRevision,
    navigate, chooseOrganizations, chooseVenues, chooseDays, selectEvent };
}
