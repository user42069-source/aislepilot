# AislePilot v2

A shopping-trip planner with real address lookup, OpenStreetMap places and tiles, road-based optimization, a transparent budget, and a Playwright retailer-reading service. The frontend is plain HTML, Tailwind CDN, custom CSS and vanilla JavaScript. No frontend build step is required.

**GitHub Pages hosts the frontend only.** It cannot run Chromium or a Node server. Deploy the included backend separately for browser scraping. With no backend connected, the site still calls public map services and calculates real routes; inventory remains explicitly unverified. A backend does not make every retailer readable: robots rules, access challenges, login requirements and missing branch inventory are reported as unknowns.

For the shortest setup guide, start with **[START-HERE.md](START-HERE.md)**. Read **[VALIDATION.md](VALIDATION.md)** for the completed checks and remaining live-scraping limitations.

## Quick start on your computer

Use Node 22.12+ (Node 24 recommended), running as a normal, non-root user.

```sh
npm ci
npm run browser:install
cp .env.example .env
npm start
```

Open **http://localhost:8787**. The local dashboard automatically connects to its backend. For maps only, browser installation is optional. Chromium keeps its sandbox enabled; do not solve launch problems by adding `--no-sandbox`. On Linux, install the dependencies requested by Playwright, or use the Docker setup below.

1. Enter a starting address and a shopping list. `Try a list` fills items only, never invented results.
2. Choose the correct geocoded address. Street and area matches are distinguished. Exact `latitude, longitude` input is also supported.
3. Assign categories for unfamiliar items if prompted. The app queries real nearby stores and road travel times.
4. Review each stop, its source address, navigation link, and per-item evidence. When connected, price checks run after the route is drawn.
5. Review candidate products and package sizes. Enter your own USD unit budget for missing or incompatible quotes, and enter effective tax rates if known.
6. Download the trip JSON using the download button. It contains the route geometry, store sources, evidence timestamps, cost assumptions and missing items.

## Deploy the frontend to GitHub Pages

1. Create a GitHub repository and put this folder's **contents** at its root, including `.github/`. Do not upload `node_modules/` or `.env`.
2. Push to the `main` branch. If using a different default branch, edit `.github/workflows/pages.yml`.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the build source.
4. Optionally set repository **Settings → Secrets and variables → Actions → Variables → `AISLEPILOT_API_URL`** to the backend HTTPS origin, e.g. `https://api.your-domain.example`. Omit a trailing slash. This is a public URL, **not a secret token**.
5. Run the **Test and deploy GitHub Pages** workflow, or push again. Its deployment output supplies your Pages URL.

The workflow runs regression tests, generates `site/config.js`, and uploads **only `site/`**. Relative asset paths support both `owner.github.io` and `owner.github.io/repository/`. Users can also set a backend URL in the dashboard's Connection dialog. The connection token is entered privately in that dialog and stays in tab memory; it is never committed or persisted in local storage.

No GitHub repository, domain or paid hosting account has been provisioned by this source package.

## Deploy the browser backend

The backend needs an always-running Node process and a sandbox-capable Chromium runtime. It is not a GitHub Action, Pages function, or arbitrary public CORS proxy.

The included Dockerfile pins the Playwright package and official browser image to **1.63.0**. It runs as `pwuser`. Compose applies Playwright's bundled seccomp profile and provides shared memory.

1. Install Docker and Compose on your backend host.
2. Copy `.env.example` to `.env`. Set a random token and your **exact frontend origin**:

```dotenv
API_TOKEN=replace-with-a-long-random-secret-of-at-least-24-characters
ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io
```

Generate a token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it out of git, URLs and workflow variables. A project Pages URL's origin does **not** contain its repository path. For a custom domain, use that exact origin. Separate multiple origins with commas; wildcards are rejected.

3. Start the service:

```sh
docker compose up --build -d
```

4. Put your host's HTTPS reverse proxy in front of **127.0.0.1:8787**. Compose deliberately binds only the local interface. A Docker-capable managed host can supply HTTPS instead; preserve the non-root Chromium sandbox requirements. Configure the proxy request timeout to at least 75 seconds, preserve the `Origin` and `Authorization` headers, and avoid logging request bodies or authorization headers.
5. Check `https://YOUR-BACKEND/health`, then use **Test connection** in the app. A health response says whether browser binaries exist, not whether every retailer is accessible. Confirm a real allowed product-page lookup before relying on the installation.

For a non-Docker deployment, run the quick-start install as a non-root service user and set:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
API_TOKEN=your-private-random-token
ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io
```

Use your service manager and HTTPS ingress. Production startup refuses a missing or short token. The included shared token is appropriate for a private/personal deployment; add individual user authentication and durable quotas before opening a service to many users.

## End-to-end command-line script

The CLI shares the frontend's parsing, categorization, exact route solver and cost logic. It can run locally without starting the HTTP server, or call your deployed backend.

```sh
# Address lookup shows candidates and prompts you to select one in an interactive terminal.
npm run plan -- --address "100 Robinson Centre Drive, Pittsburgh, PA" --file examples-list.txt --round-trip --output trip.json

