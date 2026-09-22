// Temporary CUSTOMER PRESENTATION exclusion, not an authorization or data rule.
// Keep the development owner and all financial/referral records in the API/DB.
const DEBUG_OWNER_ID = '10000000-0000-4000-8000-000000000002';
export function isHiddenDemoPerson(person) {
  return person?.id === DEBUG_OWNER_ID
    || (person?.email || '').toLowerCase() === 'maya.owner@nitewide.test'
    || (person?.name || person?.displayName || '').trim().toLowerCase() === 'maya portfolio owner';
}
export function customerPresentation(path, data) {
  const route = path.split('?')[0];
  if (route === '/customer/connections') return data.filter((entry) => !isHiddenDemoPerson(entry.referrer));
  if (route === '/customer/connections/summary') {
    const people = data.people.filter((person) => !isHiddenDemoPerson(person));
    const onlyHidden = data.people.length > 0 && people.length === 0;
    return { ...data, people, eligible: data.eligible && !onlyHidden };
  }
  if (/^\/events\/[^/]+\/referral-visits$/.test(route) && isHiddenDemoPerson({ name: data.referrerName })) {
    // Keep existing attribution intact for a directly opened demo-owner link.
    return { ...data, referrerName: 'Your host' };
  }
  if (route === '/notifications') {
    // Preserve actionable status updates rather than dropping invitations or approvals.
    const hideName = (text) => text?.replace(/\bMaya Portfolio Owner\b/gi, 'Your host');
    return { ...data, items: data.items.map((item) => ({ ...item, title: hideName(item.title), message: hideName(item.message) })) };
  }
  return data;
}
