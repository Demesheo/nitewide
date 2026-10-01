# Durable event media with Cloudflare R2

New event flyers can use a private Cloudflare R2 Standard bucket instead of the API filesystem. PostgreSQL retains an asset ID, stable object key, bucket, checksum and upload state. Applications continue using `/api/media/images/<asset-id>`; the API generates a short-lived private read URL on demand. No signed URL is saved in an event or asset record.

Local storage remains the default until R2 credentials are configured. This change does not enable R2 on Render, copy existing images, change DNS or create paid hosting services.

## Current environment decision

As agreed on September 30, 2026, local development and the Render demo will share the private `nitewide-dev-media` bucket and its bucket-scoped Access Key ID and Secret Access Key. Separate staging and production buckets and credentials are deferred until those environments are introduced. Local R2 upload and read verification passed. The owner has reported saving the Render runtime variables; Render requires the new application image before the adapter takes effect.

The shared bucket does not synchronize the local and Render databases. Keep `MEDIA_CLEANUP_ENABLED=false` on both environments: cleanup checks only its own database, so it cannot prove that an object is unused by the other environment. Do not delete shared images or enable age-based bucket deletion without checking both databases. Before enabling automated cleanup, separate the storage namespaces and enforce ownership, or introduce a shared authoritative asset registry.

## Cloudflare setup

1. Sign in and select the Nitewide account. Open **Storage & databases → R2 Object Storage**. The account owner should complete any activation, billing or agreement steps.
2. Create **nitewide-dev-media**, choose **Standard**, and leave public access disabled. Automatic location is suitable unless there is a data residency requirement. Reuse this bucket and its credentials for local development and the current Render demo; create isolated staging and production storage later.
3. In R2 Overview, open **Manage API Tokens**. Create an Account API Token named **nitewide-dev-media-service**, with **Object Read & Write**, applied to **specific buckets only → nitewide-dev-media**. Do not grant Admin or all-bucket permissions. Account tokens avoid tying a running service to an individual employee's access.
4. The owner should submit creation and save the **Access Key ID** and **Secret Access Key** in a password manager. The secret is shown once. Use the S3 credential pair, not the displayed Cloudflare API token or Global API Key. Never paste secrets into chat, source control, a `VITE_` setting or a Docker build argument.

