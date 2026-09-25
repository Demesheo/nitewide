import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, CircleAlert, ImagePlus, LoaderCircle, QrCode, RefreshCw, Search, ShieldX, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Choice, Empty } from '@/components/controls';
import { LoadingState } from '@/components/LoadingState';
import { AdmissionCamera } from '@/components/AdmissionCamera';
import { api } from '@/lib/api';
import { admissionResult } from '@/lib/admissions';
import './admissions.css';

const dateLabel = (event) => new Date(event.startsAt).toLocaleString('en-US', { timeZone: event.location?.timezone || 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function Admissions({ session, onAdmitted, onUnauthorized }) {
  const [events, setEvents] = useState(null), [event, setEvent] = useState(null), [eventSearch, setEventSearch] = useState('');
  const [mode, setMode] = useState('scan'), [camera, setCamera] = useState(false), [cameraMessage, setCameraMessage] = useState('');
  const [roster, setRoster] = useState(null), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null), [confirm, setConfirm] = useState(null), [online, setOnline] = useState(navigator.onLine);
  const inFlight = useRef(false), photoInput = useRef(null), panel = useRef(null), photoRun = useRef(0);
  const eventId = event?.id;
  useEffect(() => { photoRun.current += 1; return () => { photoRun.current += 1; }; }, [eventId]);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (!navigator.onLine) setCamera(false); };
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await api('/business/admissions/events', session, { signal: controller.signal });
        if (!controller.signal.aborted) setEvents(data.events);
      } catch (err) { if (!controller.signal.aborted) { if (err.status === 401) onUnauthorized(); else setError(err.message); } }
    }
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [session, onUnauthorized, revision]);
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController(); let pending = false;
    setRoster(null); setLoading(true); setError('');
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const params = new URLSearchParams({ search: query, status, page });
        const data = await api(`/business/admissions/events/${eventId}?${params}`, session, { signal: controller.signal });
        if (!controller.signal.aborted) { setRoster(data); setError(''); }
      } catch (err) {
        if (!controller.signal.aborted) { setCamera(false); if (err.status === 401) onUnauthorized(); else setError(err.message); }
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    const refresh = () => { if (!document.hidden) load(); };
    const timer = setInterval(refresh, 8000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [eventId, session, query, page, status, revision, onUnauthorized]);
  const submit = useCallback(async (credential) => {
    if (inFlight.current) return;
    setCamera(false); setConfirm(null); setCameraMessage('');
    if (!navigator.onLine) { setResult({ type: 'error', title: 'Check-in not confirmed', message: 'You are offline. Reconnect before admitting this guest.' }); return; }
    inFlight.current = true; setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const data = await api('/check-ins', session, { method: 'POST', signal: controller.signal, body: JSON.stringify({ eventId, ...credential }) });
      setResult({ type: 'confirmed', title: 'Confirmed', message: `${data.credential.spots === 1 ? '1 guest' : `${data.credential.spots} guests`} admitted.`, credential: data.credential });
      onAdmitted();
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setResult(admissionResult(err.name === 'AbortError' ? new Error('The server did not confirm this check-in. Check your connection and scan again; an existing admission will be recognized.') : err));
    }
    finally { clearTimeout(timeout); setRevision((v) => v + 1); inFlight.current = false; setBusy(false); }
  }, [session, eventId, onAdmitted, onUnauthorized]);
  const onScan = useCallback((qrToken) => submit({ qrToken }), [submit]);
  const onCameraError = useCallback((message) => { setCamera(false); setCameraMessage(message); }, []);
  const onPause = useCallback(() => { setCamera(false); setCameraMessage('Camera paused. Tap Start camera when you are ready.'); }, []);
  async function scanPhoto(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || inFlight.current) return;
    setCamera(false); setCameraMessage('');
    if (file.size > 15 * 1024 * 1024) { setCameraMessage('Choose an image smaller than 15 MB.'); return; }
    setBusy(true);
    const run = photoRun.current;
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const decoded = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      if (run !== photoRun.current) return;
      await onScan(decoded.getText());
    } catch { if (run === photoRun.current) setResult({ type: 'invalid', title: 'Invalid', message: 'No readable QR code was found. Try a clearer photo or use manual check-in.' }); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }
  function chooseEvent(selected) { setEvent(selected); setSearch(''); setQuery(''); setStatus('all'); setPage(1); setRoster(null); setCamera(false); setCameraMessage(''); setError(''); setResult(null); }
  const matchingEvents = events?.filter((row) => `${row.title} ${row.location?.name || ''}`.toLowerCase().includes(eventSearch.toLowerCase())) || [];
  const ResultIcon = result?.type === 'confirmed' ? CheckCircle2 : result?.type === 'already' ? CircleAlert : ShieldX;
  return <div className="admissions">
    {!online && <p className="error" role="alert">You are offline. Reconnect to confirm admissions.</p>}
    {error && <p className="error" role="alert">{error}<Button variant="outline" onClick={() => setRevision((v) => v + 1)}>Retry</Button></p>}
    {!event ? <section className="panel"><div className="section-heading"><div><h2>Select an event</h2><p>Available 24 hours before start through 24 hours after finish.</p></div></div><div className="admissions-body"><label className="admission-search"><Search size={18}/><Input aria-label="Search admission events" placeholder="Search events or venues" value={eventSearch} onChange={(e) => setEventSearch(e.target.value)}/></label>
      {!events && !error && <LoadingState>Finding your events…</LoadingState>}
      {events && !matchingEvents.length && <Empty title="No events in this window">Your assigned events will appear here when admissions become available.</Empty>}
      <div className="admission-events">{matchingEvents.map((row) => <button key={row.id} className="admission-event" onClick={() => chooseEvent(row)}><span><small>{dateLabel(row)}</small><strong>{row.title}</strong><span>{row.location?.name || row.location?.city || 'Independent event'}</span></span><ChevronRight size={20}/></button>)}</div>
    </div></section> : <section ref={panel} className="panel admission-workspace">
      <div className="admission-heading"><Button variant="ghost" size="sm" disabled={busy} onClick={() => chooseEvent(null)}><ArrowLeft size={16}/> Events</Button><div><h2>{event.title}</h2><p>{dateLabel(event)} · {event.location?.name || 'Event admissions'}</p></div><div className="admission-count" aria-live="polite"><strong>{roster ? `${roster.admitted} / ${roster.expected}` : '—'}</strong><span>Admitted / expected</span></div></div>
      <Tabs value={mode} onValueChange={(value) => { setMode(value); setCamera(false); setCameraMessage(''); }}>
        <TabsList className="report-tabs admission-tabs"><TabsTrigger value="scan" disabled={busy}><QrCode size={16}/> Scan QR</TabsTrigger><TabsTrigger value="manual" disabled={busy}><Users size={16}/> Manual check-in</TabsTrigger></TabsList>
        <TabsContent value="scan" className="admissions-body">
          {camera ? <><AdmissionCamera onScan={onScan} onError={onCameraError} onPause={onPause}/><Button className="admission-wide" variant="outline" onClick={() => setCamera(false)}>Stop camera</Button></> : <div className="admission-camera-idle"><QrCode size={48}/><h3>Ready at the door</h3><p>Scan a ticket, VIP package admission, or approved guestlist QR code.</p><Button disabled={busy || !online || Boolean(error)} onClick={() => { setCameraMessage(''); setCamera(true); }}><Camera size={18}/> Start camera</Button></div>}
          {cameraMessage && <p className="admission-camera-message" role="status">{cameraMessage}</p>}
          <input ref={photoInput} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Scan QR photo" onChange={scanPhoto} disabled={busy || !online}/>
          <Button className="admission-wide" variant="ghost" disabled={busy || !online || Boolean(error)} onClick={() => photoInput.current?.click()}><ImagePlus size={18}/> Scan a photo</Button>
        </TabsContent>
        <TabsContent value="manual" className="admissions-body">
          <div className="admission-list-tools"><Choice label="Admission status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[["all", "All guests"], ["ready", "Ready for entry"], ["admitted", "Admitted"]]}/><Button variant="ghost" size="icon" aria-label="Refresh admissions" onClick={() => setRevision((v) => v + 1)}><RefreshCw size={17}/></Button></div>
          <label className="admission-search"><Search size={18}/><Input aria-label="Search guests" placeholder="Name, email, or pass ID" value={search} onChange={(e) => setSearch(e.target.value)}/></label>
          {loading && <LoadingState>Updating guest list…</LoadingState>}
          {!loading && roster && !roster.entries.length && <Empty title="No matching guests">Only valid tickets and approved guestlist entries can be admitted.</Empty>}
          <div className="admission-roster">{roster?.entries.map((row) => <article key={`${row.kind}-${row.id}`} className={`admission-person ${row.status === 'checked_in' ? 'is-admitted' : ''}`}><header><strong>{row.name}</strong><span className="admission-status">{row.status === 'checked_in' ? 'Admitted' : 'Ready'}</span></header><p>{row.email}</p><div className="admission-person-offering"><span>{row.offering}<small>{row.spots} {row.spots === 1 ? 'spot' : 'spots'}{row.kind === 'guestlist' ? ' · Entire party' : ' · Individual pass'}</small></span><Button variant="outline" size="sm" disabled={busy || !online} onClick={() => row.status === 'checked_in' ? setResult({ type: 'already', title: 'Already admitted', message: 'This pass has already been checked in. Do not admit again.', credential: row }) : setConfirm(row)}>{row.status === 'checked_in' ? 'Details' : 'Admit'}</Button></div><code>Pass ID · {row.id}</code></article>)}</div>
          {roster?.total > 20 && <div className="admission-pagination"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => { setPage(page - 1); panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>Previous</Button><span>{page} / {Math.ceil(roster.total / 20)}</span><Button variant="outline" disabled={page * 20 >= roster.total || loading} onClick={() => { setPage(page + 1); panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>Next</Button></div>}
        </TabsContent>
      </Tabs>
      {busy && <div className="admission-busy" role="status"><LoaderCircle className="nw-loading-icon"/> Confirming admission…</div>}
    </section>}
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent className="admission-dialog"><DialogTitle>Admit {confirm?.name}?</DialogTitle><DialogDescription>{confirm?.offering} · {confirm?.spots} {confirm?.spots === 1 ? 'spot' : 'spots'}. {confirm?.kind === 'guestlist' ? 'This checks in the entire approved party. Confirm everyone is present.' : 'Confirm the guest’s identity before admitting.'}</DialogDescription><div className="admission-dialog-actions"><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button disabled={busy || !online} onClick={() => submit({ credentialId: confirm.id, kind: confirm.kind })}>Confirm entry</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(result)} onOpenChange={(open) => { if (!open) setResult(null); }}><DialogContent className={`admission-dialog admission-result admission-result-${result?.type}`}><ResultIcon className="admission-result-icon" size={44}/><DialogTitle>{result?.title}</DialogTitle><DialogDescription>{result?.message}</DialogDescription>{result?.credential && <div className="admission-result-person"><strong>{result.credential.name}</strong><span>{result.credential.offering} · {result.credential.spots} {result.credential.spots === 1 ? 'spot' : 'spots'}</span>{result.credential.checkedInAt && <small>Admitted {new Date(result.credential.checkedInAt).toLocaleString('en-US', { timeZone: event?.location?.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>}</div>}<Button onClick={() => { setResult(null); if (mode === 'scan' && online && !error) setCamera(true); }}>{mode === 'scan' ? 'Scan next' : 'Done'}</Button></DialogContent></Dialog>
  </div>;
}
