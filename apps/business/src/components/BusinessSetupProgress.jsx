import { useState } from 'react';
import { Check, ChevronDown, Circle, Rocket } from 'lucide-react';
import { Button } from './ui/button';
import './business-setup-progress.css';

const stripeDetails = {
  ready: 'Stripe has verified readiness for new paid events.',
  not_connected: 'Connect a default payment account to sell tickets and packages.',
  needs_attention: 'Complete Stripe’s requirements, then refresh your payment account.',
  needs_refresh: 'Your account needs a fresh Stripe status check before paid publishing.',
  disabled: 'Payments are disabled or the account is disconnecting.',
  unavailable: 'Paid checkout is not enabled in this environment yet.',
};

function OrganizationChecklist({ organization, progress, onOrganization, onPayments, onEvents, onCreate }) {
  const [expanded, setExpanded] = useState(!progress.firstEventPublished);
  const essentials = [progress.accessAccepted, progress.organizationConfigured, progress.firstEventPublished].filter(Boolean).length;
  const stripeReady = progress.stripe.status === 'ready';
  const paymentAction = stripeReady ? 'View payments' : progress.stripe.status === 'needs_refresh' ? 'Check Stripe status'
    : ['unavailable', 'disabled'].includes(progress.stripe.status) ? 'View payments' : 'Set up payments';
  const steps = [
    { id: 'access', title: 'Access accepted', done: progress.accessAccepted, detail: 'Your approved Business access is active.' },
    { id: 'organization', title: 'Organization configured', done: progress.organizationConfigured,
      detail: 'Your Nitewide workspace is configured. No organization address is required.', action: 'View organization', onAction: onOrganization },
    { id: 'venue', title: 'Saved venue', done: progress.venueAdded, qualifier: 'Optional',
      detail: progress.venueAdded ? 'Reuse a saved venue, or enter an address on each event.' : 'You can publish with just an event address. Save a venue only if useful.',
      action: progress.venueAdded ? 'View venues' : 'Add a venue', onAction: onOrganization },
    { id: 'stripe', title: 'Stripe ready', done: stripeReady, qualifier: 'Paid events only',
      detail: `${stripeDetails[progress.stripe.status] || stripeDetails.not_connected}${!stripeReady && !progress.stripe.canManage && progress.stripe.status !== 'unavailable' ? ' An owner or finance-authorized manager handles this.' : ''}`,
      action: progress.stripe.canManage ? paymentAction : null, onAction: onPayments },
    { id: 'event', title: 'First event published', done: progress.firstEventPublished,
      detail: progress.firstEventPublished ? 'You’ve published your first event. Keep building your next experience.' : 'Create an event with an address. Free tickets and guestlists need no Stripe setup.',
      action: progress.firstEventPublished ? 'View events' : 'Create your first event', onAction: progress.firstEventPublished ? onEvents : onCreate },
  ];
  return <details className="business-setup-disclosure" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="business-setup-mark"><Rocket size={19} aria-hidden="true"/></span>
      <span className="business-setup-heading"><strong>Business setup</strong><span>{organization.name} · {essentials === 3 ? 'You’ve published your first event' : 'Get ready for your first event'}</span></span>
      <span className="business-setup-count">{essentials}/3 essentials</span>
      <ChevronDown className="business-setup-chevron" size={18} aria-hidden="true"/>
    </summary>
    <div className="business-setup-content">
      <p className="business-setup-note">Free events and guestlists are available without Stripe. Saved venues are optional.</p>
      <ol className="business-setup-steps">{steps.map((step, index) => <li className={step.done ? 'is-complete' : ''} key={step.id}>
        <span className="business-setup-step-icon" aria-hidden="true">{step.done ? <Check size={16}/> : step.qualifier ? <Circle size={16}/> : index + 1}</span>
        <div className="business-setup-step-copy"><h3>{step.title}</h3>
          <span className="business-setup-step-state">{step.done ? 'Complete' : step.qualifier || 'Next step'}{step.done && step.qualifier ? ` · ${step.qualifier}` : ''}</span>
          <p>{step.detail}</p>
          {step.id === 'stripe' && progress.stripe.sharedSandbox && <span className="business-setup-sandbox">Shared sandbox routing · test payments only</span>}
          {step.action && <Button type="button" variant="outline" size="sm" onClick={() => step.onAction(organization.id)}>{step.action}</Button>}
        </div>
      </li>)}</ol>
    </div>
  </details>;
}

export function BusinessSetupProgress({ organizations = [], progress = [], selectedOrganizations = [], ...actions }) {
  const [chosenId, setChosenId] = useState('');
  const available = organizations.filter(org => org.canManage && progress.some(row => row.organizationId === org.id)
    && (!selectedOrganizations.length || selectedOrganizations.includes(org.id)));
  const organization = available.find(org => org.id === chosenId) || available.find(org => !progress.find(row => row.organizationId === org.id).firstEventPublished) || available[0];
  if (!organization) return null;
  return <section className="panel business-setup" aria-label="Business setup">
    {available.length > 1 && <div className="business-setup-selector"><label htmlFor="setup-organization">Setup for</label><select id="setup-organization" value={organization.id} onChange={event => setChosenId(event.target.value)}>
      {available.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
    </select></div>}
    <OrganizationChecklist key={organization.id} organization={organization} progress={progress.find(row => row.organizationId === organization.id)} {...actions}/>
  </section>;
}
