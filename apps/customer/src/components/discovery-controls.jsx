export function DiscoveryControls({ city, scope = 'nearby', disabled = false, onChange }) {
  const cityLabel = city?.split(',')[0].trim() || 'City';
  return <div className="discovery-controls">
    <div className="discovery-scope-controls" role="group" aria-label="Discovery area" data-discovery-control>
      <button type="button" disabled={disabled} aria-pressed={scope === 'nearby'} onClick={() => { if (scope !== 'nearby') onChange({ scope: 'nearby' }); }}>Include nearby cities</button>
      <button type="button" disabled={disabled} aria-pressed={scope === 'city'} onClick={() => { if (scope !== 'city') onChange({ scope: 'city' }); }}>{cityLabel} only</button>
    </div>
  </div>;
}

export function DiscoverySort({ sort = 'recommended', disabled = false, onChange }) {
  return <label className="discovery-sort-control" data-discovery-control>
      <select aria-label="Sort" value={sort} disabled={disabled} onChange={(event) => onChange({ sort: event.target.value })}>
        <option value="recommended">Popular</option>
        <option value="distance">Distance</option>
        <option value="date">Soonest</option>
      </select>
    </label>;
}
