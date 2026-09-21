import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const USER = import.meta.env.VITE_USER_ID || '10000000-0000-4000-8000-000000000002';
const EVENT = import.meta.env.VITE_EVENT_ID || '40000000-0000-4000-8000-000000000001';
const headers = { 'content-type': 'application/json', 'x-user-id': USER };
const usd = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((value || 0) / 100);

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Unable to save guestlist settings');
  return body.data;
}

function App() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [directDraft, setDirectDraft] = useState('');
  const [promoterDrafts, setPromoterDrafts] = useState({});
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      const [analytics, guestlists] = await Promise.all([
        api(`/business/events/${EVENT}/analytics`),
        api(`/business/events/${EVENT}/guestlist-settings`),
      ]);
      setData(analytics);
      setSettings(guestlists);
      setDirectDraft(String(guestlists.direct.capacity));
      setPromoterDrafts(Object.fromEntries(guestlists.promoters.map((promoter) => [promoter.id, String(promoter.effectiveGuestlistAllocation)])));
    } catch (_error) {
      setData(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveDirect = async (event) => {
    event.preventDefault();
    try {
      await api(`/business/events/${EVENT}/guestlist-capacity`, { method: 'PATCH', body: JSON.stringify({ guestlistCapacity: Number(directDraft) }) });
      setNotice('Venue guestlist limit saved.');
      await load();
    } catch (error) { setNotice(error.message); }
  };

  const savePromoter = async (event, promoterId) => {
    event.preventDefault();
    try {
      await api(`/business/events/${EVENT}/affiliates/${promoterId}/guestlist-allocation`, { method: 'PATCH', body: JSON.stringify({ guestlistAllocation: Number(promoterDrafts[promoterId]) }) });
      setNotice('Promoter guestlist limit saved.');
      await load();
    } catch (error) { setNotice(error.message); }
  };

  const stats = data || {};
  const totalCapacity = settings ? settings.direct.capacity + settings.promoters.reduce((total, promoter) => total + promoter.effectiveGuestlistAllocation, 0) : 0;

  return <div className="shell">
    <aside><b>NITEWIDE<span>.</span></b><small>BUSINESS</small><nav>{['Overview', 'Events', 'Orders', 'Guestlists', 'Affiliates', 'Customers', 'Insights'].map((item, index) => <a className={index === 0 ? 'active' : ''} key={item}>{item}<em>{index === 1 ? '4' : ''}</em></a>)}</nav><div className="account">NC<div><strong>Northstar Collective</strong><small>Premium plan</small></div></div></aside>
    <main>
      <header><div><p>Saturday, September 20</p><h1>Good evening, Maya.</h1></div><button>＋ Create event</button></header>
      {data === false && <div className="warning">Start and seed the Nitewide API to load live business data.</div>}
      <section className="event"><div><small>LIVE EVENT</small><h2>{settings?.title || 'Afterglow'}</h2><p>In 14 days · Harbor Hall</p></div><button>Manage event →</button></section>
      <section className="stats"><article><span>Gross sales</span><strong>{data ? usd(stats.grossSalesCents) : '—'}</strong><small>Across {stats.paidOrders || 0} paid orders</small></article><article><span>Tickets sold</span><strong>{data ? stats.ticketsSold : '—'}</strong><small>Live inventory tracking</small></article><article><span>Attendance</span><strong>{data ? `${Math.round((stats.attendanceRate || 0) * 100)}%` : '—'}</strong><small>{stats.checkedIn || 0} credentials scanned</small></article><article><span>Guestlist</span><strong>{data ? stats.guestlistConfirmed : '—'}</strong><small>{stats.guestlistPending || 0} awaiting approval</small></article></section>
      {settings && <section className="guestlist-settings">
        <div className="settings-heading"><div><small>GUESTLIST CAPACITY</small><h3>Independent entry pools</h3><p>The venue list and each promoter list have separate limits. Combined capacity: {totalCapacity} guests.</p></div>{notice && <span>{notice}</span>}</div>
        <div className="capacity-grid">
          <form onSubmit={saveDirect}><div><b>Venue guestlist</b><small>{settings.direct.used} confirmed · Direct requests only</small></div><label>Maximum guests<input min="0" type="number" value={directDraft} onChange={(event) => setDirectDraft(event.target.value)} /></label><button type="submit">Save</button></form>
          {settings.promoters.map((promoter) => <form key={promoter.id} onSubmit={(event) => savePromoter(event, promoter.id)}><div><b>{promoter.user?.displayName || promoter.code}</b><small>{promoter.used} confirmed · Code {promoter.code}</small></div><label>Maximum guests<input min="0" type="number" value={promoterDrafts[promoter.id] ?? ''} onChange={(event) => setPromoterDrafts((current) => ({ ...current, [promoter.id]: event.target.value }))} /></label><button type="submit">Save</button></form>)}
        </div>
      </section>}
      <section className="split"><article><div className="title"><div><small>REVENUE PULSE</small><h3>Sales this week</h3></div><button>7 days⌄</button></div><div className="chart">{[22, 35, 28, 58, 48, 82, 68].map((height, index) => <i key={index} style={{ height: `${height}%` }}><span>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</span></i>)}</div></article><article><div className="title"><div><small>AFFILIATE SIGNAL</small><h3>Top performers</h3></div></div>{[['Leo Promoter', '10%', '2 orders'], ['Direct', '—', 'Guestlist'], ['Maya Owner', '—', 'Creator']].map((row, index) => <div className="person" key={row[0]}><b>{index + 1}</b><span><strong>{row[0]}</strong><small>{row[2]}</small></span><em>{row[1]}</em></div>)}</article></section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
