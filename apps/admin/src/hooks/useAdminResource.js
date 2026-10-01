import { useEffect, useState } from 'react';
import { api } from '../lib/api';
export function useAdminResource(path, refresh = 0, request = api) {
  const [state, setState] = useState({});
  useEffect(() => {
    if (!path) return;
    let active = true;
    const controller = new AbortController();
    setState({ path, loading: true });
    request(path, { signal: controller.signal }).then((data) => { if (active) setState({ path, data }); })
      .catch((error) => { if (active && error.name !== 'AbortError') setState({ path, error: error.message }); });
    return () => { active = false; controller.abort(); };
  }, [path, refresh, request]);
  return state.path === path ? state : { loading: Boolean(path) };
}