Standard R2 includes free usage allowances, not a hard spending cap. Review [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and consider a billing alert. Public access, a domain transfer and bucket CORS are not needed for this flow: normalized uploads go through the authenticated API, not a browser PUT URL. Private signed image links act as bearer links until expiry; do not log or share them as permanent URLs.

Official references: [Getting started](https://developers.cloudflare.com/r2/get-started/), [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/), [AWS SDK integration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Runtime configuration

Put these values in the git-ignored root `.env` for development. Replace placeholders locally without exposing credentials in terminal output:

```dotenv
MEDIA_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_BUCKET=nitewide-dev-media
R2_ACCESS_KEY_ID=<S3 Access Key ID>
R2_SECRET_ACCESS_KEY=<S3 Secret Access Key>
R2_READ_URL_TTL_SECONDS=900
MEDIA_CLEANUP_ENABLED=false
MEDIA_CLEANUP_INTERVAL_MS=3600000
```

`R2_ENDPOINT` is optional; it defaults to `https://<account-id>.r2.cloudflarestorage.com`. A jurisdiction-specific endpoint must be the Cloudflare R2 endpoint for the same account. Missing R2 credentials or untrusted endpoint hosts fail configuration rather than silently falling back to ephemeral storage. Read links default to 15 minutes, with an allowed lifetime of 1–60 minutes.

Apply `npm run db:migrate`, then restart the API and worker. No reseed is required. The additive `202609300008-durable-media` migration preserves existing asset IDs and marks existing records ready, local and unmanaged.

On Render, reuse the local R2 account, `nitewide-dev-media` bucket and S3 credentials as runtime secrets on both the web service and worker, with `MEDIA_STORAGE_DRIVER=r2` and `MEDIA_CLEANUP_ENABLED=false`. The supervised free demo shares one service environment between both processes. Apply migrations before starting the new revision; never bake credentials into the image or repository. Do not copy the entire local `.env` to Render: its database, signing secrets, app URLs and other settings remain environment-specific.

Cleanup requires R2. Local files are not shared or durable across instances. Switching new uploads back to local does not convert existing R2 assets; their credentials remain necessary for reads.

## Upload finalization

The existing rules remain: one static JPG, PNG or WebP, at least 128 pixels in each dimension, at most 10 MiB and 20 megapixels. The API rotates, strips metadata, resizes within 1600 × 2400 and stores optimized WebP.

An upload reserves a `pending` asset before writing `events/<asset-id>.webp`. The API sends a checksum and identifying metadata, then verifies the stored size, MIME type, SHA-256 metadata and asset ID. Only then does it mark the asset `ready` and return its stable application URL. Network operations occur outside database locks; finalization rechecks the uploader's active account transactionally.

Pending or deleting assets cannot be read or attached. A database trigger covers all event writers, including admin actions and direct SQL. Failed storage writes or verification leave tracked assets for cleanup. Errors expose safe messages, not provider credentials or signatures. The existing allowance of 200 assets per uploader includes pending assets.

No separate client finalization endpoint is needed: the authenticated server upload performs reservation, normalization, PUT and verification. The service finalizer is idempotent for an already-ready verified upload.

## Cleanup and recovery

Cleanup is implemented but disabled for the current shared dev/demo bucket. The behavior below applies only after storage ownership is safely isolated or coordinated across databases and cleanup is explicitly enabled.

The dedicated worker handles at most 25 eligible assets per pass, hourly by default. Eligibility requires an application-managed R2 asset with no event references for at least 24 hours. Cleanup never lists/purges the bucket, touches unmanaged legacy records or deletes referenced images, including drafts, suspended or archived events and flyers shared by multiple events.

Attachment and detachment refresh the grace period. Writers and cleanup serialize on asset row locks. Cleanup claims use `SKIP LOCKED` and a five-minute lease; marking an asset `deleting` prevents new attachments before the network DELETE. The object is deleted outside the database transaction, then its asset row is removed.

Failure leaves a tombstone with `CLEANUP_FAILED`, retried on a subsequent scheduled pass after its lease expires. Missing objects can be deleted again safely, including recovery from object-delete success followed by database failure. Shutdown stops claims and waits for active work. Worker heartbeats expose `mediaCleanupEnabled`.

Inspect aggregate state without logging credentials or signed links:

```sql
SELECT storage_provider, status, last_storage_error, count(*)
FROM media_assets
GROUP BY storage_provider, status, last_storage_error;
```

Repeated failures require checking bucket-scoped credentials, worker settings and Cloudflare availability. Correct the cause; do not force a deleting asset back to ready because its object may already be gone. Automatic retries provide recovery; this change does not add a media administration screen or permanent-purge control.

The proposed retention policy of deleting flyers 30 days after an event ends is **not enabled**. Referenced images remain protected. An event-aware archival/fallback design is needed first. Do not use an upload-age bucket lifecycle rule, which could delete a future event's flyer.

## Existing local flyers

Switching providers affects new uploads only. Existing assets retain IDs and local readers. Seed artwork packaged in the image continues working, but live local uploads remain vulnerable if their disk disappears. Preserve the upload directory until a copy-first migration transfers and verifies each required object and switches its record to R2. Migration must run where the original files exist; the developer filesystem cannot substitute for Render's uploads. Never bulk-update old records to R2 without copying their data. A legacy copy migration is a separate remaining rollout step, not part of the new-upload adapter.

## Verification and quota

```bash
npm run test:api:unit
npm run test:api:integration -- --suite media-storage-integration.test.js
npm run build
```

Standard tests and CI include these suites. Unit tests mock the S3 client and presigner. Integration tests use a disposable local PostgreSQL database, real multipart HTTP and Sharp normalization, and a fake object store. Coverage includes stable URLs, finalization, cross-instance reads, revoked uploader access, invalid attachments, shared/archived assets, retries, competing workers and attachment races. Worker tests cover cleanup shutdown. Standard test and Playwright environments blank cloud credentials and disable cleanup, making **zero R2 requests and zero Resend sends**.

A real smoke check requires a separately authorized upload through the local business editor after configuring the development bucket. It consumes R2 storage/operation allowances. Verify the Cloudflare object, read it from another API instance and inspect stable database keys before enabling R2 on the shared demo. Live checks are not part of the standard test command.
