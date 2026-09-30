import { ArrowRight, ChevronDown, ClipboardList, Mail, Package } from 'lucide-react';
import { Button } from './ui/button';
import { LoadingState } from './LoadingState';

const categories = [
  { key: 'pendingGuestlist', label: 'Guestlist requests', icon: ClipboardList },
  { key: 'pendingInvitations', label: 'Pending invitations', icon: Mail },
  { key: 'lowInventory', label: 'Low inventory', icon: Package },
];

const itemLabels = {
  pending_guestlist: 'Guestlist request',
  pending_invitation: 'Pending invitation',
  low_inventory: 'Low inventory',
};

const itemIcons = {
  pending_guestlist: ClipboardList,
  pending_invitation: Mail,
  low_inventory: Package,
};

function itemDetail(item) {
  if (item.kind === 'pending_guestlist') return `${item.personName} · ${item.partySize} ${item.partySize === 1 ? 'place' : 'places'}`;
  if (item.kind === 'low_inventory') return `${item.name} · ${item.remaining} remaining`;
  if (item.kind === 'pending_invitation') return item.email;
  return '';
}

export function OverviewNeedsAttention({ attention, loading = false, error = '', onRetry, onNavigate }) {
  const items = attention?.items?.filter((item) => Object.hasOwn(itemLabels, item.kind)) || [];
  return <section className="panel overview-attention" aria-label="Needs attention" aria-busy={loading}>
    <div className="section-heading"><div>
      <span className="eyebrow">NEXT UP</span>
      <h2>Needs attention</h2>
      <p>Requests, invitations, and inventory in your workspace.</p>
    </div></div>
    <div className="overview-attention-body">
      <div className="overview-attention-counts">
        {categories.map(({ key, label, icon: Icon }) => <div className="overview-attention-count" key={key}>
          <span className="overview-attention-count-icon"><Icon size={17} aria-hidden="true"/></span>
          <strong>{attention?.counts?.[key] ?? '—'}</strong>
          <span>{label}</span>
        </div>)}
      </div>
      {loading && <LoadingState>{attention ? 'Updating actions…' : 'Loading actions…'}</LoadingState>}
      {error && <div className="error" role="alert">{error}<Button type="button" variant="outline" onClick={onRetry}>Try again</Button></div>}
      {attention && (items.length ? <details className="overview-attention-actions">
        <summary><span>View actions <small>· {items.length} shown</small></span><ChevronDown size={17} aria-hidden="true"/></summary>
        <p className="overview-attention-preview-note">A preview of your open actions.</p>
        <div className="overview-attention-list">{items.map((item) => {
          const Icon = itemIcons[item.kind];
          return <button key={`${item.kind}:${item.id || item.eventId}`} type="button" onClick={() => onNavigate(item.kind === 'pending_invitation' && item.organizationId ? 'team' : 'events', item.eventId || null, item.kind === 'pending_guestlist' ? item.id : null, item.kind === 'pending_guestlist' ? 'guestlist' : null)}>
            <span className="overview-attention-item-icon"><Icon size={17} aria-hidden="true"/></span>
            <span className="overview-attention-item-copy"><small>{itemLabels[item.kind] || 'Action'}</small><strong>{item.title || item.name || 'Your event'}</strong><span>{itemDetail(item)}</span></span>
            <ArrowRight className="overview-attention-item-arrow" size={17} aria-hidden="true"/>
          </button>;
        })}</div>
      </details> : <p className="overview-attention-empty">No open actions right now.</p>)}
    </div>
  </section>;
}
