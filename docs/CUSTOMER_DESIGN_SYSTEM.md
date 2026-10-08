# Nitewide Noir — customer design system

The customer app uses charcoal/black surfaces, warm white type, softly blended
quiet charcoal-plum actions with subtle vertical gloss, reflective translucent cards and glass dialogs,
and champagne-gold Premium glows. Color stays concentrated in accents rather
than overwhelming whole surfaces. Business
and admin themes remain independent. Existing APIs, pricing, referral attribution,
approval rules, checkout, account editing and QR workflows are unchanged.

## Layers and components

`styles.css` owns layout and existing component behavior; `mobile.css` adds
phone-sized interaction rules; `noir-theme.css` is the final visual layer. Semantic
tokens (`--surface-*`, `--text-*`, `--noir-*`) control colors. Avoid new literal
palette values inside JSX. Shadcn Button variants remain the source of button
behavior; style via `data-variant`, never replace buttons with decorative divs.

- Discover: concise single-column intro and location/date/search panel, followed by
  event cards with inset portrait artwork, legible details and clear purchase pricing.
  No radar feature card or experience-type pills. Compact nearby/city-only
  controls sit below the search panel, and Sort is right-aligned beside
  “The night is yours.” Where to includes a right-aligned
  LocateFixed action for user-requested current-city detection.
  Undated discovery browses all upcoming events; an empty explicit date shows
  a separate “Upcoming this week” preview, without a verbose result-count row.
  Use the main search controls to change dates; no “All upcoming” link or redundant empty-state CTA.
- Booked / Saved: focused main-page collections without discovery/search chrome.
- Connections: conditional fourth header segment for referral/invitation history,
  a compact multi-select people dialog, personal relationship counts, scoped search/city
  filters and deduplicated shared event cards with explicit referral selection.
  It uses the same main-page spacing, glass surfaces and Premium treatment.
  See `CUSTOMER_ACCOUNT.md` for eligibility, attribution and privacy boundaries.
- Branding uses a plain Nitewide wordmark without a star in the header or footer.
- The compact two-row footer aligns a larger “For business” link with the
  logo/wordmark. Copyright, Contact Nitewide and Terms and conditions occupy
  the second row; support/legal use equal-sized plain text, not button surfaces.
  All links retain 44px touch targets and wrap safely on narrow screens.
  The bottom “Find your vibe” section uses concise, unnumbered Discover / Book / Enter steps.
- `NightCard`: one consistent purchase/guest-pass component in both Booked and My nights.
- Account: stable-height dialog with Profile, My nights and Connections. Loading
  and short-content states do not resize the outer window.
- Cards/panels: `--noir-panel` layers a static diagonal reflection over an 88%-opaque
  subtly lifted near-black surface (`#0f0e14`), with darker lower edges and a diffused inset highlight. A modest
  8px backdrop blur on listing cards and panels provides depth without moving effects.
- All customer dialogs (event, checkout, account, auth, notifications) use
  `--noir-dialog`: a corner reflection and diagonal sheen over a roughly 72%-opaque
  near-black surface, with 24px blur and mild saturation. The lighter 50% scrim lets
  page colors show through; nested cards use a 60%-opaque base. Flyer frames are glass,
  but flyer pixels and QR images remain opaque. Highlights are CSS backgrounds, not overlays that
  can block clicks, tint artwork, or obscure text. Inputs retain dark native controls.
- Admission passes: dark reflective shells with light text and opaque white,
  high-contrast QR images; checked-in status remains
  individually highlighted with text and an icon, not color alone.

## Soft edges and action hierarchy

Cards and dialogs use low-opacity borders with diffused inner highlights and
outer shadows (`--noir-panel-shadow`, `--noir-dialog-shadow`). Buttons use a
smaller `--noir-control-shadow`; their muted charcoal-plum fill and subtle vertical
gloss replace the high-contrast horizontal multicolor gradient. Secondary actions
remain dark glass; ghost/text actions stay quiet. Gold glow remains reserved for
Premium cards. No animated glow or layout-changing hover effect is introduced.

Main navigation and Tickets & tables / Guestlist use unified charcoal segmented
tracks with one near-black glossy indicator that slides between equal-width
segments. A soft purple inset edge and outer glow mark the active segment without
a purple fill. Individual tabs have no fill or border.
Targets remain at least 44px tall. Keyboard focus and Radix tab semantics are
preserved; reduced-motion preferences disable the indicator transition.

White primary-button labels meet 4.5:1 contrast against both normal and hover
gradient endpoints. Focus outlines, selected tickets, validation errors and
checked-in status remain distinct instead of being softened away. CSS background
and shadow effects never intercept pointer events. The refinement is customer-only.

## Premium host treatment

Public event endpoints and customer wallet summaries provide `isPremiumHost`,
derived from the event organization's persisted `planTier === 'premium'`. Public
organization associations include the plan tier, but no billing/customer secrets.
Discovery and Saved cards receive a soft, layered gold halo/shadow and a “Premium host”
badge; booking cards use the same glow. Borders are intentionally low-opacity so
the effect reads as warm light rather than a hard outline. A VIP package or higher price alone
never triggers this treatment. The glow is not a verification or quality guarantee.

The present schema has organization subscriptions only. Independent creators do
not yet have a subscription field and remain undecorated. Future creator billing
must extend the server entitlement resolver, not infer status from owned venues
or add browser-only Premium flags. No billing or subscription changes are made here.

Discover defaults to Popular (`recommended` in the API): venue-local calendar day first, then Premium
hosts within the same day, capped first-party popularity, verified distance,
and actual start time/ID as stable tie-breakers. A later Premium event can lead
its day, but never move above an earlier day. Soonest sorts by actual start time
and Distance by verified public-location
distance; neither sort gives Premium hosts priority. Unknown/private distances
follow known ones rather than using a fabricated city-based venue distance.
Filtering and sorting are server-side before cursor pagination. Saved retains
its venue-local day, Premium, title and ID ordering. Purchased-booking history
is not a promotional listing and retains its existing timeline order.

## Mobile, motion and accessibility

Keep 44px touch targets, 16px form text, safe-area padding, pinch zoom, bounded
portrait flyers, and scroll restoration. Avoid animated glows or large continuously
moving gradients. Reveal transitions are short and honor reduced motion. Reduced
transparency and browsers without backdrop-filter use opaque panels, cards, dialogs and header.
Keyboard focus rings and explicit Premium labels remain visible. Never tint,
blur, fade or recolor the QR image itself.

## Verification

```
npm test --workspace @nitewide/customer
npm run build --workspace @nitewide/customer
node --test apps/api/test/premium-discovery.test.js apps/api/test/customer-wallet.test.js apps/api/test/api.test.js
npm test --workspace @nitewide/api
```

Browser review: Discover → event → checkout review; save/unsave; Booked → purchase
and guest pass → back; Profile → Connections → My nights; signed-out sign-in view.
Check at 375px and 430px mobile widths and desktop. Verify actual Premium and Free
events differ only in decoration, no layout overflow, readable QR codes, and no
new console errors. Device-size simulation is not physical iPhone Safari testing.
