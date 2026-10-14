# SnapShop

**Snap a photo of anything. SnapShop finds the best place to buy it.**

Take a picture of a tire, a shoelace, a nail, anything. SnapShop works out what it is, then checks
online stores (Amazon, Walmart, Target, eBay…) and stores near you (Walmart, Harris Teeter,
local shops…) and ranks the options by price, how fast you can get it, and whether it's in stock.

It comes as:

- **Website**: works in any phone or desktop browser (`web/`)
- **Phone app**: iPhone + Android, built with Expo / React Native (`mobile/`)
- **Server**: one API both apps use (`server/`)

```
 photo + location
        │
        ▼
 ┌──────────────┐   Claude vision    "Michelin Defender2 225/65R17"
 │   /api/snap  │ ─────────────────▶  search query + store types
 └──────────────┘
        │ in parallel
        ├── Google Shopping (SerpApi) ─▶ Amazon, Walmart.com, Target, eBay prices
        ├── Kroger API ────────────────▶ Harris Teeter / Kroger shelf prices + stock
        ├── Google Places ─────────────▶ nearby tire shops, hardware stores…
        └── Retailer links ────────────▶ "Search Home Depot", "Search AutoZone"…
        │
        ▼
   rank by price · speed · stock · relevance  →  Top pick / Cheapest / Closest / Fastest
```

## Quick start (2 minutes, no keys needed)

Requires **Node.js 22+**.

```bash
git clone https://github.com/<you>/snapshop.git
cd snapshop
npm run setup        # installs server dev tools
npm run dev          # http://localhost:8787
```

Open http://localhost:8787, upload any photo, and you'll see the full flow with **demo data**
(clearly labeled). Add API keys to get real results.

## Turning on real results

```bash
cp .env.example .env
```

Fill in whichever keys you have. Each one switches on a piece; the rest keep working without it.

| Key | What it adds | Where to get it | Cost |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Real photo identification (reads brands, sizes, model numbers) | [console.anthropic.com](https://console.anthropic.com) | Pay per use, a small cost per photo |
| `SERPAPI_KEY` | Online prices from Amazon, Walmart, Target, eBay and more | [serpapi.com](https://serpapi.com) | Free tier, then paid |
| `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` | Shelf prices + stock at Harris Teeter, Kroger, Ralphs, Fred Meyer… | [developer.kroger.com](https://developer.kroger.com) | Free |
| `GOOGLE_MAPS_API_KEY` | Nearby stores that sell this kind of thing, with directions | [Google Maps Platform](https://console.cloud.google.com/google/maps-apis) (enable *Places API (New)* + *Geocoding API*) | Free monthly credit |

Restart the server after editing `.env`. The startup log shows which sources are on.

Recommended order: **Anthropic first** (makes identification real), then **SerpApi** (biggest
coverage), then Google Maps and Kroger for the "near me" part.

## Phone app

```bash
cd mobile
npm install
npx expo install --fix     # aligns package versions with your Expo SDK
cp .env.example .env       # set EXPO_PUBLIC_API_URL
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone.

- On a real phone, `localhost` means the phone itself. Set `EXPO_PUBLIC_API_URL` to your
  computer's Wi-Fi IP (e.g. `http://192.168.1.20:8787`) or your deployed server's URL.
- If Expo Go says the project's SDK is too old, run `npx expo install expo@latest --fix`.
- To publish to the App Store / Play Store, use [EAS Build](https://docs.expo.dev/build/introduction/).

## Deploying

The server serves the website too, so one deployment covers both.

**Docker** (Render, Railway, Fly.io, any VPS):

```bash
docker build -t snapshop .
docker run -p 8787:8787 --env-file .env snapshop
```

**Without Docker:** `npm run setup && npm start`.

Use HTTPS in production: browsers only allow location access on secure pages.
If the website is hosted separately from the API, set the API URL in the
`<meta name="snapshop-api">` tag in `web/index.html` and add the site to `CORS_ORIGINS`.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/health` | | Which sources are enabled |
| `POST` | `/api/snap` | multipart: `photo`, optional `lat`, `lng`, `prefer`, `hint` | Item + ranked offers |
| `POST` | `/api/identify` | multipart: `photo`, optional `hint` | Item only |
| `POST` | `/api/search` | JSON: `query`, optional `lat`, `lng`, `prefer`, `category`, `storeTypes` | Ranked offers |

`prefer` is `balanced` (default), `cheapest` or `fastest`. Photos: JPEG, PNG, WebP or GIF, up to 5 MB
(both apps shrink photos before uploading). Response shapes are in `server/src/types.ts`.

## Project layout

```
server/
  src/app.ts            HTTP routes, uploads, rate limiting, static website
  src/identify.ts       Photo → item (Claude vision, structured output)
  src/search.ts         Runs all sources in parallel, merges results
  src/rank.ts           Scoring and badges (Top pick, Cheapest, Closest, Fastest)
  src/providers/        serpapi.ts · kroger.ts · places.ts · retailerLinks.ts · demo.ts
  test/                 Unit + API tests (node --test)
web/                    Website (plain HTML/CSS/JS, no build step)
mobile/                 Expo app (App.tsx, src/)
```

The server uses only Node's built-in modules at runtime (no Express, no SDKs), so there's
nothing to keep patched besides Node itself.

## Adding another store

Create `server/src/providers/<name>.ts` that implements `Provider`
(`enabled()` + `search(ctx)` returning `Offer[]`), then add it to `ALL_PROVIDERS` in
`server/src/search.ts`. Ranking, badges and both apps pick it up automatically.
Good next candidates: Best Buy API, eBay Browse API, Target via a shopping data provider.

## Tests

```bash
npm test
```

## Good to know

- **In-store stock is the hard part.** Only some chains share it (Kroger's family does).
  Other nearby stores show as "likely carries it, call to check".
- Prices and availability come from third parties and can be out of date.
- Amazon and Walmart don't offer open price APIs to new apps. Google Shopping (via SerpApi)
  covers both. If you join Amazon Associates or Walmart's affiliate program you can add their
  APIs as providers and earn commission on purchases.

## License

MIT
