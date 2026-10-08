import { useEffect, useRef, useState } from 'react';
import { confirmedDiscoveryScope, qualifiedDiscoveryCity } from './discovery-selection';
import { api } from './api';
import { discoveryDateRange, upcomingWeekRange } from './discovery';
import { discoveryShortcutRange } from './discovery-shortcuts';

const prepareEvents = (items) => items.map((event) => ({
  ...event,
  offerings: [...(event.offerings || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
}));

const emptyResults = (key, selected) => ({ key, events: [], nextCursor: null, moreState: 'idle',
  previewEvents: [], previewCursor: null, previewState: 'idle',
  area: null, distanceOrigin: null, resolutionStatus: null, hasUpcomingAreaEvents: null, loadState: selected ? 'loading' : 'unselected' });

export function useDiscovery(submitted) {
  const selectedCity = qualifiedDiscoveryCity(submitted.city);
  const [reloadRevision, setReloadRevision] = useState(0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const mode = submitted.date || submitted.shortcut ? 'range' : 'upcoming';
  const scope = submitted.scope === 'city' ? 'city' : 'nearby';
  const sort = ['distance', 'date'].includes(submitted.sort) ? submitted.sort : 'recommended';
  const queryKey = JSON.stringify([selectedCity.toLowerCase(), submitted.date, submitted.query, submitted.shortcut, mode, scope, sort, timezone]);
  const windowRef = useRef(null);
  // Anchor all pages of this query to the same date, including across midnight.
  // An explicit refresh or filter change starts a new anchored window.
  if (windowRef.current?.key !== queryKey || windowRef.current.revision !== reloadRevision) {
    windowRef.current = { key: queryKey, revision: reloadRevision,
      range: submitted.shortcut ? discoveryShortcutRange(submitted.shortcut) : discoveryDateRange(submitted.date) };
  }
  const range = windowRef.current.range;
  const key = JSON.stringify([queryKey, range.start, range.end]);
  const [state, setState] = useState(() => emptyResults(key, selectedCity));
  const currentKey = useRef(key);
  currentKey.current = key;
  const generation = useRef(0);
  const requests = useRef({ main: null, more: null, preview: null, previewMore: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Effects run after render: guard here so a switch can never paint old cards.
  const visible = state.key === key ? state : emptyResults(key, selectedCity);
  const { events, loadState, hasUpcomingAreaEvents, resolutionStatus } = visible;
  function url({ start, end }, cursor = null, requestMode = mode) {
    const params = new URLSearchParams({ pageSize: '9', city: selectedCity, mode: requestMode, scope, sort, startDate: start, query: submitted.query, timezone });
    if (requestMode === 'range') params.set('endDate', end);
    if (cursor) params.set('cursor', cursor);
    return `/events?${params}`;
  }
  function reload() { setReloadRevision((value) => value + 1); }
  useEffect(() => {
    for (const request of Object.values(requests.current)) request?.abort();
    const requestGeneration = ++generation.current;
    const previous = stateRef.current;
    const retained = previous.key === key && previous.events.length > 0;
    if (!selectedCity) { setState(emptyResults(key, false)); return; }
    const controller = new AbortController();
    requests.current.main = controller;
    setState(retained ? { ...previous, nextCursor: null, moreState: 'idle', previewEvents: [], previewCursor: null, previewState: 'idle', loadState: 'refreshing' } : emptyResults(key, true));
    const active = () => !controller.signal.aborted && currentKey.current === key && generation.current === requestGeneration;
    api(url(range), { signal: controller.signal })
      .then((page) => { if (active()) setState({ ...emptyResults(key, true), events: prepareEvents(page.items), nextCursor: page.nextCursor,
        area: page.area || null, distanceOrigin: page.distanceOrigin?.kind === 'city-center' ? page.distanceOrigin : null,
        resolutionStatus: page.resolutionStatus || 'unresolved',
        hasUpcomingAreaEvents: typeof page.hasUpcomingAreaEvents === 'boolean' ? page.hasUpcomingAreaEvents : null, loadState: 'ready' }); })
      .catch(() => { if (active()) setState((previous) => ({ ...previous, loadState: retained ? 'error-refresh' : 'error' })); });
    return () => controller.abort();
  }, [key, reloadRevision]);
  async function loadMore(preview = false) {
    const snapshot = stateRef.current;
    if (!selectedCity || snapshot.key !== key || currentKey.current !== key) return;
    const cursor = preview ? snapshot.previewCursor : snapshot.nextCursor;
    const lane = preview ? 'previewMore' : 'more';
    if (!cursor || requests.current[lane] && !requests.current[lane].signal.aborted) return;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    requests.current[lane] = controller;
    setState((previous) => ({ ...previous, ...(preview ? { previewState: 'loading-more' } : { moreState: 'loading' }) }));
    const active = () => !controller.signal.aborted && currentKey.current === key && generation.current === requestGeneration;
    try {
      const page = await api(url(preview ? upcomingWeekRange(submitted.date) : range, cursor, preview ? 'range' : mode), { signal: controller.signal });
      if (!active()) return;
      if (page.area?.key !== snapshot.area?.key) throw new Error('Discovery scope changed');
      setState((previous) => preview
        ? { ...previous, previewEvents: [...previous.previewEvents, ...prepareEvents(page.items)], previewCursor: page.nextCursor, previewState: 'ready' }
        : { ...previous, events: [...previous.events, ...prepareEvents(page.items)], nextCursor: page.nextCursor, moreState: 'idle' });
    } catch (error) {
      if (active()) setState((previous) => ({ ...previous, ...(error.code === 'DISCOVERY_CURSOR_EXPIRED'
        ? preview ? { previewCursor: null, previewState: 'expired' } : { nextCursor: null, moreState: 'expired' }
        : preview ? { previewState: 'error-more' } : { moreState: 'error' }) }));
    } finally { if (requests.current[lane] === controller) requests.current[lane] = null; }
  }
  useEffect(() => {
    requests.current.preview?.abort(); requests.current.previewMore?.abort();
    if (!selectedCity || !submitted.date || loadState !== 'ready' || events.length || !confirmedDiscoveryScope(visible.area, resolutionStatus) || hasUpcomingAreaEvents === false) return;
    const controller = new AbortController();
    requests.current.preview = controller;
    const requestGeneration = generation.current;
    const active = () => !controller.signal.aborted && currentKey.current === key && generation.current === requestGeneration;
    setState((previous) => ({ ...previous, previewEvents: [], previewCursor: null, previewState: 'loading' }));
    api(url(upcomingWeekRange(submitted.date), null, 'range'), { signal: controller.signal })
      .then((page) => {
        if (!active()) return;
        if (page.area?.key !== visible.area.key) throw new Error('Discovery scope changed');
        setState((previous) => ({ ...previous, previewEvents: prepareEvents(page.items), previewCursor: page.nextCursor, previewState: 'ready' }));
      })
      .catch(() => { if (active()) setState((previous) => ({ ...previous, previewState: 'error' })); });
    return () => controller.abort();
  }, [key, loadState, events.length === 0, hasUpcomingAreaEvents, resolutionStatus]);
  useEffect(() => () => { for (const request of Object.values(requests.current)) request?.abort(); }, []);
  return { ...visible, range, mode, scope, sort, reload, loadMore };
}
