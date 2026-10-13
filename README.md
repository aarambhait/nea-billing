# NEA Billing

A web app and reusable backend adapter for NEA's public billing portal. Fetch billed electricity consumption and statement history using a consumer ID, SC number, branch and Gregorian date range.

## Run the app

Requires Node.js 22 or newer. The local Node app has no runtime dependencies. Run `npm ci` to install the pinned Wrangler development dependency when building or deploying to Cloudflare.

```bash
npm start
```

Open http://localhost:3000. Enter an authorized connection's details and click Fetch statement. The UI provides monthly breakdowns, VAT and arrears, payment receipts, all original NEA columns, reconciliation and CSV export. Account fields start empty. IDs shown in examples are placeholders.

```bash
npm test
npm run build
```

The build writes the Worker entry `dist/server/index.js` plus its ES modules, with the UI embedded; Wrangler bundles them on deploy. `npm run check` also smoke-tests the built Worker. Cloudflare deployment configuration is included in `wrangler.jsonc`. [Connect this repository once to enable automatic deployments](CLOUDFLARE.md). Private ChatGPT Site identity and credentials are not included.

For Node 24+ in a proxy-only environment, use `NODE_USE_ENV_PROXY=1 npm start` when required by your infrastructure.

## Cloudflare automatic deployments

Use **Cloudflare Workers Builds** with repository `aarambhait/nea-billing`, production branch `main`, build command `npm run check && npm run build`, and deploy command `npm run deploy`. Worker name: `nea-billing`.

[One-time account connection, exact settings and verification](CLOUDFLARE.md). Once the account connection is activated, pushes to `main` deploy automatically after the checks pass.

## Integration kit

[Full integration guide with embedded source code](integration-kit/README.md) · [Download the integration ZIP](downloads/nea-integration-kit.zip)

The `integration-kit/` directory contains reusable adapter/API modules, a runnable Node demo, browser client functions, Next.js route templates, an optional Express server, a Worker entrypoint and regression tests.

```bash
cd integration-kit
npm start
node tests.mjs
```

The root modules are the source of truth. After changing `adapter.mjs`, `statement.mjs`, `api.mjs`, `openapi.mjs`, `documentation.mjs`, `tests.mjs` or `index.html`, run `npm run sync` to update the kit copies, the kit README's source appendix and the ZIP. `npm run check` fails if they drift.

Copy `adapter.mjs`, `statement.mjs`, `api.mjs`, `openapi.mjs` and `documentation.mjs` into your other project's backend. The guide documents NEA's exact form request, HTML column mapping, JSON schema, grouping logic, error handling, snapshot imports and project-specific access integration.

## Public API

The service is open at `https://nea.saadhan.app/api/v1/`. No API keys or login are required. Browser CORS, an OpenAPI specification, and Cloudflare-native request limits are included.

[Public API documentation](API.md) · [Live API docs](https://nea.saadhan.app/api/docs) · [OpenAPI](https://nea.saadhan.app/api/v1/openapi.json)

Use `GET /api/v1/branches` and `POST /api/v1/readings` for external integrations. The following legacy endpoints remain for the web app:

- `GET /api/branches`: discover NEA's branch IDs from its public form.
- `POST /api/readings`: submit JSON with `consumerId`, `scNo`, `branch`, `from` and `to`.

```json
{"consumerId":"12345","scNo":"001.19.001","branch":"241","from":"2026-03-01","to":"2026-10-13"}
```

These identifiers are placeholders. Damauli's verified branch ID is 241; the returned account location can be TANAHU DC. Application dates are Gregorian ISO; NEA receives MM/DD/YYYY. Bill period labels use Nepali BS.

The response includes verified account details, original records, derived monthly summaries, source totals, requested range and fetched timestamp. Empty numeric cells stay null.

## Consumed units

The app shows NEA-reported consumed units in the latest-month card, each selected monthly breakdown, the monthly bill table, the chart and CSV. The consumption overview gives the total reported units and coverage in the selected range. Missing values remain unavailable, not zero; VAT and payment rows do not contribute to consumption totals.

The development-account statement started providing units in Shrawan/2083: 11,655, followed by 11,974 in Bhadra and 11,282 in Ashwin (34,911 reported units). This is an observation for that account, not a forced start date for all accounts.

## Accounting behavior

The importer preserves NEA's recorded VAT, rebate, penalty and payable amounts. It groups VAT/arrears only when transaction ID plus paid date identifies one monthly bill. Shared receipts are not allocated arbitrarily, and receipts are counted once. Parsed financial totals are checked against NEA's TOTAL row; a mismatch rejects the import.

The source exposes billed consumed units, not previous/current cumulative meter readings. The SC middle group is a reading-schedule cue; actual reading dates govern payment windows. The portal does not expose the taxable base or account category, so the app does not calculate a universal 13% VAT addition. Differences between paid and payable amounts are displayed without inventing credit or debt.

This is an independent adapter for an undocumented HTML interface, not an official NEA API. It does not submit readings, initiate payments, or store account statements. The public API intentionally has no login or API keys. Cloudflare rate limits protect its data endpoints; only query connections you are authorized to access.

## Sources

- [NEA billing portal](https://www.neabilling.com/viewonline/)
- [NEA collection regulations](https://www.nea.org.np/uploads/shares/publication/51207195.pdf)
- [NEA tariff and service charges](https://www.nea.org.np/uploads/shares/Tarrif_rates/Consumer_Tarrif_data.pdf)
- [IRD electricity VAT guideline](https://ird.gov.np/content/13581/guidelines-for-/)
