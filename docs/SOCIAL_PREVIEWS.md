# Customer link previews

The customer app's initial HTML includes Open Graph and Twitter large-image card metadata. It uses the approved Miami rooftop-nightlife artwork with the wordmark and “The night is yours.” tagline. Business and admin pages are unchanged.

- Source: `apps/customer/public/images/nitewide-social-nightlife-v1.png`
- Public URL: `https://nitewide-demo.onrender.com/images/nitewide-social-nightlife-v1.png`
- Metadata: `apps/customer/index.html`
- Image: original approved PNG, 1734 × 907, about 1.8 MB.

The image ships in the Docker build with customer static assets, so it requires neither a database record nor a migration/reseed. Crawlers receive metadata before JavaScript runs and can retrieve the image without authentication. Customer event/referral query links retain their navigation behavior and currently use this same brand preview; event-specific flyer previews are not implemented.

Use a versioned filename when replacing the image and update both image tags, dimensions, and tests. Update the absolute HTTPS URL when moving to the production domain. Keep artwork high-contrast and typography inside a generous central safe area.

Messaging/social apps may retain earlier previews. Previously sent messages might not update; test a newly shared link after deployment. Platform preview refresh tools can help where available, but the application cannot forcibly clear a messaging app's cache.

Verification: `node --test apps/api/test/social-preview.test.js` checks customer initial HTML, public image bytes/dimensions, preserved query routes, and the absence of customer branding metadata on business/admin pages. Also run `npm run build`, check the hosted image and metadata after deployment, and send a fresh link from a physical phone to verify the target messaging app's rendering.
