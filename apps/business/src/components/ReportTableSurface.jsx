/** Shared horizontally scrollable report table used by Overview and Analytics. */
export function ReportTableSurface({ label, className = '', children }) {
  return <div className={`table-wrap report-table-surface ${className}`} role="region" aria-label={label} tabIndex={0}>
    <table aria-label={label}>{children}</table>
  </div>;
}
