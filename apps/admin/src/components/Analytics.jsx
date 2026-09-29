import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { exportCsv, formatMoney } from '../lib/admin';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import DrillTable from './AnalyticsDrillTable';

const colors = ['#b9a9ff', '#fe6ef0', '#0446ef', '#f10393', '#8b85c5'];
const metrics = [
  ['salesCents', 'Face-value sales', (v) => formatMoney(v)], ['orders', 'Paid orders', (v) => v.toLocaleString()],
  ['customers', 'Unique customers', (v) => v.toLocaleString()], ['units', 'Units sold', (v) => v.toLocaleString()],
  ['admissions', 'Admissions', (v) => v.toLocaleString()], ['averageOrderCents', 'Average order', (v) => formatMoney(v)],
];
const presets = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '365 days'], ['custom', 'Custom']];
function MultiSelect({ label, options, values, onChange }) {
  const count = values.length;
  return <details className="relative group"><summary className="list-none cursor-pointer rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground min-w-44">{label}{count ? ` · ${count} selected` : ' · All'} <span className="float-right ml-2">⌄</span></summary><div className="absolute z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl"><Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Clear selection</Button>{options.map((item) => <label className="flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent" key={item.id}><input type="checkbox" checked={values.includes(item.id)} onChange={() => onChange(values.includes(item.id) ? values.filter((value) => value !== item.id) : [...values, item.id])}/><span>{item.label}</span></label>)}</div></details>;
}
function ChartCard({ title, description, children }) { return <Card className="min-w-0 p-5"><h3 className="text-lg font-semibold">{title}</h3><p className="mb-5 text-xs text-muted-foreground">{description}</p>{children}</Card>; }
function OverviewCharts({ data }) {
  const regions = data.hierarchy.filter((row) => row.level === 'region').slice(0, 8);
  return <div className="grid gap-4 xl:grid-cols-2">
    <ChartCard title="Sales & order pace" description="Paid orders by payment date · UTC"><div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily}><CartesianGrid vertical={false} stroke="#343044" strokeDasharray="3 5"/><XAxis dataKey="date" tick={{ fill: '#a5a5b8', fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/><YAxis tick={{ fill: '#a5a5b8', fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 100)}`}/><Tooltip formatter={(value, name) => [name === 'salesCents' ? formatMoney(value) : value, name === 'salesCents' ? 'Sales' : 'Orders']}/><Area dataKey="salesCents" stroke="#b9a9ff" fill="#b9a9ff33" strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div></ChartCard>
    <ChartCard title="Top regions" description="Where selected sales are happening"><div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={regions} layout="vertical" margin={{ left: 4, right: 18 }}><CartesianGrid horizontal={false} stroke="#343044"/><XAxis type="number" tick={{ fill: '#a5a5b8', fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 100)}`}/><YAxis dataKey="label" type="category" width={120} tick={{ fill: '#c4b8d6', fontSize: 10 }}/><Tooltip formatter={(value) => formatMoney(value)}/><Bar dataKey="salesCents" fill="#fe6ef0" radius={[0, 4, 4, 0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div></ChartCard>
    <ChartCard title="Experience mix" description="Face-value sales by category"><div className="h-52"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.category} dataKey="salesCents" nameKey="label" innerRadius={48} outerRadius={82} isAnimationActive={false}>{data.category.map((item, index) => <Cell key={item.label} fill={colors[index % colors.length]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(value)}/></PieChart></ResponsiveContainer></div><div className="flex flex-wrap gap-2 text-xs">{data.category.map((item, index) => <span key={item.label} style={{ color: colors[index % colors.length] }}>{item.label} · {formatMoney(item.salesCents)}</span>)}</div></ChartCard>
    <ChartCard title="Ticket & package volume" description="Units sold by offering snapshot"><div className="space-y-3">{data.offerings.slice(0, 6).map((item) => <div key={`${item.kind}:${item.label}`} className="flex items-center justify-between gap-4 border-b border-border pb-2 text-sm"><span>{item.label}<small className="block text-muted-foreground">{item.kind}</small></span><strong>{item.units} units · {formatMoney(item.salesCents)}</strong></div>)}{!data.offerings.length && <p className="text-sm text-muted-foreground">No paid offerings in this period.</p>}</div></ChartCard>
  </div>;
}
export default function Analytics() {
  const [period, setPeriod] = useState('30'); const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState(''); const [regions, setRegions] = useState([]); const [organizations, setOrganizations] = useState([]); const [search, setSearch] = useState(''); const [result, setResult] = useState(null); const [requestError, setRequestError] = useState(null); const [availableOptions, setAvailableOptions] = useState(null); const [path, setPath] = useState([]);
  const invalidDateRange = period === 'custom' && startDate && endDate && startDate > endDate;
  const request = useMemo(() => { if (period === 'custom' && (!startDate || !endDate || startDate > endDate)) return null; const params = new URLSearchParams(); if (period === 'custom') { params.set('startDate', startDate); params.set('endDate', endDate); } else params.set('days', period); regions.forEach((value) => params.append('regions', value)); organizations.forEach((value) => params.append('organizationIds', value)); if (search.trim()) params.set('search', search.trim()); return params.toString(); }, [period, startDate, endDate, regions, organizations, search]);
  const latestRequest = useRef(request); latestRequest.current = request;
  const data = request && result?.request === request ? result.data : null;
  const error = request && requestError?.request === request ? requestError.message : '';
  const options = availableOptions;
  useEffect(() => {
    if (!request) return;
    let active = true;
    const controller = new AbortController();
    setResult(null); setRequestError(null);
    const timer = setTimeout(() => {
      api(`/admin/analytics?${request}`, { signal: controller.signal }).then((value) => {
        if (!active || latestRequest.current !== request) return;
        setResult({ request, data: value }); setAvailableOptions(value.options); setRequestError(null); setPath([]);
      }).catch((err) => {
        if (active && latestRequest.current === request && err.name !== 'AbortError') setRequestError({ request, message: err.message });
      });
    }, 220);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [request]);
  const customDatePrompt = period !== 'custom' ? null : invalidDateRange
    ? <p className="error" role="alert">End date must be on or after start date.</p>
    : !startDate || !endDate ? <p className="text-sm text-muted-foreground">Choose a start and end date to load a custom report.</p> : null;
  const syncStartDate = (event) => setStartDate(event.currentTarget.value);
  const syncEndDate = (event) => setEndDate(event.currentTarget.value);
  return <div className="space-y-5"><Card className="p-4"><div className="analytics-toolbar flex flex-wrap items-end gap-3"><label className="text-xs text-muted-foreground">Sales period<select className="mt-1 block h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground" value={period} onChange={(e) => setPeriod(e.target.value)}>{presets.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{period === 'custom' && <><label className="text-xs text-muted-foreground">Start date<Input className="mt-1" type="date" value={startDate} onInput={syncStartDate} onChange={syncStartDate} onBlur={syncStartDate}/></label><label className="text-xs text-muted-foreground">End date<Input className="mt-1" type="date" value={endDate} onInput={syncEndDate} onChange={syncEndDate} onBlur={syncEndDate}/></label></>}<MultiSelect label="Regions" options={(options?.regions || []).map((item) => ({ id: item, label: item }))} values={regions} onChange={setRegions}/><MultiSelect label="Organizations" options={options?.organizations || []} values={organizations} onChange={setOrganizations}/><label className="analytics-search relative min-w-52 flex-1"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><Input aria-label="Search all analytics" className="pl-9" placeholder="Search regions, venues, events, customers…" value={search} onChange={(e) => setSearch(e.target.value)}/></label><Button variant="outline" onClick={() => { setRegions([]); setOrganizations([]); setSearch(''); setPeriod('30'); setStartDate(''); setEndDate(''); }}>Reset</Button><Button variant="outline" disabled={!data} onClick={() => { if (data) exportCsv(`nitewide-admin-analytics-${data.range.startDate}-${data.range.endDate}.csv`, data.hierarchy); }}>Export CSV</Button></div><p className="mt-3 text-xs text-muted-foreground">Paid USD order subtotals, grouped by event location. Dates use UTC. Multiple selections are combined within each filter.</p></Card>{customDatePrompt}{error && <p className="error" role="alert">{error}</p>}{request && !data && !error && <p className="loading" role="status">Loading analytics…</p>}{data && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([key,label,format]) => <Card className="p-5" key={key}><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{format(data.summary[key])}</strong></Card>)}</div><OverviewCharts data={data}/><DrillTable data={data} path={path} setPath={setPath}/></>}</div>;
}
