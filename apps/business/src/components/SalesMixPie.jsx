import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { money } from '@/lib/business';

const mixColors = ['#b9a9ff', '#fe6ef0', '#0446ef', '#f10393', '#8b85c5', '#8b0535', '#706b80'];

export function SalesMixPie({ slices }) {
  const total = slices.reduce((sum, row) => sum + row.salesCents, 0);
  if (!total) return null;
  return (
    <div className="mix-visual">
      <div className="mix-pie" role="img" aria-label={`Sales mix by face-value revenue: ${slices.map((row) => `${row.name}${row.dateLabel ? ` · ${row.dateLabel}` : ''} ${money(row.salesCents)}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices.map((row) => ({ ...row, name: `${row.name}${row.dateLabel ? ` · ${row.dateLabel}` : ''}` }))} dataKey="salesCents" nameKey="name" innerRadius={53} outerRadius={78} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {slices.map((row, index) => <Cell key={row.id} fill={mixColors[index % mixColors.length]}/>)}
            </Pie>
            <Tooltip formatter={(value) => money(value)} contentStyle={{ background: '#20202c', border: '1px solid #3b394d', borderRadius: 12, color: '#fafafa' }}/>
          </PieChart>
        </ResponsiveContainer>
        <span className="mix-pie-center"><strong>{money(total)}</strong><small>face-value sales</small></span>
      </div>
      <div className="mix-legend" aria-label="Sales mix legend">
        {slices.map((row, index) => <div key={row.id}><span className="mix-swatch" style={{ backgroundColor: mixColors[index % mixColors.length] }}/><span className="mix-legend-label"><span className="mix-legend-name" title={row.name}>{row.name}</span>{row.dateLabel && <span className="mix-legend-date">· {row.dateLabel}</span>}</span><strong>{Math.round((row.salesCents / total) * 100)}%</strong></div>)}
      </div>
    </div>
  );
}
