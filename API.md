# NEA Billing Public API v1

Base URL: **https://nea.saadhan.app**

This read-only API runs entirely on the Cloudflare Worker. It is open without API keys, registration or cookies. Cross-origin browser calls are supported with wildcard CORS, including OPTIONS preflight. The existing app endpoints remain compatible.

- [Interactive-use documentation](https://nea.saadhan.app/api/docs)
- [OpenAPI 3.1 specification](https://nea.saadhan.app/api/v1/openapi.json)
- [Runtime health](https://nea.saadhan.app/api/v1/health)

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/branches` | Current NEA branch directory |
| POST | `/api/v1/readings` | Verified live account statement and billed consumption |
| GET | `/api/v1/health` | API availability; does not contact NEA |
| GET | `/api/v1/openapi.json` | Machine-readable API specification |
| GET | `/api/docs` | Human-readable documentation and examples |

## Requests

```bash
curl https://nea.saadhan.app/api/v1/branches
```

For a statement, use consumer ID, SC number, branch ID and Gregorian ISO dates:

```bash
curl https://nea.saadhan.app/api/v1/readings \
  -H 'Content-Type: application/json' \
  --data '{"consumerId":"12345","scNo":"001.19.001","branch":"241","from":"2026-03-01","to":"2026-10-13"}'
```

The account identifiers are placeholders. Replace them with details for a connection you are authorized to query. Damauli DC's branch ID is 241; find other IDs in the branch directory. Date ranges must be ordered and are limited to approximately three years. JSON bodies are limited to 4096 bytes. NEA requests time out after 25 seconds.

Browser example:

```js
const response = await fetch('https://nea.saadhan.app/api/v1/readings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    consumerId: '12345',
    scNo: '001.19.001',
    branch: '241',
    from: '2026-03-01',
    to: '2026-10-13'
  })
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.summary.months);
```

The integration kit's `examples/frontend-client.mjs` accepts `{baseUrl: 'https://nea.saadhan.app'}` to consume this service from another app. By default it uses versioned endpoints on the current origin.

## Responses

Successful lookup responses retain `account`, `records`, `summary`, `source`, `fetchedAt`, `range`, `readingAvailability` and `note`, and add `apiVersion: "1"` and `requestId`.

`records` preserves the original NEA rows. `summary.months` provides monthly consumed units, base bill, recorded adjustment, VAT billed/payable and uniquely linked charges. `summary.consumption` reports known monthly consumption and missing-month coverage. Monetary values are NPR. Missing numbers are null; actual zeros remain zero. Account ID and SC number are checked against NEA's response, and financial row totals must reconcile with NEA's TOTAL row.

Do not recompute VAT from a universal rate, count VAT rows as monthly consumption, count receipts as bills, subtract successive consumed-unit values as cumulative readings, or interpret a paid/payable discrepancy as an asserted account balance. NEA does not expose cumulative meter readings or the complete taxable base through this source.

Public errors include:

```json
{"error":"Provide valid JSON.","code":"INVALID_REQUEST","requestId":"request UUID"}
```

| Status | Code / meaning |
|---|---|
| 400 | `INVALID_REQUEST`: invalid JSON or validation failure |
| 404 | `NOT_FOUND`: unknown v1 endpoint |
| 405 | `METHOD_NOT_ALLOWED`: check Allow header |
| 413 | `REQUEST_TOO_LARGE`: 4 KB body limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE`: JSON Content-Type required |
| 429 | `RATE_LIMITED`: retry after Retry-After seconds |
| 502 | `NEA_LOOKUP_FAILED`: upstream unavailable, account mismatch or statement format/reconciliation failure |
| 503 | `RATE_LIMITER_UNAVAILABLE`: request limiting missing or unavailable |

The `X-Request-ID` header identifies public requests. No customer statement or account details are logged by application code, saved, or cached. Responses use `Cache-Control: no-store`. CORS allows all origins but does not allow credentialed cookie requests.

## Cloudflare request limits

A native Cloudflare `API_RATE_LIMITER` binding allows approximately 30 requests per 60 seconds per client IP per Cloudflare location. This is a protective, location-local limit, not a strict worldwide quota. Shared networks share capacity. The legacy app and v1 data endpoints use the same limiter key so the legacy endpoints cannot bypass the limit. Calls to those endpoints consume capacity even if the input is invalid.

Documentation, specification, health and preflight do not consume limiter capacity. 429 responses include `Retry-After: 60`. Cloudflare supplies the trusted `CF-Connecting-IP` header. Anonymous service users have no separate authenticated identity key.

The config uses rate-limiter namespace 847291, which is a user-defined positive integer. Keep it unique within your Cloudflare account unless sharing counters is intentional. `REQUIRE_API_RATE_LIMIT: "true"` fails closed if the production binding is missing. Local Node examples omit the binding and do not enforce edge limits; production runs through Wrangler with the committed binding.

No D1, KV or R2 bindings or API credentials are needed. Native Workers Builds continues deploying pushes to main.

## Upstream connectivity

The canonical source is `https://neabilling.com/viewonline/`. Both that HTTPS host and `www.neabilling.com` were verified to serve the public NEA form. A transient server/network failure can retry once against the verified www alias within the same 25-second deadline. Access-denial responses are not retried. Cloudflare public-fetch routing is enabled through `global_fetch_strictly_public`. If NEA remains unreachable, the API returns a structured 502 and does not fabricate statement data.

## Compatibility and upstream dependency

`/api/branches` and `/api/readings` still serve the app. The latter retains its existing same-origin browser policy. Public consumers should use `/api/v1/*`.

This service adapts NEA's undocumented public HTML interface. A successful runtime health check does not establish that NEA is responding. Import complete successful statements; preserve the last successful snapshot when later calls fail.

[Cloudflare rate-limit binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
