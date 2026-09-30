import { BarChart3, CircleDollarSign, Ticket, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, eventDateLabel } from '@/lib/business';
import { salesMixSlices } from '@/lib/sales-mix';
import { Empty } from './controls';
import { SalesMixPie } from './SalesMixPie';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function RankBars({ rows, empty, total }) {
  const ranked = rows.filter((row) => row.id !== 'other').slice(0, 6);
  if (!ranked.length) return <Empty title="No sales yet">{empty}</Empty>;
  return (
    <div className="rank-bars">
      {ranked.map((r, i) => (
        <div className="rank-row" key={r.id}>
          <div>
            <span className="rank-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="rank-name">
              <span className="rank-title"><span className="rank-title-name" title={r.name}>{r.name}</span>{r.dateLabel && <span className="rank-date">· {r.dateLabel}</span>}</span>
              <small>
                {r.units ?? r.orders} {r.units != null ? "units" : "orders"}
              </small>
            </span>
            <strong>{money(r.salesCents)}</strong>
          </div>
          <div className="rank-track">
            <span
              style={{
                width: `${total ? Math.max(1, (r.salesCents / total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function SalesMix({ rows, total, empty }) {
  const slices = salesMixSlices(rows);
  if (!slices.length) return <Empty title="No sales yet">{empty}</Empty>;
  return (
    <>
      <SalesMixPie slices={slices}/>
      <RankBars rows={rows} total={total} empty={empty}/>
    </>
  );
}
export function OverviewPresentation({ data, beforeCharts }) {
  const { report } = data;
  const s = report.summary;
  const eventDates = new Map(data.events.map((event) => [event.id, eventDateLabel(event)]));
  const eventRows = report.events.filter((event) => event.salesCents).map((event) => ({ ...event, dateLabel: eventDates.get(event.id) }));
  return (
    <>
      <div className="metric-grid">
        <Metric
          label="Gross sales"
          value={money(s.salesCents)}
          detail="Paid order subtotals · USD"
          icon={CircleDollarSign}
        />
        <Metric
          label="Paid orders"
          value={s.orders.toLocaleString()}
          detail={`${s.checkedIn.toLocaleString()} / ${(s.admissions + s.guestlistPlaces).toLocaleString()} admitted · selected period`}
          icon={Ticket}
        />
        <Metric
          label="Average order"
          value={money(s.orders ? Math.round(s.salesCents / s.orders) : 0)}
          detail="Before customer checkout fees"
          icon={BarChart3}
        />
        <Metric
          label="Promoter commissions"
          value={money(s.commissionCents)}
          detail="Recorded commission · not payout status"
          icon={Users}
        />
      </div>
      {beforeCharts}
      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE BIG PICTURE</span>
              <h2>Sales over time</h2>
              <p>Every experience adds up.</p>
            </div>
            <span className="legend-dot">Gross sales</span>
          </div>
          <div className="chart-summary">
            <strong>{money(s.salesCents)}</strong>
            <span>in the selected period</span>
          </div>
          <div
            className="revenue-chart"
            role="img"
            aria-label={`Daily gross sales in USD over ${data.range.days} days. Total ${money(s.salesCents)}. Use Export report for the daily data.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={report.daily}
                margin={{ left: 0, right: 12, top: 15, bottom: 0 }}
                accessibilityLayer
              >
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a69aff" stopOpacity={0.34} />
                    <stop
                      offset="100%"
                      stopColor="#a69aff"
                      stopOpacity={0.01}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#292a37"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) =>
                    new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })
                  }
                  tick={{ fill: "#9393a6", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={35}
                />
                <YAxis
                  tickFormatter={(v) =>
                    `$${v >= 100000 ? `${Math.round(v / 100000)}k` : Math.round(v / 100)}`
                  }
                  tick={{ fill: "#9393a6", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                />
                <Tooltip
                  formatter={(v) => [money(v), "Gross sales"]}
                  contentStyle={{
                    background: "#20202c",
                    border: "1px solid #3b394d",
                    borderRadius: 12,
                    color: "#fafafa",
                  }}
                />
                <Area
                  dataKey="salesCents"
                  type="linear"
                  stroke="#b2a6ff"
                  strokeWidth={2.5}
                  fill="url(#salesFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-footnote">
            <span>Sales booked by payment date</span>
            <span>USD · fees excluded</span>
          </div>
        </section>
        <section className="panel breakdown-panel">
          <Tabs defaultValue="packages">
            <div className="section-heading">
              <div>
                <span className="eyebrow">WHAT’S WORKING</span>
                <h2>Sales mix</h2>
              </div>
            </div>
            <TabsList className="report-tabs">
              <TabsTrigger value="packages">Tickets & packages</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
            <TabsContent value="packages">
              <SalesMix
                rows={report.packages}
                total={s.salesCents}
                empty="Your ticket and package sales will appear here."
              />
            </TabsContent>
            <TabsContent value="events" className="event-sales-mix">
              <SalesMix
                rows={eventRows}
                total={s.salesCents}
                empty="Publish an event and make your first sale."
              />
            </TabsContent>
          </Tabs>
          <p className="hint">
            Top 6 by gross sales. Export includes every row.
          </p>
        </section>
      </div>

    </>
  );
}
