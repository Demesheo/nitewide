import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { detectCurrentCity, localDateInputValue } from './discovery-defaults';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

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

  return <>
    <header><a className="brand" href="/">NITEWIDE<span>.</span></a><nav><a href="#discover">Discover</a><a href="#how">How it works</a><button>Sign in</button></nav></header>
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
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
