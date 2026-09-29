import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/admin';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import '../operations.css';

const queues = [
  ['failed_payments', 'Failed payment attempts', 'failedPayments'],
  ['pending_guestlist', 'Pending guestlist requests', 'pendingGuestlist'],
  ['suspended_organizations', 'Suspended organizations', 'suspendedOrganizations'],
];
const amount = (item) => item.currency && item.amountCents != null
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency, currencyDisplay: 'code' }).format(Number(item.amountCents) / 100)
  : 'Unavailable';

function context(item) {
  const order = item.order;
  const event = item.event || order?.event;
  const person = item.user || item.requester || order?.buyer;
  const organization = item.organization || event?.organization;
  return { order, event, person, organization };
}

function RecordDetails({ item, kind, onClose }) {
  const { order, event, person, organization } = context(item);
  const fields = kind === 'suspended_organizations'
    ? [['Name', item.name], ['Slug', item.slug], ['Plan', item.planTier], ['Status', item.status], ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)]]
    : [['Status', item.status], ['Person', person?.displayName], ['Email', person?.email], ['Event', event?.title], ['Organization', organization?.name], ['Created', formatDate(item.createdAt)], ...(kind === 'failed_payments' ? [['Provider', item.provider], ['Amount', amount(item)], ['Processed', formatDate(item.processedAt)], ['Order', order?.id], ['Current order status', order?.status]] : [['Party size', item.partySize], ['Source', item.source]])];
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="dialog"><DialogHeader><DialogTitle>Operation context</DialogTitle><DialogDescription>{item.id}</DialogDescription></DialogHeader><dl className="operations-details">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Unavailable'}</dd></div>)}</dl><Button variant="outline" onClick={onClose}>Close</Button></DialogContent></Dialog>;
}

export default function Operations({ initialKind = null, onManageRecord }) {
  const [kind, setKind] = useState(initialKind || queues[0][0]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const contextTrigger = useRef(null);
  const request = useRef(0);
  const userSelected = useRef(Boolean(initialKind));
  const autoSelected = useRef(Boolean(initialKind));
  useEffect(() => { userSelected.current = Boolean(initialKind); autoSelected.current = Boolean(initialKind); setKind(initialKind || queues[0][0]); setPage(1); setSelected(null); }, [initialKind]);
  useEffect(() => {
    const sequence = ++request.current;
    setBusy(true); setError(''); setSelected(null);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ kind, page: String(page), pageSize: '25', search });
      api(`/admin/operations?${query}`).then((result) => {
        if (sequence !== request.current) return;
        setData(result);
        if (!userSelected.current && !autoSelected.current) {
          autoSelected.current = true;
          const next = queues.find(([, , count]) => result.counts?.[count] > 0)?.[0] || queues[0][0];
          if (next !== kind) { setKind(next); setPage(1); }
        }
      }).catch((err) => {
        if (sequence === request.current) setError(err.message);
      }).finally(() => { if (sequence === request.current) setBusy(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); request.current += 1; };
  }, [kind, search, page, refresh]);
  const queue = data?.queue;
  const current = queue?.kind === kind && queue?.page === page;
  const title = queues.find(([key]) => key === kind)?.[1];
  function choose(next) { userSelected.current = true; autoSelected.current = true; setKind(next); setPage(1); }
  function closeContext() { setSelected(null); requestAnimationFrame(() => { if (contextTrigger.current?.isConnected) contextTrigger.current.focus(); }); }
  return <section className="operations" aria-busy={busy || (!current && !error)}>
    <div className="operations-heading"><div><h2>Review queues</h2><small>{data ? `Last loaded ${new Date(data.generatedAt).toLocaleString()}` : 'Waiting for the first successful load'}</small></div><Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{busy ? 'Loading…' : 'Refresh'}</Button></div>
    <div className="operations-queues">{queues.map(([key, label, count]) => <button type="button" className={`operations-queue ${kind === key ? 'selected' : ''}`} aria-pressed={kind === key} aria-label={`${label}: ${data?.counts?.[count] ?? 'loading'} records. Open queue`} key={key} onClick={() => choose(key)}><span>{label}<small>{kind === key ? 'Selected queue' : 'Open queue'}</small></span><strong>{data?.counts?.[count] ?? '—'}</strong></button>)}</div>
    <section className="panel operations-panel"><div className="operations-toolbar"><div><h3>{title}</h3><p>{kind === 'failed_payments' ? 'A failed attempt can belong to an order that was subsequently paid. Check the current order status.' : 'Read-only context for internal review.'}</p></div><label>Search this queue<Input value={search} maxLength={120} placeholder="Name, email, event, or reference" onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></label></div>
      {error && <div className="error" role="alert">{error} <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Retry</Button></div>}
      {busy || (!current && !error) ? <div className="empty" role="status">Loading queue…</div> : !error && current && <><p className="operations-result-count" role="status">{queue.total} {search ? 'matching ' : ''}records</p>{queue.items.length === 0 ? <div className="empty">{search ? 'No records match this search.' : `No ${title.toLowerCase()} need review right now.`}</div> : <div className="operations-records">{queue.items.map((item) => {
        const { order, event, person, organization } = context(item);
        return <article className="operations-record" key={item.id}><div><h4>{kind === 'suspended_organizations' ? item.name : person?.displayName || person?.email || 'Person unavailable'}</h4><p>{kind === 'suspended_organizations' ? item.slug : event?.title || 'Event unavailable'}</p><small>{kind === 'suspended_organizations' ? `Plan: ${item.planTier || 'Unavailable'}` : organization?.name || 'Organization unavailable'}</small><code>{item.id}</code></div><div className="operations-record-state"><span className="badge">{item.status}</span>{kind === 'failed_payments' && <><strong>{amount(item)}</strong><span>Order: {order?.status || 'Unavailable'}</span></>}<small>{formatDate(item.processedAt || item.createdAt)}</small><Button variant="outline" onClick={(event) => { contextTrigger.current = event.currentTarget; setSelected(item); }}>View context</Button>{onManageRecord && <Button variant="outline" onClick={() => onManageRecord(kind, item)}>Open in Management</Button>}</div></article>;
      })}</div>}<div className="operations-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {Math.max(1, Math.ceil(queue.total / queue.pageSize))}</span><Button variant="outline" disabled={page * queue.pageSize >= queue.total} onClick={() => setPage((value) => value + 1)}>Next</Button></div></>}
    </section>{selected && <RecordDetails item={selected} kind={kind} onClose={closeContext}/>}
  </section>;
}
