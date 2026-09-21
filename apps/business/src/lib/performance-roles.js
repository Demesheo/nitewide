// Reports opened before the promoter-role rollout can remain in browser memory.
// The old API called promoters "Affiliate" and managers "Employee".
export function normalizePerformancePeople(people) {
  const legacyRoles = people.some((person) => person.role === 'Affiliate');
  return people.map((person) => ({
    ...person,
    role: person.role === 'Affiliate' ? 'Promoter' : legacyRoles && person.role === 'Employee' ? 'Manager' : person.role,
  }));
}

export function filterPerformancePeople(people, selectedRoles) {
  return selectedRoles.length ? people.filter((person) => selectedRoles.includes(person.role)) : people;
}
