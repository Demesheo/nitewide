import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function ProfileSettings({ session }) {
  const [preferences, setPreferences] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reviewRole = (session.roles || []).some((role) => ['organization_owner', 'venue_manager', 'employee', 'promoter', 'event_creator', 'internal_admin'].includes(role));
  const inventoryRole = (session.roles || []).some((role) => ['organization_owner', 'venue_manager', 'event_creator', 'internal_admin'].includes(role));

  useEffect(() => {
    let active = true;
    api('/auth/notification-preferences', session).then((result) => { if (active) setPreferences(result); })
      .catch((failure) => { if (active) setMessage(failure.message); });
    return () => { active = false; };
  }, [session]);

  async function savePreferences() {
    setBusy(true); setMessage('');
    try {
      const result = await api('/auth/notification-preferences', session, { method: 'PATCH', body: JSON.stringify(preferences) });
      setPreferences(result); setMessage('In-app notification choices saved.');
    } catch (failure) { setMessage(failure.message); }
    finally { setBusy(false); }
  }

  return <section className="business-profile-notifications" aria-label="Settings">
    <h2>Settings</h2><h3>In-app notifications</h3>
    <p>Choose optional business alerts shown in your Nitewide inbox. Booking confirmations, guestlist outcomes, and transactional email are not controlled here.</p>
    {preferences && <>{reviewRole && <label className="check-field"><input type="checkbox" checked={preferences.salesActivity} onChange={(event) => setPreferences((current) => ({ ...current, salesActivity: event.target.checked }))}/> Sales activity</label>}
      {reviewRole && <label className="check-field"><input type="checkbox" checked={preferences.reviewRequests} onChange={(event) => setPreferences((current) => ({ ...current, reviewRequests: event.target.checked }))}/> Guestlist requests to review</label>}
      {inventoryRole && <label className="check-field"><input type="checkbox" checked={preferences.inventoryAlerts} onChange={(event) => setPreferences((current) => ({ ...current, inventoryAlerts: event.target.checked }))}/> Sold-out inventory alerts</label>}
      {reviewRole && <Button type="button" variant="outline" disabled={busy} onClick={savePreferences}>{busy ? 'Saving…' : 'Save notification choices'}</Button>}</>}
    {message && <p role="status">{message}</p>}
  </section>;
}
