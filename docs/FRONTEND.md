# Nitewide customer frontend

This guide covers `apps/customer`. Business and Admin currently have independent styling; changing the customer palette does not recolor those apps.

The current visual system is [Nitewide Noir](CUSTOMER_DESIGN_SYSTEM.md): charcoal,
crimson, subtle glass and gold Premium-host cards. `noir-theme.css` loads last and
supersedes the legacy palette below; those older token definitions remain as
compatibility defaults, not the current customer appearance. See
[mobile layout rules](CUSTOMER_MOBILE.md) for touch targets and viewport behavior.

## Run and verify

From the repository root, start the existing PostgreSQL service and API as described in the README, then run:

```sh
npm run dev:api
npm run dev:customer
npm test --workspace @nitewide/customer
npm run build --workspace @nitewide/customer
```

The app is served on port 5173. Vite proxies `/api` to port 4000. A separately hosted production API needs `VITE_API_URL` at build time or a hosting-level `/api` proxy. Authentication is real; purchases are intentionally demo-only.

## Structure and responsibilities

| File                                                 | Responsibility                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/main.jsx`                                       | React root, StrictMode, global stylesheet                                                                         |
| `src/App.jsx`                                        | Discovery state, search, navigation, event details, booking review/confirmation, account integration, guestlist requests |
| `src/components/account-dialog.jsx`                  | Server-backed My nights, mini-flyer purchase cards, grouped ticket QR lists with live entry states, profile editing, and cross-venue Connections; see [Customer account](CUSTOMER_ACCOUNT.md) |
| `src/components/event-card.jsx`                      | Reusable discovery and weekly-results card; event selection and independent saved toggle                          |
| `src/components/event-artwork.jsx`                   | Uploaded flyer → local mood artwork → CSS placeholder, with explicit illustrative labels and no error loops |
| `src/components/auth-dialog.jsx`                     | Real login/registration, validation, loading/error states, session handoff                                        |
| `src/components/ui/`                                 | Locally owned shadcn Button, Badge, Dialog, Input, Select, and Tabs components backed by Radix primitives         |
| `src/lib/discovery.js`                               | Filtering, venue-local date keys, seven-day alternatives, availability, pricing, storage helpers                  |
| `src/lib/presentation.js`                            | Event date/time labels and illustrative photography helpers                                                       |
| `src/lib/api.js`                                     | API URL, JSON requests, bearer authentication, timeouts and errors                                                |
| `src/lib/utils.js`                                   | `cn()` merges conditional classes and Tailwind conflicts                                                          |
| `src/discovery-defaults.js`                          | Local current date and current-city lookup with timeout/fallback                                                  |
| `src/styles.css`                                     | Brand/semantic tokens, shadcn theme mapping, layouts, component styling, responsive rules                         |
| `components.json`, `jsconfig.json`, `vite.config.js` | shadcn registry setup, `@/` alias, Tailwind and React integration                                                 |

## Palette and semantic roles

The six brand colors come from the supplied nightclub palette. Keep these exact reference colors in `:root`; use semantic roles in component styles.

| Brand token       | Hex       | Application                                                |
| ----------------- | --------- | ---------------------------------------------------------- |
| `--retro-blue`    | `#0446EF` | Primary actions and selected filter chips, with white text |
| `--nightlife`     | `#1C1859` | Deep purple identity, supporting surfaces and gradients    |
| `--velvety`       | `#440327` | Wine-toned VIP panels and saved-state backgrounds          |
| `--lingonberries` | `#8B0535` | Error borders and restrained deep-rose accents             |
| `--hot-pink`      | `#F10393` | Small decorative indicators and active navigation marks    |
| `--light-magenta` | `#FE6EF0` | Emphasis, saved hearts, focus outlines, and highlight text |

Semantic tokens separate visual purpose from the palette:

- `--surface-page`, `--surface-deep`, `--surface-card`, `--surface-raised`, `--surface-selected`: near-black/purple layers derived to keep the layout readable.
- `--text-primary`, `--text-secondary`, `--text-muted`: lavender-tinted text hierarchy. Avoid dimming content with opacity or reintroducing green-gray hex colors.
- `--border-subtle`, `--border-strong`: dividers and input/card outlines.
- `--primary` maps to Retro Blue; the Tailwind primary foreground is white. `--highlight` maps to Light Magenta for text and focus on dark surfaces.
- `--search-surface`, `--search-text`, `--search-muted`, `--search-border`: the light-lavender search form, including its native light-mode date picker.
- `--action-hover`: the brighter blue hover treatment for search.

