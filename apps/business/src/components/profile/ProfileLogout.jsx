import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function ProfileLogout({ onLogout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logout = async (everywhere) => { setBusy(true); try { setError(await onLogout(everywhere) || ''); } finally { setBusy(false); } };
  return <footer className="business-profile-logout">
    <Button type="button" variant="outline" disabled={!onLogout || busy} onClick={() => logout(false)}><LogOut size={16} aria-hidden="true"/> Log out</Button>
    <Button type="button" variant="ghost" disabled={!onLogout || busy} onClick={() => logout(true)}>Sign out everywhere</Button>
    {error && <p role="alert">{error}</p>}
  </footer>;
}
