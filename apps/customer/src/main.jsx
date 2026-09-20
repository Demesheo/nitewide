import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { detectCurrentCity, localDateInputValue } from './discovery-defaults';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const emptyAuthForm = { displayName: '', email: '', password: '', marketingConsent: false };

function storedSession() {
  try { return JSON.parse(localStorage.getItem('nitewide.session')); } catch (_error) { return null; }
}

function eventCity(event) {
  if (!event?.location?.city) return '';
  return event.location.region ? `${event.location.city}, ${event.location.region}` : event.location.city;
}

function App() {
  const [events, setEvents] = useState([]);
  const [state, setState] = useState('loading');
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState(() => localDateInputValue());
  const [locationState, setLocationState] = useState('finding');
  const [session, setSession] = useState(storedSession);
  const [authMode, setAuthMode] = useState(null);
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadDefaults() {
      const [eventsResult, cityResult] = await Promise.allSettled([
        fetch(`${API}/events`).then((response) => { if (!response.ok) throw new Error(); return response.json(); }),
        detectCurrentCity(),
      ]);
      if (!active) return;
      const loadedEvents = eventsResult.status === 'fulfilled' ? eventsResult.value.data : [];
      setEvents(loadedEvents);
      setState(eventsResult.status === 'fulfilled' ? 'ready' : 'error');
      const detectedCity = cityResult.status === 'fulfilled' ? cityResult.value : '';
      setWhere(detectedCity || eventCity(loadedEvents[0]));
      setLocationState(detectedCity ? 'current' : 'fallback');
    }
    loadDefaults();
    return () => { active = false; };
  }, []);

  const openAuth = (mode) => { setAuthMode(mode); setAuthForm(emptyAuthForm); setAuthError(''); };
  const submitAuth = async (event) => {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const endpoint = authMode === 'register' ? 'register' : 'sign-in';
      const body = authMode === 'register' ? authForm : { email: authForm.email, password: authForm.password };
      const response = await fetch(`${API}/auth/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Unable to continue');
      localStorage.setItem('nitewide.session', JSON.stringify(payload.data));
      setSession(payload.data); setAuthMode(null);
    } catch (error) { setAuthError(error.message); } finally { setAuthBusy(false); }
  };
  const signOut = () => { localStorage.removeItem('nitewide.session'); setSession(null); };

  return <>
    <header><a className="brand" href="/">NITEWIDE<span>.</span></a><nav><a href="#discover">Discover</a><a href="#how">How it works</a>{session ? <div className="signed-in"><span>{session.user.displayName}</span><button onClick={signOut}>Sign out</button></div> : <button onClick={() => openAuth('signIn')}>Sign in</button>}</nav></header>
    <main>
      <section className="hero"><p className="eyebrow">Your city, after dark</p><h1>Find your <em>night.</em></h1><p>Discover events, join guestlists, reserve your spot, and keep every ticket in one place. No download needed.</p>
        <form className="search" onSubmit={(event) => event.preventDefault()}>
          <label><span>Where</span><input aria-label="Location" aria-busy={locationState === 'finding'} autoComplete="address-level2" placeholder={locationState === 'finding' ? 'Finding your city…' : 'City'} value={where} onChange={(event) => setWhere(event.target.value)} /></label>
          <label><span>When</span><input aria-label="Date" type="date" value={when} onChange={(event) => setWhen(event.target.value)} /></label>
          <button>Explore events →</button>
        </form>
      </section>
      <section id="discover" className="events"><div className="section-title"><div><p className="eyebrow">Curated for you</p><h2>What’s happening</h2></div><button className="quiet">View all</button></div>
        {state === 'loading' && <p className="notice">Finding the night...</p>}{state === 'error' && <p className="notice">Start the API and seed the database to see live events.</p>}
        <div className="grid">{events.map((event, index) => <article key={event.id}><div className={`art art-${index % 3}`}><span>{event.category}</span><b>{new Date(event.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b></div><div className="card-body"><p className="meta">{new Date(event.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p><h3>{event.title}</h3><p>{event.location?.name || event.location?.city || 'Location shared with attendees'}</p><div className="card-foot"><span>{event.offerings?.length ? `From ${money(Math.min(...event.offerings.map((offering) => offering.priceCents)))}` : 'Guestlist available'}</span><button aria-label={`View ${event.title}`}>↗</button></div></div></article>)}</div>
      </section>
      <section id="how" className="manifesto"><p className="eyebrow">One seamless night</p><h2>Discover. Book. Show up.</h2><div><p><b>01</b> Find experiences matched to your city and your energy.</p><p><b>02</b> Buy any ticket or package on the web—no app-store detour.</p><p><b>03</b> Scan your secure QR credential at the door and walk in.</p></div></section>
    </main>
    <footer><a className="brand" href="/">NITEWIDE<span>.</span></a><p>Find your night.</p></footer>
    {authMode && <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="auth-close" aria-label="Close" onClick={() => setAuthMode(null)}>×</button><p className="eyebrow">WELCOME TO NITEWIDE</p><h2 id="auth-title">{authMode === 'register' ? 'Create your account' : 'Sign in'}</h2><p>{authMode === 'register' ? 'Join guestlists, buy tickets, and keep your nights together.' : 'Pick up where you left off.'}</p><form onSubmit={submitAuth}>
      {authMode === 'register' && <label>Display name<input required autoComplete="name" value={authForm.displayName} onChange={(event) => setAuthForm((current) => ({ ...current, displayName: event.target.value }))} /></label>}
      <label>Email<input required type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} /></label>
      <label>Password<input required minLength="8" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} /></label>
      {authMode === 'register' && <label className="consent"><input type="checkbox" checked={authForm.marketingConsent} onChange={(event) => setAuthForm((current) => ({ ...current, marketingConsent: event.target.checked }))} /> Send me event recommendations and Nitewide updates.</label>}
      {authError && <p className="auth-error">{authError}</p>}<button className="auth-submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}</button>
    </form><button className="auth-switch" onClick={() => openAuth(authMode === 'register' ? 'signIn' : 'register')}>{authMode === 'register' ? 'Already have an account? Sign in' : 'New to Nitewide? Create an account'}</button></section></div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
