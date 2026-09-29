import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { readStorage, writeStorage } from './discovery';
import { uniqueSavedIds, savedIdBatches } from './saved-id-batch';

const guestKey = 'nitewide.saved';
const pageSize = 9;

export function useSavedEvents(session, view, visibleEvents, onError) {
  const accountId = session?.user?.id || null;
  const ownerKey = accountId || 'guest';
  const [guestIds, setGuestIds] = useState(() => uniqueSavedIds(readStorage(guestKey, [])));
  const [known, setKnown] = useState({ owner: null, ids: [] });
  const [pageData, setPageData] = useState({ owner: null, items: [] });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState('idle');
  const [revision, setRevision] = useState(0);
  const [endTick, setEndTick] = useState(0);
  const [mergeError, setMergeError] = useState('');
  const mergedUser = useRef(null);
  const pending = useRef(new Set());
  const inFlight = useRef(new Map());
  const previousOwner = useRef(ownerKey);
  const [extraVisible, setExtraVisible] = useState([]);
  const visibleKey = [...visibleEvents, ...extraVisible].map((event) => event.id).join(',');
  const visibleIds = useMemo(() => uniqueSavedIds(visibleKey.split(',')), [visibleKey]);
  const saved = accountId ? known.owner === accountId ? known.ids : [] : guestIds;
  const items = pageData.owner === ownerKey ? pageData.items : [];
  const itemEndTimes = items.map((event) => `${event.id}:${event.endsAt || event.startsAt}`).join(',');

  useEffect(() => {
    if (view !== 'saved' || !items.length) return;
    const now = Date.now();
    const nextEnd = items.map((event) => new Date(event.endsAt || event.startsAt).getTime())
      .filter((time) => Number.isFinite(time) && time > now).sort((a, b) => a - b)[0];
    if (!nextEnd) return;
    const timer = setTimeout(() => setEndTick((value) => value + 1), Math.min(nextEnd - now + 50, 2147483647));
    return () => clearTimeout(timer);
  }, [view, ownerKey, itemEndTimes, endTick]);

  useEffect(() => {
    if (previousOwner.current === ownerKey) return;
    previousOwner.current = ownerKey;
    mergedUser.current = null;
    setMergeError('');
    setKnown({ owner: accountId, ids: [] });
    setPageData({ owner: ownerKey, items: [] });
    setPage(1);
    setHasMore(false);
    inFlight.current.clear();
    pending.current.clear();
  }, [ownerKey]);

  useEffect(() => {
    if (!accountId || mergedUser.current === accountId || !guestIds.length) return;
    const controller = new AbortController();
    async function mergeGuestSaves() {
      try {
        for (const ids of savedIdBatches(guestIds, 100)) {
          if (controller.signal.aborted) return;
          await api('/customer/saved/merge', { token: session.accessToken, body: { eventIds: ids }, signal: controller.signal });
        }
        if (controller.signal.aborted) return;
        mergedUser.current = accountId;
        setMergeError('');
        setGuestIds([]);
        writeStorage(guestKey, []);
        setRevision((value) => value + 1);
      } catch (error) {
        if (!controller.signal.aborted) { setMergeError(error.message); onError?.(`Your saved nights could not sync yet: ${error.message}`); }
      }
    }
    mergeGuestSaves();
    return () => controller.abort();
  }, [accountId, guestIds.join(','), session?.accessToken, revision]);

  useEffect(() => {
    if (!accountId || !visibleIds.length) return;
    const controller = new AbortController();
    Promise.all(savedIdBatches(visibleIds, 50).map((ids) =>
      api(`/customer/saved/ids?eventIds=${encodeURIComponent(ids.join(','))}`, { token: session.accessToken, signal: controller.signal })))
      .then((pages) => {
        if (controller.signal.aborted) return;
        const fromServer = uniqueSavedIds(pages.flatMap((item) => item.savedIds));
        setKnown((current) => {
          const previous = current.owner === accountId ? current.ids : [];
          const visible = new Set(visibleIds.filter((id) => !pending.current.has(id)));
          return { owner: accountId, ids: uniqueSavedIds([...previous.filter((id) => !visible.has(id)), ...fromServer.filter((id) => !pending.current.has(id))]) };
        });
      })
      .catch((error) => { if (!controller.signal.aborted) onError?.(`Saved status could not refresh: ${error.message}`); });
    return () => controller.abort();
  }, [accountId, session?.accessToken, visibleKey, revision]);

  useEffect(() => {
    if (view !== 'saved') return;
    const controller = new AbortController();
    setLoadState('loading');
    const guestPageIds = guestIds.slice((page - 1) * pageSize, page * pageSize);
    const request = accountId
      ? api(`/customer/saved?page=${page}&pageSize=${pageSize}`, { token: session.accessToken, signal: controller.signal })
      : (guestPageIds.length
        ? api(`/events/batch?ids=${encodeURIComponent(guestPageIds.join(','))}`, { signal: controller.signal })
        : Promise.resolve({ items: [] }))
        .then((result) => ({ ...result, hasMore: page * pageSize < guestIds.length }));
    request
      .then((result) => {
        if (controller.signal.aborted) return;
        setPageData((current) => {
          const previous = current.owner === ownerKey && page > 1 ? current.items : [];
          const byId = new Map([...previous, ...result.items].map((item) => [item.id, item]));
          return { owner: ownerKey, items: [...byId.values()] };
        });
        if (accountId) setKnown((current) => ({ owner: accountId, ids: uniqueSavedIds([...(current.owner === accountId ? current.ids : []), ...result.items.map((item) => item.id)]) }));
        setHasMore(Boolean(result.hasMore));
        setLoadState('ready');
      })
      .catch((error) => { if (!controller.signal.aborted) { setLoadState('error'); onError?.(`We couldn’t load saved nights: ${error.message}`); } });
    return () => controller.abort();
  }, [view, ownerKey, session?.accessToken, guestIds.join(','), page, revision]);

  async function save(event) {
    if (!event?.id || pending.current.has(event.id)) return;
    const current = accountId ? known.owner === accountId ? known.ids : [] : guestIds;
    const wasSaved = current.includes(event.id);
    const next = wasSaved ? current.filter((id) => id !== event.id) : uniqueSavedIds([...current, event.id]);
    if (accountId) setKnown({ owner: accountId, ids: next });
    else { setGuestIds(next); writeStorage(guestKey, next); }
    if (view === 'saved' && wasSaved) setPageData((currentPage) => currentPage.owner === ownerKey
      ? { ...currentPage, items: currentPage.items.filter((item) => item.id !== event.id) } : currentPage);
    if (view === 'saved') setPage(1);
    if (!accountId) { setRevision((value) => value + 1); return; }
    pending.current.add(event.id);
    const prior = inFlight.current.get(event.id) || Promise.resolve();
    const request = prior.catch(() => {}).then(() => api(`/customer/saved/${encodeURIComponent(event.id)}`, {
      token: session.accessToken,
      method: wasSaved ? 'DELETE' : 'PUT',
    }));
    inFlight.current.set(event.id, request);
    try { await request; }
    catch (error) {
      if (inFlight.current.get(event.id) === request) {
        setKnown((value) => value.owner === accountId ? { owner: accountId, ids: current } : value);
        onError?.(`Couldn’t ${wasSaved ? 'remove' : 'save'} this event: ${error.message}`);
      }
    } finally {
      if (inFlight.current.get(event.id) === request) {
        inFlight.current.delete(event.id);
        pending.current.delete(event.id);
        setRevision((value) => value + 1);
      }
    }
  }

  return { saved, items, loadState, hasMore, mergeError, save, checkVisible: setExtraVisible, loadMore: () => setPage((value) => value + 1), retry: () => setRevision((value) => value + 1) };
}
