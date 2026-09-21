// Manually verified public Posh listings, not a live feed. Never roll these dates forward.
// Dates below are venue-local EDT; source URL dates are NOT local start dates.
const source = (slug) => `https://posh.vip/e/${slug}`;
const image = (id) => `https://images.posh.vip/originals/${id}`;
const venues = {
  'euphoria-downtown': { name: 'Euphoria Downtown', sourceName: 'Euphoria Downtown Orlando', addressLine1: '110 S Orange Ave' },
  tier: { name: 'OHM', sourceName: 'OHM Nightclub', previousName: 'Tier', addressLine1: '20 E Central Blvd' },
  eden: { name: 'Eden', sourceName: 'EDEN AND THE LOUNGE', addressLine1: '23 E Central Blvd' },
  'la-rosa': { name: 'La Rosa', sourceName: 'La Rosa', addressLine1: '49 N Orange Ave', addressNote: 'Posh lists 49 N Orange Ave, not the old seed placeholder 123 W Church St. New imported events use a separate source-backed location; old records are not relocated.' },
};
function series({ venueSlug, title, description, imageId, sourceSalesStatus = 'rsvp', startTime = '22:00', endTime = '02:00', occurrences }) {
  return occurrences.map(([date, endDate, slug]) => ({ venueSlug, title, description, descriptionKind: 'paraphrase',
    startsAt: `${date}T${startTime}:00-04:00`, endsAt: `${endDate}T${endTime}:00-04:00`,
    sourceUrl: source(slug), imageUrl: image(imageId), sourceSalesStatus,
  }));
}
const events = [
  ...series({ venueSlug: 'euphoria-downtown', title: 'Rew1nd Saturdays', imageId: '69a1e18139679c7807d57913',
    description: 'Rare Marketing Group hosts a Saturday Latin and hip-hop night across two rooms at Euphoria. The listing specifies ages 21+, a dress code, and RSVP entry before 11:30 PM. Check the original listing for current entry availability.',
    sourceSalesStatus: 'September 26 detail page showed sales closed; series dates remain listed. Nitewide inventory is demonstration only.',
    occurrences: [
      ['2026-09-26', '2026-09-27', 'rew1nd-saturdays-2026-9-27-6-0'],
      ['2026-10-03', '2026-10-04', 'rew1nd-saturdays-2026-10-4-6-0'],
      ['2026-10-10', '2026-10-11', 'rew1nd-saturdays-2026-10-11-6-0'],
      ['2026-10-17', '2026-10-18', 'rew1nd-saturdays-2026-10-18-6-0'],
    ] }),
  ...series({ venueSlug: 'eden', title: 'TEQUILA & TOUCHDOWNS', imageId: '6a94aefb77413adb16175398',
    description: 'A Saturday college-football watch party at Eden and the Lounge, hosted by 4L motion LLC. The event combines game-day viewing with a tailgate-style atmosphere and advertised drink specials.',
    startTime: '18:00', endTime: '22:00', occurrences: [
      ['2026-09-26', '2026-09-26', 'tequila-touchdowns-2026-9-27-2-0'],
      ['2026-10-03', '2026-10-03', 'tequila-touchdowns-2026-10-4-2-0'],
      ['2026-10-10', '2026-10-10', 'tequila-touchdowns-2026-10-11-2-0'],
      ['2026-10-17', '2026-10-17', 'tequila-touchdowns-2026-10-18-2-0'],
    ] }),
  ...series({ venueSlug: 'la-rosa', title: 'BROKE A$$ THURSDAY$', imageId: '6a873c945cb2451675d6a2de',
    description: '4L motion LLC presents a Thursday night at La Rosa with music by @4ljayy. The source advertises bottle and drink specials; confirm current terms with the organizer.',
    occurrences: [
      ['2026-09-24', '2026-09-25', 'broke-a-thursday-2026-9-25-6-0'],
      ['2026-10-01', '2026-10-02', 'broke-a-thursday-2026-10-2-6-0'],
      ['2026-10-08', '2026-10-09', 'broke-a-thursday-2026-10-9-6-0'],
      ['2026-10-15', '2026-10-16', 'broke-a-thursday-2026-10-16-6-0'],
    ] }),
  ...series({ venueSlug: 'tier', title: 'FIRST CLASS FRIDAYS', imageId: '6a8503b832500814fc1834e3',
    description: 'A weekly Friday party at OHM Nightclub presented by 4L motion LLC. The original listing advertises free entry with an RSVP before 11:30 PM.',
    occurrences: [
      ['2026-09-25', '2026-09-26', 'first-class-fridays-2026-9-26-6-0'],
      ['2026-10-02', '2026-10-03', 'first-class-fridays-2026-10-3-6-0'],
      ['2026-10-09', '2026-10-10', 'first-class-fridays-2026-10-10-6-0'],
      ['2026-10-16', '2026-10-17', 'first-class-fridays-2026-10-17-6-0'],
    ] }),
  ...series({ venueSlug: 'tier', title: 'Orlando 2016 Party', imageId: '6a96548681b756aa2b36f685',
    description: "Orlando'z Backyard brings a 2016-themed throwback party to OHM, featuring Drake, Rihanna and party anthems. The source lists admission for ages 18+ and tiered ticket availability.",
    sourceSalesStatus: 'Tickets listed from $15.95; Nitewide demo prices are not source prices.',
    occurrences: [['2026-09-24', '2026-09-25', 'orlando-back-to-school-copy']] }),
];
// These pages expose no written About section. Their title, host, venue and
// times are used for a factual fallback, not invented marketing copy.
for (const [venueSlug, title, date, endDate, slug, imageId] of [
  ['tier', 'HOTTIE HOT LINE | JAYY LAURENT LIVE', '2026-09-27', '2026-09-28', 'hottie-hot-line-jayy-laurent-live', '6aa1dab4503be5663c4e2ec4'],
  ['tier', 'JADA FISH LIVE | PLAYGROUND SATURDAYS', '2026-10-10', '2026-10-11', 'jada-fish-live-playground-saturdays', '6aa8b70edff0a36b0e9a7b76'],
  ['la-rosa', 'DEAD DRUNK | ORLANDO AFTER DARK', '2026-09-27', '2026-09-28', 'dead-drunk-orlando-after-dark', '6aa7329874de107487f5acd7'],
  ['la-rosa', 'ORLANDO AFTER DARK | ONLY THE DRUNK SURVIVE', '2026-10-04', '2026-10-05', 'orlando-after-dark-only-the-drunk-survive', '6a8c9a1b8b20efd3ce0557b7'],
  ['la-rosa', 'ORLANDO AFTER DARK | ORANGE CUP VS NAKPIN WARZ', '2026-10-11', '2026-10-12', 'orlando-after-dark-orange-cup-vs-nakpin-warz', '6a909ce0313275677e3e4ea7'],
  ['la-rosa', 'ORLANDO AFTER DARK | PINK OUT THE BIGGEST LIBRA BASH', '2026-10-18', '2026-10-19', 'orlando-after-dark-pink-out-the-biggest-libra-bash', '6a933e5d45c92c492acc781a'],
]) {
  events.push({ venueSlug, title, description: `${title}, presented by Connect 4 Entertainment at ${venues[venueSlug].name} in Orlando. The source does not provide a written event description.`,
    descriptionKind: 'factual-fallback', startsAt: `${date}T22:00:00-04:00`, endsAt: `${endDate}T02:00:00-04:00`,
    sourceUrl: source(slug), imageUrl: image(imageId), sourceSalesStatus: 'Tickets from $0.00; Nitewide inventory is demonstration only.',
    endTimeEvidence: 'Posh Orlando discovery card explicitly shows 10pm–2am; some detail pages only display the start time.',
  });
}
module.exports = {
  snapshotId: 'posh-orlando-2026-09-21', verifiedOn: '2026-09-21', timezone: 'America/New_York',
  windowStart: '2026-09-21T00:00:00-04:00', windowEndExclusive: '2026-10-21T00:00:00-04:00',
  discoveryUrl: 'https://posh.vip/explore-v2?location=custom&place=Orlando,+FL&lat=28.5383832&lng=-81.3789269',
  city: 'Orlando', region: 'FL', venues, events,
  unmatchedVenues: ['Room 22', 'Parlay', 'Proper', 'Celine', 'Aura', 'Shakai', 'Fixtion', 'The Beacham'],
};
