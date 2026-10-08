# Customer mobile layout

The customer app targets compact phones first. `src/mobile.css` loads after the
base theme and applies up to 760px; business and admin styles are untouched.

- Use 44px minimum primary touch targets and 16px form text to avoid Safari focus zoom.
- Preserve pinch zoom. Safe-area padding protects notches and home indicators.
- Dialog height follows the dynamic viewport. The existing dialog remains the
  scroll container, preserving ticket-list return position. Close controls remain sticky.
- Opened flyers remain portrait, uncropped, and capped at 320px tall or 40% of
  the small viewport height. Discovery card artwork retains its established treatment.
- Compact hero content, horizontally scrollable filters, single-column Connections,
  wrapping receipts and booking details support narrow screens.
- Returning visitors see a shorter discovery hero. Tonight, Tomorrow and This
  Weekend shortcuts are removed; applied filters remain visible and removable.
  Space below the hero title matches its space above, for both new and returning
  visitors, so the search card is not pressed against the heading.
- Discovery's nearby-city controls sit below the search card; Sort stays on the
  same row as the results title, with the gold caption above both, without
  horizontal overflow. No selected date
  means paged upcoming browsing beyond seven days;
  More keeps the selected city scope and sort. The long metro explanation and
  combined count/area/date summary are omitted.
- Where to has a right-aligned LocateFixed button labeled Use current location.
  It requests location only on tap and applies a city, never a personal street
  address. Preserve the 44px target and city-suggestion touch behavior. The
  field is a search input, not an address/contact field; Safari may override
  autocomplete preferences, so verify saved-contact AutoFill on a real iPhone.
- City suggestions wait 350ms after typing pauses. Location and native-calendar
  actions share white icons, centered 44px targets and identical trailing spacing.
  The caption-free sort dropdown uses readable 16px text for Popular, Distance
  and Soonest, without clipped option labels.
- The footer makes For business the primary link, with equally sized, smaller
  Contact Nitewide and Terms and conditions links below. No horizontal clipping.
- Guestlist requests accept 1–20 people. Pending requests can be edited or
  withdrawn; approved and declined entries remain visible in Booked.
- Booked presents one large QR pass at a time with previous/next controls.
  Previously loaded passes are labeled unverified when the network fails.
- Exact attendees-only addresses and Maps links appear in eligible Booked pass
  views. Public event details never reveal a private address.

Run `npm test --workspace @nitewide/customer` and
`npm run build --workspace @nitewide/customer`.
Browser QA should cover 375×667, 390×844, and 430×932: navigation, city/date/search,
date filtering, guestlist entry states, checkout review, Booked passes, Connections,
notifications, Saved, profile, deep links, and Back/Forward.
Check no horizontal page/dialog overflow, visible close controls and readable inputs.
Viewport simulation does not replace testing Safari keyboard behavior and safe-area
insets on a physical iPhone before release.
