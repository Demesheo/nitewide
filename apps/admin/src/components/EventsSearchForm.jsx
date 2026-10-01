import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { eventDateFilter } from '../lib/event-date-filter';

export default function EventsSearchForm({ params, onUpdate, sortControls }) {
  const appliedSearch = params.get('search') || '';
  const appliedStart = params.get('startDate') || '';
  const appliedEnd = params.get('endDate') || '';
  const [search, setSearch] = useState(appliedSearch);
  const [startDate, setStartDate] = useState(appliedStart);
  const [endDate, setEndDate] = useState(appliedEnd);
  const [error, setError] = useState('');
  useEffect(() => setSearch(appliedSearch), [appliedSearch]);
  useEffect(() => { setStartDate(appliedStart); setEndDate(appliedEnd); setError(''); }, [appliedStart, appliedEnd]);
  function changeDate(key, value) {
    const nextStart = key === 'startDate' ? value : startDate;
    const nextEnd = key === 'endDate' ? value : endDate;
    if (key === 'startDate') setStartDate(value); else setEndDate(value);
    try { onUpdate(eventDateFilter(nextStart, nextEnd)); setError(''); }
    catch (caught) { setError(caught.message); }
  }
  function submit(event) {
    event.preventDefault();
    try { eventDateFilter(startDate, endDate); onUpdate({ search: search.trim(), page: 1 }); setError(''); }
    catch (caught) { setError(caught.message); }
  }
  return <form className="event-search-form" role="search" aria-label="Search events" onSubmit={submit}>
    <div className="event-search-controls"><label className="event-search-input" htmlFor="admin-record-search"><span className="sr-only">Search events</span><Search size={18} aria-hidden="true"/><Input id="admin-record-search" type="search" maxLength={120} placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
    <Button type="submit">Search</Button></div>
    <div className="event-filter-cluster" role="group" aria-label="Event dates and sorting"><div className="event-search-dates">
    <label className="event-search-start" htmlFor="admin-events-start-date">Start date<Input id="admin-events-start-date" type="date" value={startDate} aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-events-date-error' : undefined} onChange={(event) => changeDate('startDate', event.target.value)}/></label>
    <label className="event-search-end" htmlFor="admin-events-end-date">End date<Input id="admin-events-end-date" type="date" value={endDate} aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-events-date-error' : undefined} onChange={(event) => changeDate('endDate', event.target.value)}/></label>
    </div>
    {sortControls}
    </div>
    {error && <p className="error" id="admin-events-date-error" role="alert">{error}</p>}
  </form>;
}
