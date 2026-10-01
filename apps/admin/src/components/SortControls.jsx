export default function SortControls({ children, label = 'Sort results', single = false }) {
  return <div className={`admin-sort-controls${single ? ' admin-sort-single' : ''}`} role="group" aria-label={label}>{children}</div>;
}
