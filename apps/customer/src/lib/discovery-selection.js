import { parseDiscoverySelection } from '../../../shared/discovery-areas.mjs';

// Qualification only, never a geographic catalog or a client-side geocoder.
// The API resolves a submitted place to its official grouping/radius scope.
export function qualifiedDiscoveryCity(value) {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  return parseDiscoverySelection(value)?.label || '';
}

export function confirmedDiscoveryScope(area, resolutionStatus) {
  return Boolean(area && area.key && area.label && resolutionStatus === 'resolved');
}
