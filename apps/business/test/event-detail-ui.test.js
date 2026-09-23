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

test('event detail tabs have a consistent segmented layout on desktop and mobile', () => {
  assert.match(styles, /\.event-detail-tabs > \[data-slot="tabs-list"\] \{ display: grid; grid-template-columns: repeat\(3, minmax\(0,1fr\)\);/);
  assert.match(styles, /\.event-detail-tabs \[data-slot="tabs-trigger"\]\[data-state="active"\] \{ border-color: #66517d; background: linear-gradient/);
  assert.match(mobileStyles, /\.event-detail-tabs > \[data-slot="tabs-list"\] \{ display: grid; grid-template-columns: repeat\(3, minmax\(0,1fr\)\); flex-wrap: nowrap;/);
  assert.match(mobileStyles, /\.event-detail-tabs \[data-slot="tabs-trigger"\] \{ min-width: 0; min-height: 44px; height: auto; flex: initial;/);
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
  assert.match(mobileStyles, /\.event-detail-hero > \.event-detail-flyer \{ align-self: center; \}/);
});
