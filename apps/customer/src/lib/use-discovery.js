import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { discoveryDateRange, upcomingWeekRange } from './discovery';
import { discoveryShortcutRange } from './discovery-shortcuts';

const prepareEvents = (items) => items.map((event) => ({
  ...event,
  offerings: [...(event.offerings || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
}));

export function useDiscovery(submitted) {
  const [events, setEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [nextCursor, setNextCursor] = useState(null);
  const [moreState, setMoreState] = useState('idle');
  const [previewEvents, setPreviewEvents] = useState([]);
  const [previewCursor, setPreviewCursor] = useState(null);
  const [previewState, setPreviewState] = useState('idle');
  const [reloadRevision, setReloadRevision] = useState(0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const range = submitted.shortcut ? discoveryShortcutRange(submitted.shortcut) : discoveryDateRange(submitted.date);
  const key = JSON.stringify([submitted, timezone]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const moreRequest = useRef(null);
  function url({ start, end }, cursor = null) {
    const params = new URLSearchParams({ pageSize: '9', city: submitted.city, startDate: start, endDate: end, query: submitted.query, timezone });
    if (cursor) params.set('cursor', cursor);
    return `/events?${params}`;
  }
  function reload() { setReloadRevision((value) => value + 1); }
  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort();
    setNextCursor(null); setMoreState('idle'); setLoadState(events.length ? 'refreshing' : 'loading');
    api(url(range), { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) { setEvents(prepareEvents(page.items)); setNextCursor(page.nextCursor); setLoadState('ready'); } })
      .catch(() => { if (!controller.signal.aborted) setLoadState(events.length ? 'error-refresh' : 'error'); });
    return () => controller.abort();
  }, [key, reloadRevision]);
  async function loadMore(preview = false) {
    const cursor = preview ? previewCursor : nextCursor;
    if (!cursor || (preview ? previewState === 'loading-more' : moreState === 'loading')) return;
    const requestKey = currentKey.current;
    const controller = new AbortController();
    if (!preview) moreRequest.current = controller;
    if (preview) setPreviewState('loading-more'); else setMoreState('loading');
    try {
      const page = await api(url(preview ? upcomingWeekRange(submitted.date) : range, cursor), { signal: controller.signal });
      if (controller.signal.aborted || requestKey !== currentKey.current) return;
      if (preview) { setPreviewEvents((previous) => [...previous, ...prepareEvents(page.items)]); setPreviewCursor(page.nextCursor); setPreviewState('ready'); }
      else { setEvents((previous) => [...previous, ...prepareEvents(page.items)]); setNextCursor(page.nextCursor); setMoreState('idle'); }
    } catch {
      if (controller.signal.aborted || requestKey !== currentKey.current) return;
      if (preview) setPreviewState('error-more'); else setMoreState('error');
    }
  }
  useEffect(() => {
    if (!submitted.date || loadState !== 'ready' || events.length) { setPreviewEvents([]); setPreviewCursor(null); setPreviewState('idle'); return; }
    const controller = new AbortController();
    setPreviewEvents([]); setPreviewCursor(null); setPreviewState('loading');
    api(url(upcomingWeekRange(submitted.date)), { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) { setPreviewEvents(prepareEvents(page.items)); setPreviewCursor(page.nextCursor); setPreviewState('ready'); } })
      .catch(() => { if (!controller.signal.aborted) setPreviewState('error'); });
    return () => controller.abort();
  }, [key, loadState, events.length === 0]);
  return { events, previewEvents, loadState, nextCursor, moreState, previewCursor, previewState, range, reload, loadMore };
}
