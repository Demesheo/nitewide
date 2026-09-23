import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const eventDetail = readFileSync(new URL('../src/components/EventDetail.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const mobileStyles = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8');

test('event sales overview keeps attendee details without a separate recorded purchases list', () => {
  assert.match(eventDetail, /<EventAttendees customers=\{data\.customers\} onSelect=\{setCustomer\}\/>/);
  assert.doesNotMatch(eventDetail, /<h3>Recorded purchases<\/h3>/);
  assert.doesNotMatch(eventDetail, /data\.purchases \|\| \[\]/);
});

test('event summary metrics use concise labels and omit requested sublabels', () => {
  assert.match(eventDetail, /label="Total sales" value=\{money\(s\.salesCents\)\}\/\>/);
  assert.match(eventDetail, /label="Commissions" value=\{money\(s\.commissionCents\)\}\/\>/);
  assert.doesNotMatch(eventDetail, /Revenue at a glance|Customer payments, including fees|Customer platform fees|customerPaidCents|platformFeeCents/);
  assert.match(eventDetail, /label="Check-ins \/ expected" value=\{`\$\{s\.checkedIn\.toLocaleString\(\)\} \/ \$\{\(s\.admissions \+ s\.guestlistPlaces\)\.toLocaleString\(\)\}`\}\/\>/);
  assert.match(eventDetail, /label="Paid orders" value=\{s\.orders\.toLocaleString\(\)\}\/\>/);
  assert.doesNotMatch(eventDetail, /label="Checked in"/);
  assert.match(eventDetail, /\{detail && <small>\{detail\}<\/small>\}/);
});

test('attendee table uses concise admission labels and aligns the three entry counts in one mobile row', () => {
  assert.match(eventDetail, /label:'Tickets'/);
  assert.match(eventDetail, /label:'Guestlist spots'/);
  assert.doesNotMatch(eventDetail, /label:'Ticket admissions'|label:'Guestlist places'/);
  assert.match(eventDetail, /className="event-attendees-table"><EventTable/);
  assert.match(mobileStyles, /\.event-attendees-table \.responsive-event-table tbody tr \{ display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: space-between; width: 100%; box-sizing: border-box;/);
  assert.match(mobileStyles, /td\[data-label="Tickets"\] \{ order: 1; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /td\[data-label="Guestlist spots"\] \{ order: 2; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /td\[data-label="Checked in"\] \{ order: 3; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /tbody tr::after \{ content: ''; order: 4; flex: 0 0 100%; border-top: 1px solid #3d3449; \}/);
  assert.match(mobileStyles, /td\[data-label="Orders"\] \{ order: 5; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /td\[data-label="Total spend"\] \{ order: 6; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /\.event-attendees-table \.responsive-event-table td\[data-label="Total spend"\] \{ order: 6; flex: 0 0 33\.3333%; \}/);
  assert.match(mobileStyles, /\.event-attendees-table \.responsive-event-table td\[data-label="Tickets"\].*border: 0 !important; border-radius: 0; background: transparent !important;/);
  assert.match(eventDetail, /className="attendee-card-heading"/);
  assert.match(eventDetail, /<Info className="attendee-info-icon" size=\{18\} aria-hidden="true"\/>/);
  assert.match(mobileStyles, /td:first-child button \{ min-height: 44px !important; padding: 0 2px; \}/);
});

test('attendee purchase details align their values beneath labels in a compact mobile card', () => {
  assert.match(eventDetail, /className="event-customer-purchases"><EventTable/);
  assert.match(mobileStyles, /\.event-customer-purchases \.responsive-event-table tbody tr \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(mobileStyles, /\.event-customer-purchases \.responsive-event-table td:first-child \{ grid-column: 1 \/ -1;/);
  assert.match(mobileStyles, /\.event-customer-purchases \.responsive-event-table td:not\(:first-child\) \{ display: grid; grid-template-columns: minmax\(0, 1fr\); justify-items: center;/);
});

test('event detail tabs have a consistent segmented layout on desktop and mobile', () => {
  assert.match(styles, /\.event-detail-tabs > \[data-slot="tabs-list"\] \{ display: grid; grid-template-columns: repeat\(4, minmax\(0,1fr\)\);/);
  assert.match(styles, /\.event-detail-tabs \[data-slot="tabs-trigger"\]\[data-state="active"\] \{ border-color: #66517d; background: linear-gradient/);
  assert.match(mobileStyles, /\.event-detail-tabs > \[data-slot="tabs-list"\] \{ display: grid; grid-template-columns: repeat\(4, minmax\(0,1fr\)\); flex-wrap: nowrap;/);
  assert.match(mobileStyles, /\.event-detail-tabs \[data-slot="tabs-trigger"\] \{ min-width: 0; min-height: 44px; height: auto; flex: initial;/);
});

test('event details expose concise tabs and scope guestlist controls to this event', () => {
  const guestlists = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const [value, label] of [['sales', 'Sales'], ['tickets', 'Offerings'], ['people', 'Team'], ['guestlist', 'Guestlist']]) {
    assert.match(eventDetail, new RegExp(`<TabsTrigger value="${value}">${label}<\\/TabsTrigger>`));
  }
  assert.match(eventDetail, /<Guestlists event=\{event\} initialEntryId=\{initialGuestlistEntryId\}/);
  assert.match(guestlists, /const eventId = event.id/);
  assert.doesNotMatch(guestlists, /Guestlist event|<ShareEventCard/);
  assert.match(guestlists, /className="panel guest-experience-panel"/);
  assert.match(guestlists, /className="allocation-grid"/);
  assert.match(app, /\["team", Users, "Organization"\]/);
});

test('event Guestlist content uses the same panel inset as the other detail tabs', () => {
  assert.match(styles, /\.event-detail-tabs \.guest-experience-content,\s*\.event-detail-tabs \.allocation-grid \{ padding: 0; \}/);
});

test('redundant tier schedule cards stay available on desktop but are hidden on mobile', () => {
  assert.match(eventDetail, /className="tier-schedule-list"/);
  assert.match(styles, /\.tier-schedule-list \{ display: grid;/);
  assert.match(mobileStyles, /@media \(max-width: 850px\) \{\s*\.event-detail \.tier-schedule-list \{ display: none; \}/);
});

test('event Team places Add promoter beside its title and left-aligns the role filter below', () => {
  assert.match(eventDetail, /className="event-people-title-row"><h3>.*?<\/h3>\{event\.canEdit && <EventPromoterInvite/);
  assert.match(eventDetail, /className="event-team-filter-row"><MultiSelect label="Roles"/);
  assert.match(eventDetail, /\{event\.canEdit && <EventPromoterInvite event=\{event\}/);
  assert.match(styles, /\.event-team-controls \{ display: grid; gap: 12px;/);
  assert.match(styles, /\.section-heading\.event-people-heading \{ display: block; \}/);
  assert.match(styles, /\.event-people-title-row \{ display: flex; align-items: center; justify-content: space-between;/);
  assert.match(styles, /\.event-team-filter-row \{ display: flex; justify-content: flex-start; \}/);
  assert.match(mobileStyles, /\.event-team-filter-row \.multi-select-control \{ flex: none; min-width: 0; \}/);
  assert.match(eventDetail, /className="event-team-table"><EventTable/);
  assert.match(mobileStyles, /\.table-mobile-sort \{ display: flex; align-items: center; justify-content: space-between;/);
  assert.match(mobileStyles, /\.table-mobile-sort label \{ display: block; min-width: 0; \}/);
  assert.match(mobileStyles, /\.table-mobile-sort select \{ width: auto; min-width: 166px; max-width: min\(228px, calc\(100vw - 112px\)\);/);
});

test('event Team includes a sales donut for managers without exposing event-wide sales to own-only referrers', () => {
  assert.match(eventDetail, /!ownOnly && <section className="panel event-team-sales-mix"/);
  assert.match(eventDetail, /<SalesMixPie slices=\{eventTeamSalesSlices\(data\)\}\/>/);
  assert.match(eventDetail, /<\/section>\}<section className="panel"><EventPeople/);
});

test('event details invite guests in place without navigating to Guestlists', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const inviteDialog = readFileSync(new URL('../src/components/GuestlistInviteDialog.jsx', import.meta.url), 'utf8');
  const guestlists = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  assert.match(eventDetail, /<ShareEventCard referralUrl=\{url\?\.toString\(\) \|\| ''\} canInviteGuest=\{Boolean\(canInviteGuest\)\}/);
  assert.match(eventDetail, /guestlist-invite-pools/);
  assert.match(eventDetail, /onInviteGuest=\{\(\) => setInviteOpen\(true\)\}/);
  assert.match(eventDetail, /<GuestlistInviteDialog open=\{inviteOpen\}/);
  assert.match(eventDetail, /<GuestlistInviteDialog open=\{inviteOpen\}/);
  assert.match(inviteDialog, /guestlist-invitations/);
  assert.match(inviteDialog, /eventAffiliateId: selectedPool/);
  assert.match(inviteDialog, /guestlistInvite/);
  assert.doesNotMatch(eventDetail, /<code className="break-all text-sm">\{url\.toString\(\)\}<\/code>/);
  assert.doesNotMatch(app, /guestlistInviteToOpen|navigate\('guestlists'/);
});

test('standalone Guestlists navigation is removed while notifications deep-link to event guest requests', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const events = readFileSync(new URL('../src/components/Events.jsx', import.meta.url), 'utf8');
  const notifications = readFileSync(new URL('../src/components/Notifications.jsx', import.meta.url), 'utf8');
  const guestlists = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /\["guestlists", Users, "Guestlists"\]|visiblePage === "guestlists"/);
  assert.match(app, /initialGuestlistEntryId=\{guestlistEntryToOpen\}/);
  assert.match(app, /key=\{eventNavigationRevision\}/);
  assert.match(events, /initialGuestlistEntryId=\{selectedId === initialEventId \? initialGuestlistEntryId : null\}/);
  assert.match(events, /selectedId !== initialEventId && !data.events.some/);
  assert.match(notifications, /onNavigate\('events', item.eventId, item.metadata\?\.entryId, item.kind === 'guestlist_request' \? 'guestlist' : null\)/);
  assert.match(eventDetail, /defaultValue=\{initialTab \|\| 'sales'\}/);
  assert.match(guestlists, /!initialEntryHandledRef.current && initialEntryId && entries.some\(\(entry\) => entry.id === initialEntryId\)/);
  assert.match(guestlists, /initialEntryHandledRef.current = true;/);
});

test('team member details stay compact and gate commission or removal behind Edit and Save', () => {
  assert.match(eventDetail, /className="team-member-dialog event-team-member-dialog sm:max-w-xl max-h-\[90vh\] overflow-y-auto"/);
  assert.match(eventDetail, /editing\?\.email \? `\$\{editing\.email\} · ` : ''/);
  assert.match(eventDetail, /className="team-detail-metrics event-person-activity"/);
  for (const label of ['Orders', 'Customers', 'Guestlist requested', 'Guestlist approved']) assert.match(eventDetail, new RegExp(`<small>${label}<\\/small>`));
  assert.match(styles, /\.event-team-member-dialog \.team-detail-metrics\.event-person-activity \{ grid-template-columns: repeat\(4,minmax\(0,1fr\)\);/);
  assert.match(eventDetail, /if \(canEditPerson && editingMode\) save\(removing \? 'inactive' : 'active'\)/);
  assert.match(eventDetail, /canEditPerson && !editingMode && <div className="team-role-editor"><Button type="button" variant="outline"/);
  assert.match(eventDetail, /canEditPerson && editingMode && <div className="team-role-editor team-role-editor-open event-person-editor"/);
  assert.match(eventDetail, /<Slider aria-label="Event commission percentage"/);
  assert.match(eventDetail, /<output className="event-commission-value"[^>]+>\{rate\}%<\/output>/);
  assert.match(eventDetail, /onValueChange=\{\(\[v\]\) => setRate\(v\)\}/);
  assert.match(styles, /\.event-team-member-dialog \.event-commission-value \{ position: absolute;/);
  assert.match(eventDetail, /<div className="team-role-edit-danger"><Button type="button" variant="destructive"/);
  assert.match(eventDetail, /removing \? 'Save removal' : 'Save commission'/);
  assert.match(eventDetail, /onClick=\{cancelEdit\}>Cancel/);
  assert.match(eventDetail, /onClick=\{\(\) => setEditingMode\(true\)\}>Edit member/);
});

test('event Team pagination keeps its heading-specific scroll target', () => {
  const eventTable = readFileSync(new URL('../src/components/EventTable.jsx', import.meta.url), 'utf8');
  const pagination = readFileSync(new URL('../src/components/TablePagination.jsx', import.meta.url), 'utf8');
  assert.match(eventDetail, /ref=\{teamHeadingRef\} className="section-heading event-people-heading"/);
  assert.match(eventDetail, /onPageChange=\{scrollToTeam\}/);
  assert.match(eventTable, /<TablePagination pager=\{pager\} onPageChange=\{onPageChange\}\/>/);
  assert.match(pagination, /if \(onPageChange\) return onPageChange\(\)/);
  assert.match(mobileStyles, /\.event-people-heading \{ scroll-margin-top: 80px; \}/);
});

test('event detail card separates status, venue identity, address and full-width description', () => {
  assert.match(eventDetail, /<section className="event-detail-hero"><span className=\{`event-detail-status status-pill \$\{phase\}`}\>/);
  assert.match(eventDetail, /<div className="event-detail-heading"><h2>\{event\.title\}<\/h2>/);
  assert.match(eventDetail, /className="event-detail-venue"><MapPin size=\{16\}\/>{event\.location\.name}/);
  assert.match(eventDetail, /className="event-detail-address">\{\[event\.location\?\.addressLine1/);
  assert.match(eventDetail, /className="event-detail-summary">\{event\.summary\}/);
  assert.match(styles, /\.event-detail-summary \{ grid-column: 1 \/ -1; width: 100%;/);
  assert.match(styles, /\.event-detail-status \{ position: absolute; top: 14px; right: 18px; \}/);
  assert.match(mobileStyles, /\.event-detail-hero > \.event-detail-heading \{ grid-column: 2; grid-row: 1; padding-top: 23px; \}/);
  assert.match(styles, /\.event-detail-flyer \{ width: 104px; height: 142px; margin-top: 22px;/);
  assert.match(mobileStyles, /\.event-detail-hero > \.event-detail-flyer \{ align-self: start; margin-top: 23px; \}/);
});