# For automation, explicitly confirm a returned candidate number:
npm run plan -- --address "100 Robinson Centre Drive, Pittsburgh, PA" --origin-index 1 --list "milk, basketball, flower pot" --output trip.json

# Exact coordinates need no address-selection prompt. This is a public-place example.
npm run plan -- --address "40.4545,-80.1605" --file examples-list.txt --maps-only --output trip.json

# Use a remote backend. API_TOKEN is read from your .env/environment, never a CLI argument.
npm run plan -- --backend https://YOUR-BACKEND --address "40.4545,-80.1605" --file examples-list.txt --output trip.json
```

Run `npm run plan -- --help` for all options. Progress is written to stderr, report JSON to stdout (or `--output`). Map failures exit nonzero. Unpriced items and failed retailer checks produce a usable, explicitly partial report. A noninteractive address lookup without `--origin-index` prints choices and exits instead of silently choosing the wrong address.

Optional `--budgets budgets.json` maps exact parsed item names to your USD price **per requested unit**, e.g. `{"milk": 4.25, "apples": 1.80}`. These are **your assumptions**, never supplier quotes. `--categories categories.json` maps item names to `groceries`, `sports`, `home`, `books`, `hardware`, `pharmacy`, `electronics`, or `pets`. Use `--tax-grocery` / `--tax-other` to supply effective percentage rates; omitted means unknown. `--no-candidate-prices` excludes automatic online listing estimates.

## What “optimal” means here

1. Photon returns address candidates; you confirm one.
2. Overpass returns actual mapped shops and pharmacies within a 1–20 km radius. Missing street addresses are labeled; coordinates and OSM source links remain available. Some businesses are unmapped, miscategorized, closed or stale.
3. The app selects up to **three closest mapped candidates per needed category**, using straight-line distance only for this shortlist. At most 24 candidates and eight categories enter the optimizer. Department stores such as Walmart/Target are plausible multi-category options, not guarantees of a particular item.
4. OSRM computes a **directed road-duration matrix**. The exact dynamic program jointly chooses stores and their sequence to cover available categories with the shortest estimated drive. `null` means unreachable. The optional return leg is included in the objective.
5. OSRM returns actual road geometry and leg distances for the selected sequence. No straight-line fallback is presented as driving directions.

This is **optimal within the discovered shortlist and category assumptions**, not a global guarantee over all stores, prices or confirmed inventories. Inventory checks currently follow route selection; they do not automatically reroute around a failed or out-of-stock lookup. Review those results before traveling. The route excludes live traffic, opening-hour constraints, parking, shopping time, fuel, deposits and fees. OSM opening hours are shown as raw source data when available.

## Pricing and inventory evidence

The real scraper renders permitted public pages in Chromium and reads Product/Offer JSON-LD or schema microdata. It uses public search pages and, when necessary, one matching product detail page. You can paste a product URL after an item or use a Markdown product link; it must belong to the retailer chosen for that item. Links do not currently force a particular store into the route.

| Evidence | Meaning in AislePilot |
| --- | --- |
| Category match | This store type plausibly carries the category. No item stock or price is verified. |
| Online offer observed | A rendered page supplied a specific price, currency, product title, source URL and check time. |
| Branch offer observed | The offer explicitly identifies a physical location within 200 m of the selected store. Its product/variant still needs review. |
| Blocked / unavailable / unsupported | The lookup could not establish evidence. No price or availability is inferred. |

`InStock` on an online offer **never becomes branch stock** without explicit branch evidence. Even branch evidence is an observation at a point in time, not a guarantee. Text matching identifies candidate products, not exact SKU/edition/size matches. Online candidate estimates are enabled by a visible checkbox and can be excluded per item. They are not confirmed local checkout prices.

No sample prices are shipped into the app. Aggregate `lowPrice` ranges, expired offers, explicit out-of-stock offers, partial word matches, obvious accessory matches and non-USD currencies are excluded from automatic estimates. Unknown online availability remains labeled unknown, even if a price is readable. Generic count quantities assume one listed product/package per item. Quantities in pounds, kilograms, dozens, packs, bottles and other explicit units require a manual unit budget; the app does not invent pack conversions. Product links and exact names help, but do not prove variant equivalence.

Known amounts include only priced entries and supplied tax assumptions. Blank tax rates are **unknown**, not zero. Zero must be entered explicitly. Taxes are budgeting assumptions, not a jurisdiction-specific tax calculation. Category totals show price coverage; unknown entries remain visible.

Public-page adapters are included for DICK'S Sporting Goods, Barnes & Noble, Walmart, Target, Best Buy, Petco and The Home Depot. They are **best-effort adapters, not certified working feeds**; source URLs and page formats change. Giant Eagle and HomeGoods are identified but have no supported public search adapter in this version. Other retailers are reported as unsupported. Add vetted adapters in `server/retailers.mjs` or replace them with authorized retailer APIs for reliable inventory.

## Data services, limits and privacy

Default map services are keyless public instances for modest personal use:

- Photon: `https://photon.komoot.io`. Reasonable use only; no availability guarantee. [Usage policy](https://github.com/komoot/photon#demo-server).
- Overpass: `https://overpass-api.de/api/interpreter`. Bounded area searches, no retries in a tight loop. [Public instance guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
- OSRM: `https://router.project-osrm.org`. No live traffic or SLA. [API docs](https://project-osrm.org/docs/v5.24.0/api/) and [demo usage policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy).
- OSM raster tiles: browser caching and visible attribution; no prefetch or offline download feature. [Tile policy](https://operations.osmfoundation.org/policies/tiles/).

Set `PHOTON_URL`, `OVERPASS_URL` and `OSRM_URL` on the backend to dedicated compatible services for sustained traffic. Default direct-browser endpoints live in `site/providers.mjs`. The backend caches maps in memory for 15 minutes, spaces provider requests, and limits its queue. Inventory results are cached for 10 minutes with their original check times. Caches are bounded and disappear on restart. No third-party analytics are included. A public Pages deployment remains publicly viewable; keep credentials out of it.

The user-entered address is sent to the geocoder; origin/store coordinates go to routing and map services. Shopping item names and selected product URLs reach the backend and relevant retailers during checks. The backend uses no customer accounts, retailer logins, cart or checkout actions. It respects robots.txt, stops on challenges, restricts retailer URLs to an allowlist, and rejects private-address resolutions. It has no CAPTCHA solver, stealth mode, arbitrary URL proxy or CORS bypass. It restricts CORS to exact origins, requires production authentication and caps scrape concurrency. Some first-party content relies on third-party scripts that this conservative scraper blocks; unreadable data remains unknown.

## Code map

| File | Purpose |
| --- | --- |
| `site/index.html`, `styles.css` | Responsive dashboard and real Leaflet map |
| `site/app.mjs` | UI, address confirmation, progress, cancellation, evidence, budgets, export |
| `site/core.mjs` | `parseInput()`, `sortRoute()`, store mapping and `calculateCost()` |
| `site/providers.mjs` | Real geocoding, store search, driving matrix and route adapters |
| `server/index.mjs` | Native Node HTTP server, static serving, API, auth, CORS, rate and queue limits |
| `server/scraper.mjs` | Sandboxed Chromium, robots rules, public-page reads and caching |
| `server/evidence.mjs` | Product offers, matching, price and branch evidence |
| `server/retailers.mjs` | Explicit retailer allowlist and public search/detail adapters |
| `scripts/plan.mjs` | End-to-end CLI |
| `.github/workflows/` | Test and Pages deployment workflows |

## Verification

Run `npm test` (22 automated checks). Tests cover parsing, duplicates and units; exact-route results against exhaustive search; directed and unreachable roads; missing taxes and prices; package/currency exclusions; branch-vs-online stock; expired and aggregate offers; URL restrictions; and HTTP authentication/CORS.

Test data is synthetic and exists only under `tests/`. It is never returned by production provider adapters. See `VALIDATION.md` for the checks actually completed in the delivery environment and any live-service limitations.

## Troubleshooting

- **Address too broad:** include street, city and state, confirm an address-level result, or enter coordinates.
- **No nearby store:** increase the radius, review categories, or verify the place on OSM. A missing map entry is not proof a store does not exist.
- **No route / NoSegment:** the router could not snap a point to a drivable road within 250 m. Try a public road entrance as the origin; inaccessible store data may need an OSM correction.
- **Map API or CORS failure:** connect your own backend and check its provider configuration. The UI reports the failure rather than displaying an invented route.
- **401 / 403 from your backend:** check the private token and the exact `ALLOWED_ORIGINS` value.
- **Chromium launch fails:** use a non-root user, matching Playwright image/package versions, sufficient shared memory and a sandbox-capable host. Check `/health` and the Docker/Playwright documentation.
- **Retailer blocked or price unknown:** follow the source link manually or enter a budget. Do not bypass the retailer's controls. A failed scrape is not evidence of zero cost or unavailable stock.
- **Incomplete cost:** add missing budgets and tax assumptions, or leave the honest partial estimate in place.

Build references: [GitHub Pages static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Playwright Docker](https://playwright.dev/docs/docker), [Leaflet](https://leafletjs.com/examples/quick-start/). Third-party notices are in `THIRD_PARTY.md`.
