# AislePilot V2 validation

Verified 2026-09-26 UTC (2026-09-25 US Eastern).

## Automated checks

- Clean dependency installation from the pinned package lock succeeded.
- `npm test`: **22 passing, zero failing**. Coverage includes list parsing, unknown categories, directed routes and unreachable legs, exact optimization against exhaustive search, unit/currency exclusions, partial budgets, missing tax rates, online versus branch stock, expired offers, domain restrictions, HTTP auth/CORS, cancellation, and a complete CLI → HTTP → map/quote → JSON report flow.
- The CLI/HTTP integration test uses explicitly synthetic test data. It verifies software integration, not live retailer availability.
- Syntax checks passed for the edited browser and scraper modules.
- Docker configuration and Pages workflow are included, but neither a Docker deployment nor a GitHub Actions deployment was executed here.

## Live map check

Live calls to Photon, Overpass and OSRM succeeded:

- Address query: `100 Robinson Centre Drive, Pittsburgh, PA` returned real candidates for user confirmation.
- A directed OSRM matrix returned different outbound and inbound durations, correctly preserving road directionality.
- CLI input: `40.4545,-80.1605`; items: milk, basketball, flower pot, Dune paperback.
- 11 shortlisted candidates were compared. The resulting category-based route selected Walmart Supercenter, **250 Summit Park Drive, Pittsburgh, PA 15275**.
- OSRM returned a 2,195.9 m road route and 316 seconds estimated driving time. These are a dated test observation, not current traffic or a travel promise.
- All four item prices remained unpriced in maps-only mode. No sample price was substituted.

This result minimizes estimated driving time among shortlisted category-compatible stores. It does not establish that Walmart has all four specific products, or that the selected basket is cheapest.

## Live scraping limitation

A real Walmart adapter call returned `unavailable` with a DNS-resolution failure (`EAI_AGAIN`). Standard Playwright browser downloads also failed in this environment. Therefore **a successful live retail price scrape and the production sandboxed Chromium deployment have not been verified here**. Retailer adapters are best-effort source code, not guaranteed feeds. The app reports missing/blocked/unreadable data explicitly and permits user-supplied unit budgets.

The backend includes a 15-second browser-launch deadline and a 55-second page-reading deadline after robots checks. Each retailer permits one active lookup; extra concurrent checks return a retry message rather than waiting in an unbounded retailer queue. Cancelling a map request disconnects the backend's provider request.


## Browser UI validation limitation

Visual browser verification could not be completed: the cloud browser rejected the local preview URL, and a separate local Chromium test runtime failed during graphics initialization. No screenshot or mobile-layout pass is claimed. The dashboard source and responsive styles are included, but browser rendering should be checked on the deployment host before public release. Production scraper sandbox settings were not weakened.
