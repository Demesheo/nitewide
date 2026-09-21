# Nitewide customer frontend

This guide covers `apps/customer`. Business and Admin currently have independent styling; changing the customer palette does not recolor those apps.

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
| `src/App.jsx`                                        | Discovery state, search, navigation, event details, booking review/confirmation, local wallet, guestlist requests |
| `src/components/event-card.jsx`                      | Reusable discovery and weekly-results card; event selection and independent saved toggle                          |
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

### AuthDialog

Props: `open`, `onOpenChange`, `onSuccess(session)`. Uses shadcn Dialog for focus management, Escape handling, and labeling; Input/Button for form controls. Registration fields enforce the API password rules. Opening the dialog defaults to sign-in. A successful login returns to the pending checkout or wallet action.

### Discovery/search

The form has three fields: **Where to?**, **When?**, and **Search**. Search is a generic, case-insensitive, all-words match over public title, summary, description, venue/organization, city/region, category, and offering name/description. City/date/type/price filters still narrow it. The form submission reads named fields explicitly; filters also update on edits.

An empty selected date displays that date and explains the lack of matching experiences. The following section shows **selected date + 1 through selected date + 7, inclusive**; for September 21, that is September 22–28. It preserves city, query, category, and maximum starting price, sorts by earliest start, and supports loading more cards. If the whole week is empty, it explicitly says so. It never silently shows events outside the window. **All upcoming dates** is an explicit user action that removes the date restriction and resets query/type/price.

`upcomingWeekRange()` does calendar arithmetic in UTC to avoid DST changing window boundaries. Comparisons use each event's `location.timezone` via `eventDateKey()`, falling back to browser local time when absent. Expired events are excluded. The hero feature remains a separately labeled upcoming highlight for the city, independent of the search date.

### Event details and booking

shadcn Dialog contains Tabs for tickets/tables and guestlist. Quantity controls respect sale windows, stock, and per-order minimum/maximum. Demo checkout shows the full amount plus **8% + $0.89 per paid order**. It collects no payment details and never calls `/orders`, changes inventory, or issues a valid admission credential. Guestlist submission does call the real API and remains pending until approved.

### Shared shadcn primitives

Use Button variants for primary/secondary/ghost actions, Badge for status labels, Dialog for modal flows, Input for auth fields, Select for filters, and Tabs for related booking panels. Import from `@/components/ui/...`. Extend the local component source deliberately and retain Radix accessibility behavior. Add future primitives through the configured shadcn CLI rather than recreating focus management.

## Typography, layout and behavior

- DM Sans for body/controls; Manrope for headings and wordmark. Fonts load from Google Fonts with swap behavior and sans-serif fallbacks.
- `.wrap` limits content to 1264px with 40px desktop gutters, 28px intermediate gutters, and 20px mobile gutters.
- Layout breakpoints: 1000px for compact desktop/tablet, 760px for stacked hero/search and two-column cards, 480px for single-column cards.
- Cards use 13px corners; dialogs use 20px corners and scroll within 90–92dvh. Keep dialog width inside the viewport.
- Use the existing skip link, visible focus styles, labeled icon buttons, loading skeletons, error/retry states, and live result announcements.
- Respect `prefers-reduced-motion`; do not make content dependent on hover or animation.
- Photography is mood imagery from Unsplash, not verified venue photography. The detail view labels it; approved event assets should replace it before public launch.

## State, limits and testing

Saved events are browser-local (`nitewide.saved`). Demo bookings are browser-local and filtered by signed-in user (`nitewide.demo-bookings`); they are not a synchronized or encrypted wallet. `nitewide.session` holds the existing API bearer session. The API discovery response is currently capped at 100 events; server-side search/pagination remains a production follow-up.

Automated tests cover combined filtering, generic text fields, venue-local dates, next-week boundaries, month/year/leap/DST transitions, availability, and pricing parity with the API. For browser regression checks:

1. Select a date with no results. Confirm the named date, next-seven-day range, retained filters, and no out-of-window cards.
2. Select a date whose next week is empty. Confirm the explicit weekly empty state.
3. Click a card's image, text, price, and padding; each must open the same event. Click the heart; only saving changes. Repeat with keyboard focus and Enter/Space.
4. Verify sign-in, event details, package selection, and demo confirmation still work after theme changes.
5. Inspect desktop and mobile widths for overflow, readable text, visible focus, and a correctly themed dialog/search form.

No production payment behavior or backend fee policy should be changed solely to adjust presentation.
