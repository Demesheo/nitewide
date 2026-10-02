import { CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';

// The public access gate is deliberately independent of operator detail code.
export function MyEventsAccessState({ session, access, onSignIn, onDiscover }) {
  return <main className="my-events-access-page booked-page wrap" id="my-events">
    <div className="booked-page-heading"><p className="eyebrow">YOUR EVENTS. YOUR PEOPLE.</p><h1>My events.</h1><p>Keep up with the nights you’re part of.</p></div>
    {!session ? <div className="account-empty"><CalendarDays aria-hidden="true" /><h2>Sign in to your events.</h2><p>Use the account connected to your business or event team.</p><Button className="dark-glass-action" onClick={onSignIn}>Sign in</Button></div>
      : access.loading ? <LoadingIndicator>Checking your event access…</LoadingIndicator>
      : access.error ? <div className="account-empty" role="alert"><p>{access.error}</p><Button variant="outline" onClick={access.recheck}>Try again</Button></div>
      : <div className="account-empty"><CalendarDays aria-hidden="true" /><h2>Your event access isn’t available.</h2><p>My events is available to approved business members after account setup.</p><Button className="dark-glass-action" onClick={onDiscover}>Discover events</Button></div>}
  </main>;
}
