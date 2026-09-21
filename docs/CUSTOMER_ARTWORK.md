# Customer fallback artwork

## Current behavior: real photos first

Uploaded event flyer → real venue Instagram photo → generated venue mood art → generic mood art → CSS placeholder. Generated imagery is now a last resort, not the primary fallback. Card flyers stretch to fill their 4:5 frame (`object-fit: fill`); detail flyers retain their original proportions. Real photos keep their proportions with `cover`.

### Real-photo sources (selected 2026-09-21)

These are local demo assets selected from accessible public previews for adult nightlife/glamour appeal. This is not an exhaustive ranking of each account: full posts and older content required login. Celine's available selection was predominantly performances/promotions, so it uses a real crowd/event still rather than a glamour portrait. No people were generated, retouched or altered. Only WebP encoding was applied to downloaded previews; Parlay is a deterministic crop of the supplied screenshot. Reel previews are still images, not downloaded videos.

| Venue | Saved file under `apps/customer/public/images/` | Source | Resolution |
| --- | --- | --- | --- |
| Parlay | `parlay-orlando-instagram.webp` | User-supplied `IMG_6365.PNG`, second row/right bottle-service photo from [@parlayorlando](https://www.instagram.com/parlayorlando/); exact post unavailable | 310×520 |
| Eden | `eden-orlando-instagram.webp` | [@edenthelounge post](https://www.instagram.com/edenthelounge/p/DdfekozoM-Z/) | 538×640 |
| Shakai | `shakai-orlando-instagram.webp` | [@shakailounge post](https://www.instagram.com/shakailounge/p/DN_-aeWEYIq/) | 640×640 |
| Aura | `aura-orlando-instagram.webp` | [@auraorlando_ reel preview](https://www.instagram.com/auraorlando_/reel/DGeSTMqsE_9/) | 360×640 |
| La Rosa | `la-rosa-orlando-instagram.webp` | [@parcerosentertainment post](https://www.instagram.com/parcerosentertainment/p/DdKxyl6AHlU/), displayed on @larosaorl_ | 489×640 |
| Celine | `celine-orlando-instagram.webp` | [@celine_orlando reel preview](https://www.instagram.com/celine_orlando/reel/DdeLfp2Et44/) | 361×640 |

Each image is below 60 KB, encoded at WebP quality 90 without artificial upscaling. Preview resolution may appear soft on large/high-density screens, especially Parlay, Aura and Celine. Replace with venue-provided originals when available. Credit identifies the posting account, not a verified photographer. Original copyright/likeness permissions have **not** been verified; confirm authorized promotional use with venues/rightsholders before a public release. Public visibility and attribution are not permission. No deployment or publication was performed as part of this change.

Parlay source crop: `left=788, top=991, width=310, height=520` in the original 1179×2556 screenshot. It excludes Instagram chrome and carousel badges; the original screenshot is unchanged.

## Generated last-resort collection

Created with the built-in image-generation tool, using the imagegen skill. These images are fictional mood illustrations, not photographs of the actual venues.

| Asset | Purpose | Size |
| --- | --- | --- |
| `apps/customer/public/images/afterhours-dancefloor.webp` | Nightclub/concert fallback and hero | 1122×1402; 58,274 bytes |
| `apps/customer/public/images/velvet-vip-lounge.webp` | Lounge/private-event fallback and VIP feature | 1122×1402; 124,994 bytes |

Both files are bundled with the customer app, require no remote image service, and use WebP quality 82. Originals were preserved in the generation output directory. Only encoding was changed; the source flyers imported from Posh were not edited. Cards label fallback imagery to avoid implying venue-specific authenticity.

`fallbackArtwork(event)` chooses the real venue photo when available, otherwise curated generated venue artwork or a generic mood image. `eventArtworkState()` tracks source failures and applies the precedence documented above. Source images are bundled locally instead of hotlinking expiring Instagram CDN URLs.

## Exact generation prompts

### afterhours-dancefloor

Use case: photorealistic-natural. Asset type: portrait 4:5 photographic fallback artwork for Nitewide event cards. Create an original editorial photograph inside a sophisticated intimate nightclub: silhouetted adult crowd seen from behind, a small distant DJ booth, cobalt blue light beams and restrained magenta lighting through atmospheric haze. Real photographic texture, deep indigo shadows, premium nightlife energy, rich contrast, not a huge outdoor festival. Composition should work as a full portrait event-card photograph with a clear central focal area. Palette inspired by #0446EF retro blue, #1C1859 indigo, #F10393 hot pink. No text, no logos, no branding, no watermarks, no recognizable real venue, no close-up faces. One full-bleed image, not a collage or UI mockup.

### velvet-vip-lounge

Use case: photorealistic-natural. Asset type: portrait 4:5 photographic fallback artwork for Nitewide VIP and nightlife event cards. Create an original premium editorial photograph of an intimate VIP nightclub lounge: deep burgundy velvet curved banquette, small dark reflective cocktail tables, a subtly glowing cobalt and pink-lit bar in the background, warm pin lights and discreet nightclub atmosphere. Real velvet and glass textures, restrained cinematic photography, dark indigo and burgundy shadows with magenta accents. Composition should work as a full portrait event-card photograph and a cropped website VIP feature image. No people, no readable bottle labels, no text, no logos, no watermarks, no recognizable real venue. One full-bleed photograph, not a collage or UI mockup.

## Venue-specific Orlando collection (2026-09-21)

Six original images were generated with the **built-in image-generation tool** after reviewing the supplied public profiles where accessible. No Instagram photos, faces, logos or event flyers were downloaded or republished. These are fictional mood illustrations inspired by broad public venue themes, not authentic venue photographs or endorsements. Instagram handles are preserved in `src/lib/venue-artwork.js`.

All six files are bundled under `apps/customer/public/images/` as `<slug>-orlando-mood.webp` (including `la-rosa-orlando-mood.webp`). Assets are 900×1125, WebP quality 82; originals remain in the image-generation output directory. Tests cap each delivered file at 200 KB. No seed reset or database update is required.

Matching requires an Orlando location and an exact curated organization slug (or exact normalized name alias only when no slug is available). Explicit non-Florida/non-US locations are excluded. Event titles are never used to infer a venue. Unknown venues keep the generic artwork. Current precedence:

1. Uploaded event flyer.
2. Matching real venue photo.
3. Matching generated venue mood image (last-resort imagery).
4. Generic category-appropriate mood image.
5. Branded CSS placeholder.

An image failure advances the chain without retry loops. Generated artwork retains the visible “Nitewide mood artwork” label. Owner-supplied flyers always win. Future production venue media should be organization-managed assets, not an ever-growing hard-coded city catalog.

### Source notes and exact prompts

#### parlay

Saved asset: `apps/customer/public/images/parlay-orlando-mood.webp`.

Instagram profile required login. Direction comes from [Parlay's official site](https://www.parlayorlando.com/): sports viewing, LED walls, VIP and DJ nightlife. No Instagram photographs were inspected.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: upscale intimate sports lounge transitioning to late-night club energy, black leather VIP booth and dark cocktail table foreground, wraparound LED screens in the background showing abstract blue sports-like motion without teams or text, amber accent lights and cobalt/magenta reflections. No people. Inspired only by Parlay Orlando's official description of sports viewing, LED walls, VIP and DJ nightlife.

#### eden

Saved asset: `apps/customer/public/images/eden-orlando-mood.webp`.

[Instagram](https://www.instagram.com/edenthelounge/): public bio uses a garden theme; visible grid includes hanging foliage, brick and warm lights.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: intimate garden-themed late-night lounge, overhead trailing foliage, exposed warm brick, dark upholstered seating and glass cocktail table, subtle pink and blue light beneath amber string lights. No people. Inspired by Eden Orlando's public Instagram garden identity, hanging greenery and brick visible in its grid; do not copy a specific photograph or actual layout.

#### shakai

Saved asset: `apps/customer/public/images/shakai-orlando-mood.webp`.

[Instagram](https://www.instagram.com/shakailounge/): grid includes round ornamental pendant lights and purple lighting. [Official about page](https://shakaiorlando.com/orlando-downtown-orlando-shakai-sushi-lounge-about) describes Japanese dining transitioning to a lounge/club.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: elegant Japanese-influenced dining lounge after dark, dark wood bar with warm glowing shelves, sculptural round woven pendant lights, deep red and violet club lighting with a restrained blue beam, reflective table in foreground. No people. Inspired by Shakai Lounge's public grid showing rounded ornamental pendants and purple lighting, and its Japanese restaurant-to-nightclub identity. Fictional interior, not a replica.

#### aura

Saved asset: `apps/customer/public/images/aura-orlando-mood.webp`.

[Instagram](https://www.instagram.com/auraorlando_/): public bio identifies a sound room; grid has dark, cool-toned crowd imagery.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: intimate underground-style sound room, dark walls, sculptural unbranded speaker cabinets beside a distant DJ booth, tightly framed silhouettes of adult dancers seen from behind, cool cyan and indigo haze with small white highlights and a subtle magenta accent. Refined dark electronic music energy. Inspired by Aura Orlando's public sound-room identity and dark cool-toned crowd imagery; no recognizable faces or specific venue layout.

#### la-rosa

Saved asset: `apps/customer/public/images/la-rosa-orlando-mood.webp`.

[Instagram](https://www.instagram.com/larosaorl_/): visible crowd photography and Latin-event promotions. Warm red/amber art direction is an interpretation, not a verified interior color scheme.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: energetic intimate Latin-music nightclub, adult crowd in silhouette seen from behind facing a small distant DJ booth, warm red and amber lighting with pink accents across dark walls, hands raised naturally, cinematic haze and polished nightlife atmosphere. Inspired by La Rosa Orlando's public crowd photography and Latin-event promotion, not a copy of any post. No close-up faces, no performers recognizable, no invented rose decor.

#### celine

Saved asset: `apps/customer/public/images/celine-orlando-mood.webp`.

[Instagram](https://www.instagram.com/celine_orlando/): public programming includes rooftop events alongside concert/DJ content. Rooftop mood is illustrative; actual furnishings and skyline are not reproduced.

Prompt:

Use case: photorealistic-natural. Asset type: portrait 4:5 fallback mood artwork for Nitewide event cards. Create one original premium editorial-style photorealistic nightlife image. This is a fictional mood illustration, NOT a reconstruction or photograph of the named venue. Natural material texture, atmospheric lighting, strong central composition that reads at thumbnail size. No text, logos, recognizable real people, bottle labels, watermark, collage, or UI. Scene: sophisticated open-air downtown rooftop music lounge at blue hour, low dark lounge seating and round cocktail tables in foreground, warm hanging string lights, subtle pink accent glow, a small distant DJ setup and softly blurred generic city buildings. No people. Inspired by Celine Orlando's public rooftop programming and entertainment identity, not an exact depiction of its premises or skyline.