The `@theme inline` block bridges these roles into shadcn/Tailwind names such as `bg-background`, `bg-primary`, `text-muted-foreground`, `border-input`, and `ring-ring`. Prefer changing a semantic token over overriding each component. Hot Pink is primarily decorative; do not assume every brand color supports small white text. Use white on Retro Blue, dark Nightlife on Light Magenta, and Light Magenta on dark surfaces for readable emphasis.

## Component contracts

### EventCard

```jsx
<EventCard
  event={event}
  saved={savedIds.includes(event.id)}
  onOpen={() => openEvent(event)}
  onSave={() => toggleSaved(event.id)}
/>
```

`event` uses the public API shape: `id`, `title`, `category`, `startsAt`, `endsAt`, optional `organization`/`location`, and `offerings`. Location timezone drives date labels. Offering availability determines the starting price.

The card is an `article` with one native event-selection button inside its heading. `.card-open::after` stretches the button hit area over the entire article, so the photo, venue label, padding, price, and arrow all open the event. The heart is a sibling native button above that layer (`z-index: 2`) with `aria-pressed`. It neither opens the event nor nests inside another button. Keyboard users can activate either control with Enter/Space. Keep the stretched-button containing block on `.event-card`; do not add `position: relative` to the heading or card-copy wrapper without adjusting this pattern.

Artwork frames use a consistent **4:5 portrait aspect ratio** at every breakpoint, including loading skeletons. Uploaded card flyers use `object-fit: fill` at the user's request: the entire image stretches edge to edge without letterboxing or cropping, and non-4:5 artwork intentionally changes proportions. Detail views preserve the original flyer proportions with `object-fit: contain`. Real venue photos use `cover` without filters; faces are not generated or retouched. The category, date/time and 44×44 save target sit below the artwork. Titles clamp visually to two lines but keep their full accessible name; flexible card-copy layouts align price rows. The date and time remain visible on mobile.

Clamp `.card-title-text`, never `.card-open`: clipping the button itself can clip its stretched pseudo-element and break clicks on the flyer. Regression-check the actual image hit area, not only the heading button.

`EventArtwork` resolves relative upload URLs against the configured API origin. Missing or broken flyers fall through to a real venue photo, then generated venue/generic mood artwork as a last resort, then a branded CSS placeholder without retry loops. `src/lib/venue-artwork.js` maps Parlay, Eden, Shakai, Aura, La Rosa and Celine to distinct locally bundled assets and records their Instagram handles, source posts and photo credits. Matching uses an exact organization slug (or normalized name alias when no slug exists) and an Orlando location, never the event title. Failure tracking uses resolved URLs, so replacement uploads and API-origin changes can load normally. Photos have venue alt text and a **Photo: @account** credit; generated fallbacks are decorative and labeled **Nitewide mood artwork**. Uploaded event artwork always takes precedence. See [source notes, usage-review requirements, asset paths and prompts](CUSTOMER_ARTWORK.md).

### AuthDialog

Props: `open`, `onOpenChange`, `onSuccess(session)`. Uses shadcn Dialog for focus management, Escape handling, and labeling; Input/Button for form controls. Registration fields enforce the API password rules. Opening the dialog defaults to sign-in. A successful login returns to the pending checkout or wallet action.

### Discovery/search

The form has three fields: **Where to?**, **When?**, and **Search**. Search is a generic, case-insensitive, all-words match over public title, summary, description, venue/organization, city/region, category, and offering name/description. City/date/type/price filters still narrow it. The form submission reads named fields explicitly; filters also update on edits.

Discover opens with **Next 7 days**: today in the browser's local calendar through today + 6, inclusive. For September 22, that is September 22–28. The date input starts empty to represent this default range; selecting a date switches to that exact day, including dates outside the default week. Clearing the date restores the seven-day range without clearing the city or search. `discoveryDateRange()` and `filterDiscoveryEvents()` keep this policy limited to Discover; Saved, Booked, Connections, Business, and Admin are unchanged. Pagination still exposes every matching result.

If an explicitly selected date has no matches, an explanation precedes a separate upcoming section for **selected date + 1 through selected date + 7**. No-match default weeks show a clear empty state rather than expanding beyond their window. Both ranges use calendar arithmetic to avoid DST boundary shifts and compare each event's venue-local start date (`eventDateKey()`). Expired events are excluded, city/search remain applied, and Premium hosts lead within each chronological day. Regression coverage: `test/discovery-week.test.js` and `test/discovery.test.js`.

### Event details and booking

