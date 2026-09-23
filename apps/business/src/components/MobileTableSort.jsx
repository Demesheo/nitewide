/** Phone counterpart of clickable table headers. Uses the same parent sort state. */
export function MobileTableSort({ columns, value, descending, onChange, onToggle }) {
  return <div className="table-mobile-sort">
    <label>Sort by<select aria-label="Sort table by" value={value} onChange={(event) => onChange(event.target.value)}>
      {columns.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <button type="button" aria-label={descending ? 'Sort ascending' : 'Sort descending'} onClick={onToggle}>
      {descending ? 'Descending ↓' : 'Ascending ↑'}
    </button>
  </div>;
}
