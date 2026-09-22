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

Run `npm test --workspace @nitewide/customer` and
`npm run build --workspace @nitewide/customer`.
Browser QA should cover 375×667, 390×844, and 430×932: navigation, city/date/search,
event details, checkout review, My nights, QR passes, Connections, and profile.
Check no horizontal page/dialog overflow, visible close controls and readable inputs.
Viewport simulation does not replace testing Safari keyboard behavior and safe-area
insets on a physical iPhone before release.
