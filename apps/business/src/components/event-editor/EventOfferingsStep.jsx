import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { SelectField } from '../controls';
import { TierEditor } from '../TierEditor';
import { removeOffering } from '../../lib/business';

export function EventOfferingsStep({ draft, event, duplicateSource, addedTierKey, publishChecks, setPublishChecks,
  addTier, tier, setDraft, set }) {
  return <>
    <SelectField id="event-fee-mode" label="Default fee payment" value={draft.feeMode || 'buyer'}
      onChange={(value) => set('feeMode', value)} options={[
        ['buyer', 'Customer pays added fees'], ['absorbed', 'Business absorbs fees'],
      ]}/>
    <p className="hint">Override this per offering if needed. Absorbed-fee purchases require at least $10 before taxes. Prices and commissions must leave positive business proceeds and cover the modeled $1 platform contribution; free admission is exempt. Payment processing is still simulated.</p>
    <p className="hint">Free events and guestlists do not require Stripe. Paid publication uses your organization’s default payment account and requires verified Stripe readiness. To choose a different account, save a draft and select it in Event payments before publishing. Demo environments support simulated sales.</p>
    <div className="section-heading tier-ladder-heading"><div><h3>Build your ticket ladder</h3>
      <p>Set your prices and quantities. Sell tiers together, or link them to open one after another. Tap a tier to edit it.</p></div>
      <Button className="add-offering-button" type="button" variant="outline" size="sm"
        disabled={draft.offerings.length >= 50} onClick={() => addTier('ticket')}><Plus/>Add offering</Button></div>
    {draft.offerings.map((offering, index) => <TierEditor key={offering.clientKey} tier={offering} index={index}
      offerings={draft.offerings} newlyAdded={offering.clientKey === addedTierKey} eventFeeMode={draft.feeMode || 'buyer'}
      onChange={(key, value) => tier(index, key, value)}
      onKindChange={(kind) => setDraft((current) => ({ ...current,
        offerings: current.offerings.map((item, at) => at === index ? { ...item, kind, releaseAfterKey: '' } : item),
      }))}
      onRemove={!(offering.quantitySold > 0) ? () => set('offerings', removeOffering(draft.offerings, offering.clientKey)) : undefined}/>)}
    {draft.offerings.length === 0 && <p className="hint tier-empty">No tickets or packages. Add a tier above when you’re ready to sell. Guestlist access is managed separately.</p>}
    <div className="publish-box"><SelectField id="event-status" label="Event status" value={duplicateSource ? 'draft' : draft.status}
      onChange={(value) => set('status', value)} disabled={Boolean(duplicateSource)} options={[
        ['draft', 'Draft · only visible to your team'],
        ...(!duplicateSource ? [['published', 'Published · available to customers']] : []),
        ...(event ? [['cancelled', 'Cancelled']] : []),
      ]}/>
      <label className="check-field"><input type="checkbox" checked={draft.isDiscoverable}
        onChange={(event) => set('isDiscoverable', event.target.checked)}/>Show published event in discovery</label>
      <p className="hint">Cancellation stops sales but does not refund existing orders. Coordinate refunds separately.</p></div>
    {!duplicateSource && draft.status === 'published' && event?.status !== 'published' &&
      <div className="publish-checklist"><h4>Before you publish</h4><p>Confirm the event details your guests and team will rely on.</p>
        {[
          ['schedule', 'Date and local event time are correct'], ['venue', 'Venue address and visibility are right'],
          ['inventory', 'Ticket prices, quantities and opening schedule are ready'],
          ['access', 'Guestlist capacity and team access have been reviewed'],
        ].map(([key, label]) => <label className="check-field" key={key}><input type="checkbox" checked={publishChecks[key]}
          onChange={(event) => setPublishChecks((current) => ({ ...current, [key]: event.target.checked }))}/>{label}</label>)}
        <small>Publishing can notify your team and make the event available to customers. You can still save a draft first.</small></div>}
  </>;
}
