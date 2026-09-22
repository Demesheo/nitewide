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

- Discover: editorial hero, dark search panel, filter pills, inset portrait artwork,
  legible event details and clear purchase pricing.
- Booked / Saved: focused main-page collections without discovery/search chrome.
- `NightCard`: one consistent purchase/guest-pass component in both Booked and My nights.
- Account: stable-height dialog with Profile, My nights and Connections. Loading
  and short-content states do not resize the outer window.
- Cards/panels: `--noir-panel` layers a static diagonal reflection over an 88%-opaque
  near-black surface, with darker lower edges and a diffused inset highlight. A modest
  8px backdrop blur on listing cards and panels provides depth without moving effects.
- All customer dialogs (event, checkout, account, auth, notifications) use
  `--noir-dialog`: a corner reflection and diagonal sheen over a roughly 93%-opaque
  near-black surface, with 20px blur. Highlights are CSS backgrounds, not overlays that
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

Default Discover, upcoming-week, Saved and featured-event ordering groups events
by venue-local calendar day (earliest day first), then Premium hosts first within
that day. Within each host tier, title and ID provide a stable order; start time
is deliberately not a ranking criterion. An explicit “Price: low to high” choice
still prioritizes price. Purchased-booking history is not a promotional listing
and retains its existing timeline order.

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
RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js
```

Browser review: Discover → event → checkout review; save/unsave; Booked → purchase
and guest pass → back; Profile → Connections → My nights; signed-out sign-in view.
Check at 375px and 430px mobile widths and desktop. Verify actual Premium and Free
events differ only in decoration, no layout overflow, readable QR codes, and no
new console errors. Device-size simulation is not physical iPhone Safari testing.
