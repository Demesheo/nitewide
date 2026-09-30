export function AnalyticsReportHeader({ title, description, action }) {
  return <div className="analytics-report-header">
    <div className="min-w-0"><span className="eyebrow">EXPLORE PERFORMANCE</span><h3 className="text-lg font-semibold">{title}</h3></div>
    {action}
    <p className="text-xs text-muted-foreground">{description}</p>
  </div>;
}
