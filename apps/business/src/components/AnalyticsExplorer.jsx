import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/business';
import { chartMoneyLabel, chartTick, chartTooltipStyles } from '@/lib/chart-display';
import { hasMultipleRegions } from '@/lib/analytics-explorer';

const eventColors = ['#b9a9ff', '#fe6ef0', '#0446ef', '#f10393', '#8b85c5', '#8b0535'];

function ContributionLabel({ x, y, payload }) {
  const label = String(payload.value);
  // Measure truncation by available space, not character count. Long names
  // remain available in the title and tooltip without spilling into other rows.
  return <g><title>{label}</title><Text x={x - 6} y={y} verticalAnchor="middle" textAnchor="end"
    width={118} maxLines={1} {...chartTick} style={{ fontSize: '12px', fontWeight: 400, letterSpacing: 0, fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>{label}</Text></g>;
}

export function ContributionChart({ data }) {
  const multipleRegions = hasMultipleRegions(data);
  const type = multipleRegions ? 'region' : 'event';
  const rows = data.hierarchy.filter((row) => row.level === type && row.salesCents > 0).sort((a, b) => b.salesCents - a.salesCents).slice(0, 6);
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">{multipleRegions ? 'Regional contribution' : 'Top events'}</h3><p className="mb-4 text-xs text-muted-foreground">{multipleRegions ? 'Selected sales by event location' : 'Highest face-value sales in this selection'}</p>{rows.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 0 }}><CartesianGrid horizontal={false} stroke="#353040"/><XAxis type="number" tickFormatter={chartMoneyLabel} tick={chartTick} axisLine={false} tickLine={false} minTickGap={24} interval="preserveStartEnd"/><YAxis dataKey="label" type="category" width={140} tick={<ContributionLabel/>} axisLine={false} tickLine={false}/><Tooltip position={{ x: 0 }} formatter={(value) => money(value)} {...chartTooltipStyles} cursor={{ fill: '#b9a9ff12' }}/><Bar name="Sales" dataKey="salesCents" radius={[0, 4, 4, 0]} isAnimationActive={false}>{rows.map((row, index) => <Cell key={row.id} fill={eventColors[index % eventColors.length]}/>)}</Bar></BarChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-muted-foreground">No paid sales in this period.</p>}</section>;
}
