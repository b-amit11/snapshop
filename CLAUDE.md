# SnapShop: project notes for Claude

Read this first when working on this repo in a new session.

## What it is
User snaps a photo of any item (tire, shoelaces, nails...), shares location, and SnapShop
identifies the item and ranks the best places to buy it: online (Amazon, Walmart, Target,
eBay) and nearby stores (Walmart, Harris Teeter, local shops).

Owner: Amit (GitHub: b-amit11). Built 2026-10-14 as a GitHub portfolio/project repo.
Owner asked for the "full version": website + phone app sharing one backend.

## Layout
- `server/`: Node 22 + TypeScript, **zero runtime dependencies** (built-in `http`, `fetch`,
  `FormData`). Dev deps only: typescript, tsx, @types/node.
  - `src/app.ts`: routes (`/api/health`, `/api/snap`, `/api/identify`, `/api/search`),
    multipart upload (5 MB cap, magic-byte image check), per-IP rate limit, serves `web/`.
  - `src/identify.ts`: Claude vision via raw Messages API with forced tool call `report_item`.
  - `src/search.ts`: runs providers in parallel with timeouts and merges results.
  - `src/rank.ts`: score = price (cubed ratio) + speed + stock certainty, times relevance;
    out-of-stock items get 0.3x. Badges: best / cheapest / closest / fastest.
  - `src/providers/`: `serpapi.ts` (Google Shopping), `kroger.ts` (Kroger + Harris Teeter
    stock and prices), `places.ts` (Google Places nearby stores + reverse geocode),
    `retailerLinks.ts` (always-on search links by category), `demo.ts` (sample data when
    no keys are set; flagged `demo: true`).
  - `test/`: 27 tests, `npm test` (node:test via tsx). All passing at handoff.
- `web/`: plain HTML/CSS/JS, no build step. Shrinks photos client-side before upload.
- `mobile/`: Expo (SDK 54) React Native app. `App.tsx` + `src/`. `src/types.ts` is a copy
  of `server/src/types.ts`; keep them in sync.
- `Dockerfile`, `.github/workflows/ci.yml`, `.env.example`.

## Status at handoff
- Server and website tested end to end in a browser (demo mode).
- Phone app written but **not yet run**: the build sandbox had no npm access. First step on
  a real machine: `cd mobile && npm install && npx expo install --fix && npx expo start`.
- Code lives at https://github.com/b-amit11/snapshop (`main`).

## Next steps
1. Run the phone app in Expo Go and fix anything the version alignment surfaces.
2. Add real keys to `.env`: Anthropic first, then SerpApi, Google Maps, Kroger.
3. Deploy (Docker) on HTTPS so browser location works.
4. Ideas: more providers (Best Buy, eBay Browse API), affiliate links, search history.
