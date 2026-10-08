import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { appendRundownEvents, prepareRundownPage, rundownPagePath, rundownPreviewPath } from './rundown';

const loadError = 'We couldn’t load this rundown. Please try again.';
const moreError = 'We couldn’t load more events. Please try again.';
const empty = (key, loadState) => ({ key, profile: null, items: [], hasMore: false, nextCursor: null,
  loadState, error: '', moreState: 'idle', moreError: '' });

export function useRundown(rundownId, { preview, session } = {}) {
  const previewing = preview != null;
  const path = previewing ? rundownPreviewPath(preview) : rundownPagePath(rundownId);
  const token = previewing && typeof session?.accessToken === 'string' ? session.accessToken : '';
  const userId = previewing && typeof session?.user?.id === 'string' ? session.user.id : '';
  const signedIn = Boolean(token && userId);
  const initialLoadState = !path ? 'unavailable' : previewing && !signedIn ? 'sign-in' : 'loading';
  const key = JSON.stringify(previewing ? ['preview', path, userId, token] : ['public', path]);
  const initialState = () => empty(key, initialLoadState);
  const preparePage = data => {
    const page = prepareRundownPage(data);
    if (previewing && page.profile.kind !== preview.kind) throw new Error('Invalid rundown preview kind');
    return page;
  };
  const requestPath = cursor => previewing ? rundownPreviewPath(preview, cursor) : rundownPagePath(rundownId, cursor);
  const failureState = cause => previewing && cause.status === 401 ? 'sign-in' : [403, 404, 410].includes(cause.status) ? 'unavailable' : 'error';
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  const currentKey = useRef(key);
  const generation = useRef(0);
  const requests = useRef({ first: null, more: null });
  stateRef.current = state;
  currentKey.current = key;
  // Reset visibility during render so another owner's cards never paint before
  // the effect has had a chance to abort and replace the previous request.
  const visible = state.key === key ? state : initialState();

  useEffect(() => {
    for (const controller of Object.values(requests.current)) controller?.abort();
    requests.current = { first: null, more: null };
    const requestGeneration = ++generation.current;
    setState(initialState());
    if (initialLoadState !== 'loading') return;
    const controller = new AbortController();
    requests.current.first = controller;
    const active = () => !controller.signal.aborted && currentKey.current === key && generation.current === requestGeneration;
    api(path, { signal: controller.signal, ...(previewing ? { token } : {}) })
      .then(data => {
        const page = preparePage(data);
        if (active()) setState({ ...initialState(), ...page, loadState: 'ready' });
      })
      .catch(cause => {
        if (!active()) return;
        setState({ ...initialState(), loadState: failureState(cause), error: loadError });
      })
      .finally(() => { if (requests.current.first === controller) requests.current.first = null; });
    return () => controller.abort();
  }, [key, revision]);

  async function loadMore() {
    const snapshot = stateRef.current;
    if (snapshot.key !== key || currentKey.current !== key || snapshot.loadState !== 'ready'
      || !snapshot.hasMore || !snapshot.nextCursor || requests.current.more) return;
    const controller = new AbortController();
    requests.current.more = controller;
    const requestGeneration = generation.current;
    const cursor = snapshot.nextCursor;
    const active = () => !controller.signal.aborted && currentKey.current === key && generation.current === requestGeneration;
    setState(previous => ({ ...previous, moreState: 'loading', moreError: '' }));
    try {
      const page = preparePage(await api(requestPath(cursor), { signal: controller.signal, ...(previewing ? { token } : {}) }));
      if (!active()) return;
      if (page.hasMore && page.nextCursor === cursor) throw new Error('Rundown cursor did not advance');
      setState(previous => ({ ...previous, ...page, items: appendRundownEvents(previous.items, page.items), moreState: 'idle', moreError: '' }));
    } catch (cause) {
      if (!active()) return;
      const status = failureState(cause);
      if (status !== 'error') setState({ ...initialState(), loadState: status });
      else setState(previous => ({ ...previous, moreState: 'error', moreError }));
    } finally {
      if (requests.current.more === controller) requests.current.more = null;
    }
  }

  useEffect(() => () => { for (const controller of Object.values(requests.current)) controller?.abort(); }, []);
  return { ...visible, reload: () => setRevision(value => value + 1), loadMore };
}
