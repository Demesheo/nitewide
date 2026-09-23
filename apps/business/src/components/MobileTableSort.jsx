/** Phone counterpart of clickable table headers. Uses the same parent sort state. */
export function MobileTableSort({ columns, value, descending, onChange, onToggle }) {
  return <div className="table-mobile-sort">
    <label><span className="sr-only">Sort by</span><select aria-label="Sort table by" value={value} onChange={(event) => onChange(event.target.value)}>
      {columns.map(({ key, label }) => <option key={key} value={key}>{`Sort by · ${label}`}</option>)}
    </select></label>
    <button type="button" aria-label={descending ? 'Sort ascending' : 'Sort descending'} title={descending ? 'Descending — switch to ascending' : 'Ascending — switch to descending'} onClick={onToggle}>
      <span aria-hidden="true">{descending ? '↓' : '↑'}</span>
    </button>
  </div>;
}
