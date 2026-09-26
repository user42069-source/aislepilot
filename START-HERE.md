# Start AislePilot V2

## Use it locally

Install Node.js 22.12 or later. Open a terminal in this folder and run:

```sh
npm ci
npm run browser:install
npm start
```

Open **http://localhost:8787**. Enter your starting address and shopping list, select the correct address, and review the route. Unknown products may require a category. Supported retailer checks run after the route appears. Add your own unit budgets where a live price cannot be read. A blank tax rate means unknown.

`npm run browser:install` installs Chromium for retailer checks. Maps and routing can run without it. Linux scraping requires a normal non-root user and browser sandbox support; the included Docker deployment supplies a non-root user.

## Publish on GitHub Pages

1. Put this folder's contents in a GitHub repository, including `.github/workflows` and `site`. Do not upload `node_modules` or `.env`.
2. Push to `main`.
3. Select **Settings → Pages → Source → GitHub Actions**.
4. The included **Test and deploy GitHub Pages** workflow publishes the dashboard.

This produces a working maps-and-routes frontend. For retailer checks, deploy the included backend with Docker using the instructions in `README.md`, then enter its HTTPS URL and token in the dashboard's **Map mode / Connection** button. GitHub Pages cannot run the Chromium scraper itself. No backend hosting account or GitHub deployment has been created by this package.

## Run from a shopping-list file

```sh
npm run plan -- --address "40.4545,-80.1605" --file examples-list.txt --round-trip --output trip.json
```

For an address instead of coordinates, confirm the address candidate at the prompt. Add `--maps-only` to skip retailer checks. See `README.md` for manual budgets, tax rates and automated address confirmation.

## What was verified

See `VALIDATION.md`. Live geocoding, store discovery and road routing succeeded. Do not assume that included retailer adapters guarantee accessible prices, product matches or branch inventory. Missing amounts are reported explicitly, not filled with sample prices.