Event dialogs deliberately cancel Radix's default first-control autofocus. Their title is programmatically focusable (`tabIndex=-1`), receives focus without scrolling, and the scroll container resets to zero on opening or event-ID changes. This prevents long artwork from jumping straight to the booking tabs. Normal Tab navigation, focus trapping and Escape dismissal remain enabled. `test/dialog-focus.test.js` covers cancellation, focus and repeat resets; browser regression checks should include a long flyer, close/reopen after scrolling, another event, and mobile.

Detail artwork always uses a **4:5 portrait frame** for flyers, real venue photos, generated images and the missing-art placeholder. No image-presence-specific landscape or viewport-height override is used. Flyers retain their proportions within the frame; photos and generated art cover it. The dialog itself scrolls to expose the booking controls below the portrait artwork.

The event dialog uses a non-shrinking flex column to prevent controls overlapping tall artwork. `overflow-anchor: none` prevents browser scroll anchoring from undoing the top reset when reopening content during the close animation.

shadcn Dialog contains Tabs for tickets/tables and guestlist. Quantity controls respect sale windows, stock, and per-order minimum/maximum. Demo checkout shows the full amount plus **standard 8% + $0.80 (automatic discounts and minimum-cost exceptions apply) per paid ticket/package**, rounded to cents; free orders have no fee. Stripe processing is paid by Nitewide and is not added to the customer total. `@nitewide/pricing` supplies the API, Customer and Business calculator with the same cent-based discount and minimum-fee rules. Demo checkout calls `/orders` with the development-only demo provider, recording inventory, credentials, attribution and notifications without collecting payment details. Guestlist requests remain pending until approved. My nights loads account purchases and individual signed admission QR images from the API; demo tickets are explicitly labeled for local testing.

### Shared shadcn primitives

Use Button variants for primary/secondary/ghost actions, Badge for status labels, Dialog for modal flows, Input for auth fields, Select for filters, and Tabs for related booking panels. Import from `@/components/ui/...`. Extend the local component source deliberately and retain Radix accessibility behavior. Add future primitives through the configured shadcn CLI rather than recreating focus management.

## Typography, layout and behavior

- DM Sans for body/controls; Manrope for headings and wordmark. Fonts load from Google Fonts with swap behavior and sans-serif fallbacks.
- `.wrap` limits content to 1264px with 40px desktop gutters, 28px intermediate gutters, and 20px mobile gutters.
- Layout breakpoints: 1000px for compact desktop/tablet and two-column cards, 760px for stacked hero/search, 480px for single-column cards, and 360px for a compact header. Larger screens use three card columns.
- Cards use 13px corners; dialogs use 20px corners and scroll within 90–92dvh. Keep dialog width inside the viewport.
- Use the existing skip link, visible focus styles, labeled icon buttons, loading skeletons, error/retry states, and live result announcements.
- Respect `prefers-reduced-motion`; do not make content dependent on hover or animation.
- Default mood imagery is now locally bundled, AI-generated nightclub/VIP photography rather than remote Unsplash images. See [artwork assets and generation prompts](CUSTOMER_ARTWORK.md). Cards, hero and VIP feature use the coordinated assets; uploaded event flyers remain untouched.

## State, limits and testing

Saved events are browser-local (`nitewide.saved`). Purchases and tickets are server-backed and scoped to the authenticated customer; the old `nitewide.demo-bookings` list is no longer read or written. `nitewide.session` holds the existing API bearer session. Account requests use `no-store`; QR images are held in component memory. The API discovery response is currently capped at 100 events; server-side discovery search/pagination remains a production follow-up.

Automated tests cover combined filtering, generic text fields, venue-local dates, next-week boundaries, month/year/leap/DST transitions, availability, and pricing parity with the API. For browser regression checks:

Artwork tests additionally cover uploaded-image priority, missing/broken images, fallback failure, replacement URLs, API-origin changes, deterministic category selection, and the presence/size/format of bundled WebP files.

1. Select a date with no results. Confirm the named date, next-seven-day range, retained filters, and no out-of-window cards.
2. Select a date whose next week is empty. Confirm the explicit weekly empty state.
3. Click a card's image, text, price, and padding; each must open the same event. Click the heart; only saving changes. Repeat with keyboard focus and Enter/Space.
4. Verify sign-in, event details, package selection, and demo confirmation still work after theme changes.
5. Inspect desktop and mobile widths for overflow, readable text, visible focus, and a correctly themed dialog/search form.

No production payment behavior or backend fee policy should be changed solely to adjust presentation.
# Venue identity

Customer event cards, booking cards, ticket details, Connections, and artwork use the event's physical `location.name` before the parent `organization.name`. Room 22 remains Room 22 even when Proper owns it. Venue-specific fallback photography never borrows another venue's image merely because they share an owner. Organization plan entitlements still determine Premium styling.
