import { formatDate } from '../lib/admin';
import { humanLabel } from './Directory';
import { Button } from './ui/button';

export default function PersonProfile({ person, onActivity }) {
  return <div className="record-section-grid person-profile">
    <section className="record-details-group"><h3>Contact details</h3><dl className="record-fact-list"><div><dt>Email</dt><dd>{person.email || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{person.phone || 'Not provided'}</dd></div><div><dt>Joined</dt><dd>{formatDate(person.createdAt, true)}</dd></div></dl></section>
    <section className="record-details-group"><h3>Account & access</h3><dl className="record-fact-list"><div><dt>Account status</dt><dd>{person.lifecycleState && person.lifecycleState !== 'active' ? humanLabel(person.lifecycleState) : person.isActive === false ? 'Disabled' : 'Active'}</dd></div><div><dt>Email verification</dt><dd>{person.emailVerifiedAt ? `Verified ${formatDate(person.emailVerifiedAt, true)}` : 'Not yet verified'}</dd></div><div><dt>Account setup</dt><dd>{person.onboardingPending ? 'Waiting for the person to accept their secure invitation' : 'No pending setup'}</dd></div>{person.isInternalAdmin && <div><dt>Internal staff access</dt><dd>{humanLabel(person.internalAdminRole || 'platform_owner')}</dd></div>}</dl></section>
    <section className="record-details-group person-activity-guide"><h3>Explore this person’s activity</h3><p>Business and venue roles are separate from purchases, admissions, and invitations. Open a section to review its history and related business or event.</p><div className="record-link-grid"><Button variant="outline" onClick={() => onActivity('people-roles')}>Business & venue roles</Button><Button variant="outline" onClick={() => onActivity('people-purchases')}>Purchases & admission</Button><Button variant="outline" onClick={() => onActivity('people-invitations')}>Invitations</Button></div></section>
  </div>;
}
