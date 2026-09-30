import { money } from '@/lib/business';

export function SalesMixRankBars({ rows, totalSales }) {
  const ranked = (rows || []).filter((row) => row.id !== 'other' && row.name !== 'Other').slice(0, 6);
  if (!ranked.length) return null;
  return <div className="rank-bars" aria-label="Top sales categories">
    {ranked.map((row, index) => <div className="rank-row" key={row.id}>
      <div><span className="rank-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="rank-name"><span className="rank-title"><span className="rank-title-name" title={row.name}>{row.name}</span>
          {row.dateLabel && <span className="rank-date">· {row.dateLabel}</span>}</span>
          <small>{row.units ?? row.orders ?? 0} {row.units == null ? 'orders' : 'units'}</small></span>
        <strong>{money(row.salesCents)}</strong></div>
      <div className="rank-track"><span style={{ width: `${totalSales ? Math.max(1, row.salesCents / totalSales * 100) : 0}%` }}/></div>
    </div>)}
  </div>;
}
