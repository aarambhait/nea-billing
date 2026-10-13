# NEA integration kit

The reusable modules are adapter.mjs (NEA request, validation and HTML parsing), statement.mjs (monthly views and reconciliation), api.mjs (Web Request/Response endpoints), openapi.mjs (the public specification), and documentation.mjs (the docs page). Copy them together into your backend. They have no third-party dependencies. Use Node 22+ or a compatible Worker runtime. Run npm test for the portable checks. worker.mjs is an optional minimal Worker entrypoint. This kit contains no Site identity, credentials, customer PDF or fetched customer statement.

## Verified upstream request

GET https://www.neabilling.com/viewonline/ for the form and branch list. The select name is NEA_location. Its option values are branch IDs: DAMAULI is 241; this account's returned location is TANAHU DC.

POST https://www.neabilling.com/viewonline/viewonlineresult/ with application/x-www-form-urlencoded:

| Field | Example |
|---|---|
| NEA_location | 241 |
| sc_no | 001.19.001 |
| consumer_id | 12345 |
| Fromdatepicker | 03/01/2026 |
| Todatepicker | 10/13/2026 |

The endpoint returns HTML, not JSON. Its relative form action includes the /viewonline/ prefix; posting to /viewonlineresult/ instead produced 404. No login or API key was required in the inspected flow on 13 October 2026. Recheck if the public flow changes. These are observations, not an official API contract.

## Direct use

```js
import {validate, lookup, branches, upstream, SOURCE} from './adapter.mjs';
const directory = branches(await upstream(SOURCE));
const data = await lookup(validate({
  consumerId: '12345', scNo: '001.19.001', branch: '241',
  from: '2026-03-01', to: '2026-10-13'
}));
```

Application dates are ISO Gregorian AD; upstream dates are MM/DD/YYYY AD. Bill periods are Nepali BS. Do not convert the branch ID, consumer ID or SC number to numeric values. The SC number is not the physical meter serial number.

## Exposing routes

api(request, env) recognizes the legacy GET /api/branches and POST /api/readings and the public v1 routes documented below. POST accepts the same JSON as the direct-use example. It returns account, records, summary, source, fetchedAt, range, readingAvailability and note.

For Next.js, place all five modules under lib/nea and create app/api/readings/route.js:

```js
import {api} from '../../../lib/nea/api.mjs';
export const runtime = 'nodejs';
export async function POST(request) {
  // Apply the project's authentication and connection-ownership check here.
  return api(request);
}
```

Create app/api/branches/route.js with the same import/runtime and `export async function GET(request) { return api(request); }`. If the project uses src/, place app and lib under src. If you rename endpoints, update both the handler and specification. For public Next.js endpoints, also copy app/api/v1/[...segments]/route.js and app/api/docs/route.js from the templates.

For Workers, bind worker.mjs as the entrypoint, preserving the imported modules in your bundle. For Express or another backend, call validate(req.body) then lookup(input) within your existing authenticated route.

For proxy-only Node environments, NODE_USE_ENV_PROXY=1 on Node 24+ may be required; this is infrastructure configuration, not an NEA requirement.

## Response parsing

The 13 source columns map to:

| Zero-based index | Field |
|---|---|
| 0 | sequence |
| 1 | status |
| 2 | period |
| 3 | billDate |
| 4 | consumedUnits |
| 5 | billAmount |
| 6 | adjustment |
| 7 | rate |
| 8 | payableAmount |
| 9 | paidAmount |
| 10 | merchant |
| 11 | transactionId |
| 12 | paidDate |

The parser strips HTML comments, extracts customer details, checks returned consumer ID and SC number against the input, requires the consumed-units header, and keeps source rows. Blank numbers stay null. Each TOTAL row is a control for the preceding section, not another bill. All original sections are retained and reconciled independently. The small parser uses regexes tied to the observed HTML; a larger product can replace it with a DOM parser while preserving the account checks, null handling and totals reconciliation.

Category rules: empty period -> receipt; VAT -> vat; ARREARS -> arrears; period ending in /four-digit-year -> monthly; anything else -> other. kind is payment for receipts, balance for ADVANCE / PAID UPTO / PAY ADVANCE information, and bill for other charge rows. Preserve unknown categories for audit rather than dropping them.

## Monthly totals

Group using transaction ID plus paid date, not SC number or row position. Attach VAT/arrears only when that transaction identifies exactly one monthly bill. Never allocate one receipt to several monthly summaries. Ambiguous extra charges stay in summary.unallocatedCharges and raw records. Unpaid rows with no transaction identity remain unallocated.

For each month:

- baseAmount = monthly billAmount
- adjustmentAmount = monthly payableAmount minus billAmount, using recorded rounded values
- adjustedBaseAmount = monthly payableAmount
- vatAmount = sum of linked VAT billAmount
- vatPayable = sum of linked VAT payableAmount
- otherCharges = linked other payable components
- totalPayable = adjustedBaseAmount + vatPayable + otherCharges
- paidAmount = a uniquely associated receipt, otherwise null

For the selected statement:

- totals.billAmount sums bill component rows only, excluding advance/balance information
- totals.payableAmount sums bill component rows only
- totals.paidAmount sums receipt rows only
- sourceTotals aggregates separately reported billing-section controls; statementGroups preserves every original subtotal
- paidDifference is paid minus payable, not an asserted outstanding balance/credit

The parser rejects disagreements with each matching NEA section subtotal. The implementation sums integer ten-thousandths of a rupee and returns numbers, preserving the source's four-decimal precision. For future fractional-paisa records or audited imports retain original four-decimal strings and use decimal arithmetic or four-decimal integers.

## Verified regression case

For an owner-authorized development account and 2026-03-01 to 2026-10-13, the independently fetched HTML matched the uploaded official PDF: 20 source rows, 8 monthly bills, 8 receipts, and 5 monthly rows with missing units. Totals: billed 625809.93; payable 613963; paid 613964.35. Shrawan's receipt exceeded its component payable by 1.35. Ashwin: 11282 consumed units, base 82771, recorded rebate difference -1655, adjusted base 81116, VAT billed 10760.36, VAT payable 10761, total payable and paid 91877. These are historical regression values; fetch live rather than serving them as account data.

## Errors and limits

400 invalid input/JSON; 403 foreign browser origin; 413 oversized request; 502 upstream timeout/failure, missing or different account, changed format, or totals mismatch; 404 unknown route/method. Responses are no-store. Upstream timeout is 25 seconds. The application date-range limit is approximately three years, not a documented NEA restriction. Missing account and upstream failures are not currently distinguished by typed error codes; add those if your product needs separate UI states.

The origin check is not authentication. Add your project's login, connection ownership, request rate limits and import concurrency control for public use. Do not log consumer details or send them in URLs. Keep upstream destinations fixed. Render normalized strings as text, never inject NEA HTML into your frontend.

## Database imports

This adapter does not persist anything. For importing, use connections (owner, branch ID, consumer ID, SC number), import runs (connection, range, fetched time, parser version), source rows (import ID, sequence, source fields), and optional derived monthly views. Scope sequence to an import and statementGroup because it changes with date range and can restart in another section. Do not use transaction ID as a source-row unique key: bills, VAT and receipts share it.

Begin with immutable snapshots per import and display the latest successful snapshot. Do not sum overlapping snapshots. Build a merged ledger only after defining stable identity/correction rules for shared transactions and unpaid rows. Write successful complete imports atomically; preserve the last successful snapshot if a later fetch fails. Use DECIMAL money columns rather than floats and server-derived owner/connection IDs.

## Schedule, VAT and guidance

The owner identified SC middle group 19 as expected reading on the 19th of each Nepali month. scheduledReadingDay is a schedule cue, not a guaranteed appointment or actual meter-reading timestamp. Never interpret it as a Gregorian day. The source exposes billed consumption, not previous/current cumulative meter readings; do not subtract successive monthly consumption values.

NEA regular payment rules: 2% rebate within 7 days; none days 8–15; 5% surcharge days 16–30; 10% days 31–40; 25% after day 40. Special categories and supplementary bills differ. Estimates must use actual reading dates and stay separate from imported recorded values.

IRD's electricity VAT guideline effective 1 Shrawan 2083 introduced 13% non-household treatment and household exemptions/5% treatment. Do not add 13% blindly: category and taxable base are not exposed and recorded VAT does not always equal 13% of the displayed base. VAT billed and VAT payable are separate upstream values. Check current rules before adding prospective calculations.

Sources:
- https://www.neabilling.com/viewonline/
- https://www.nea.org.np/uploads/shares/publication/51207195.pdf
- https://www.nea.org.np/uploads/shares/Tarrif_rates/Consumer_Tarrif_data.pdf
- https://ird.gov.np/content/13581/guidelines-for-/

## Complete local demo and installation

The ZIP now includes a runnable Node server and the full frontend of the corrected app. No package installation is needed for the default demo:

```bash
unzip nea-integration-kit.zip
cd nea-integration-kit
npm start
```

Open http://localhost:3000 . The demo binds to loopback for local use. It supports branch selection, a live lookup, monthly breakdowns, all original NEA columns, receipt history, reconciliation, the PDF-range shortcut, schedule/rule guidance, and CSV export. Account fields start empty. Enter a connection you are authorized to look up. Example identifiers in this repository are placeholders. The UI sends requests only after the user clicks Fetch statement; branch discovery runs on page load.

To select another port:

```bash
PORT=3001 npm start
```

For an infrastructure environment requiring an HTTP proxy and Node 24+:

```bash
NODE_USE_ENV_PROXY=1 npm start
```

This demo has no application login or database. Before exposing it to other users, connect it to the other project's existing authentication and connection-ownership workflow. The supplied modules handle NEA data retrieval; they do not establish that the signed-in user owns a submitted connection.

Files:

```text
nea-integration-kit/
  README.md                         full guide and source-code appendix
  package.json                      dependency-free local demo and test commands
  adapter.mjs                       upstream request and HTML parser
  statement.mjs                     classification, grouping and reconciliation
  api.mjs                           Web Request/Response endpoints
  openapi.mjs                       public OpenAPI 3.1 specification
  documentation.mjs                 self-contained API docs HTML
  tests.mjs                         portable regression tests
  worker.mjs                        optional Worker entrypoint
  scripts/live-check.mjs             opt-in live lookup check
  examples/frontend-client.mjs       reusable browser fetch functions
  examples/node/server.mjs           runnable local server
  examples/node/index.html           full working example UI
  examples/nextjs/app/api/
    readings/route.js                copy into your Next.js app
    branches/route.js                copy into your Next.js app
  examples/express/server.mjs        optional complete Express API example
```

The Next.js example directory is a set of route templates, not a standalone Next.js project. Copy its app/api files into your existing app and copy the root adapter.mjs, statement.mjs, api.mjs, openapi.mjs and documentation.mjs into that app's lib/nea directory. Both the app and lib directories belong under src if your project uses src.

The Express example has an optional dependency. Install it only if choosing that example:

```bash
npm install express
npm run start:express
```

Stop the default demo first if you use the same port. The Express example provides the API routes and /api/docs, with no app frontend; use your own frontend or the browser client functions. It forwards requests through the shared handler, including v1 CORS and the legacy lookup's origin check. Local Node/Express examples do not enforce Cloudflare's edge limits.

## Architecture and browser integration

```text
Frontend -> your backend -> NEA form POST
                          <- HTML statement
         <- account checks + parsed rows + totals reconciliation -> optional database
```

Import examples/frontend-client.mjs into your frontend and call:

```js
import {fetchNeaStatement,fetchNeaBranches} from './frontend-client.mjs';
const directory=await fetchNeaBranches();
const data=await fetchNeaStatement({
  consumerId:'12345',scNo:'001.19.001',branch:'241',
  from:'2026-03-01',to:'2026-10-13'
});
```

Display loading, success, empty records and errors separately. Use records for a source-row view, summary.months for monthly breakdowns, summary.totals for statement totals, and fetchedAt for freshness. Latest means the final chronologically sorted entry in summary.months, not the final source row (which might be VAT).

The request body's dates and the statement's dates are AD; period labels are BS. If a future UI shows next expected reading dates in Gregorian format, use a verified Nepali-calendar converter. No converter or speculative next-reading date is included.

## Independent curl checks

To obtain upstream HTML directly:

```bash
curl --location \
  'https://www.neabilling.com/viewonline/viewonlineresult/' \
  --data-urlencode 'NEA_location=241' \
  --data-urlencode 'sc_no=001.19.001' \
  --data-urlencode 'consumer_id=12345' \
  --data-urlencode 'Fromdatepicker=03/01/2026' \
  --data-urlencode 'Todatepicker=10/13/2026' \
  --output nea-statement.html
```

To call your local application instead:

```bash
curl 'http://localhost:3000/api/readings' \
  -H 'Content-Type: application/json' \
  --data '{"consumerId":"12345","scNo":"001.19.001","branch":"241","from":"2026-03-01","to":"2026-10-13"}'
```

The first returns HTML; the second returns normalized JSON.

## Testing and release steps

```bash
npm test
# Alternative direct runner:
node tests.mjs
# Explicit network call to NEA; provide your authorized JSON request on stdin:
npm run test:live < local-request.json
```

There are twenty-three portable tests, including monthly-consumption coverage and the distinction between missing values and actual zero consumption. Live upstream statements were also checked during development. The ZIP does not include the downloaded statements used by those original optional fixture tests. The test:live script accepts an authorized connection request on stdin, fetches its own response and reports parsed record counts and totals. A failing historical assertion can mean NEA changed its records, so investigate rather than hardcoding the expected amounts into the importer.

Before releasing in your project:

1. Copy the backend modules and expose the routes.
2. Apply your existing authentication and connection ownership checks.
3. Connect the form to your own backend and handle all response states.
4. Confirm branch discovery, missing units, VAT association and source TOTAL reconciliation.
5. Confirm that receipts are counted once and shared transactions are not allocated arbitrarily.
6. Add persistence only after live retrieval works; use atomic snapshots and the last successful snapshot.
7. Keep parser tests and monitor unexpected HTML or reconciliation failures.

For sensitive auditing, preserve original numeric source strings before normalization. Use decimal database columns and server-derived owner IDs. Database schema, identity integration, rate-limiting infrastructure and Nepali-calendar conversion remain specific to your other project; no implementation of those systems is claimed by this kit.

## Consumed-unit availability and display

The parser retains NEA's CONSUMED UNITS column as `records[].consumedUnits`; monthly summaries also expose `summary.months[].consumedUnits`. A blank is null, while an explicitly reported zero is 0. Do not use VAT rows' zero-unit values to decide whether monthly consumption is available.

The app now explicitly shows consumption in the selected-month breakdown, labels the table column Consumed units, and provides a consumption overview alongside the latest-month card, chart and CSV.

`summary.consumption` includes:

- `totalReportedUnits`: sum of monthly bills with reported units, or null if none report units.
- `reportedMonthlyBills`: number of monthly bills with a non-null unit value, including a real zero.
- `missingMonthlyBills`: monthly bills whose unit value is unavailable.
- `firstReportedPeriod` and `lastReportedPeriod`: first/last available bill periods in the requested range.
- `complete`: true only if at least one monthly bill is returned and every monthly bill reports consumption.

In the owner-authorized development statement, Shrawan/2083 reported 11,655 units, Bhadra/2083 reported 11,974, and Ashwin/2083 reported 11,282. The five earlier monthly bills in the PDF range had null units. The reported total was 34,911 units, covering three of eight monthly bills. The app derives availability from each returned statement rather than forcing Shrawan/2083 as a universal start date or estimating missing older months.

## Public API v1 on Cloudflare

The public service is `https://nea.saadhan.app`. External consumers can use:

- GET `/api/v1/branches`
- POST `/api/v1/readings` with JSON
- GET `/api/v1/health` (runtime only)
- GET `/api/v1/openapi.json`
- GET `/api/docs`

No API key or registration is required. v1 responses and errors include wildcard CORS; OPTIONS returns 204 for browser preflight. Successful lookups add `apiVersion: "1"` and `requestId` to the existing statement fields. Errors include a machine-readable code and requestId, also exposed as X-Request-ID. Legacy app routes remain compatible and keep their existing browser-origin policy.

Copy **all five backend modules** when reusing the shared handler: adapter.mjs, statement.mjs, api.mjs, openapi.mjs and documentation.mjs. The core adapter alone still needs only adapter.mjs and statement.mjs. Next.js route templates include a v1 catch-all and docs route. The browser client defaults to v1 and accepts `{baseUrl: 'https://nea.saadhan.app'}` for remote calls.

The production Worker receives a native `API_RATE_LIMITER` binding through wrangler.jsonc: approximately 30 data-endpoint requests per minute per client IP per Cloudflare location. Both legacy and v1 endpoints share it. Clients behind shared networks share capacity; this is not a strict global quota. Health, documentation, specification and preflight are excluded. 429 includes Retry-After: 60. REQUIRE_API_RATE_LIMIT=true prevents production data requests from proceeding if the binding is missing. Local Node examples omit the binding and do not enforce edge limits.

The Cloudflare namespace ID is an account-unique, user-defined positive integer; the repository uses 847291. No D1, KV, R2 or API-key database is needed. Detailed usage, response fields and error codes are in the root [API.md](../API.md) and the live docs page. No customer statements are persisted or cached. CORS enables public browser clients; it is not proof that a caller owns a supplied account.

The canonical NEA hostname is neabilling.com; the verified www alias is retried only for transient network/server failures within the same 25-second deadline. The production Worker enables public fetch routing. Access-denial responses are never retried against aliases.

## Multiple section subtotals and advance balances

The updated NEA statement can append a PAY ADVANCE section after a paid-transaction TOTAL. Taking only the last TOTAL would replace the billing subtotal with a balance subtotal and incorrectly reject valid data.

The parser now retains each section and reconciles the source columns separately. `records[].statementGroup` and `summary.months[].statementGroup` identify source sections. `summary.statementGroups` includes id, status, billing, recordSequences, sourceTotals, computedTotals and mismatches. `summary.balanceRecords` preserves ADVANCE and PAID UPTO rows with kind balance; they are excluded from bill/payment totals and consumed-unit totals. Negative advance amounts are displayed as NEA's information, not inferred as new bills or receipts.

In the current owner-authorized example, the paid section still reports billed 625,809.93 / payable 613,963 / paid 613,964.35; a separate balance section reports ADVANCE -1.43 and PAID UPTO. Both section controls reconcile, all 22 source rows are preserved, and reported consumption remains 34,911. Genuine changes to either subtotal still reject the statement. Four-decimal source amounts are summed before presentation rounding. Source row identity in a snapshot is (import_run_id, statementGroup, sequence).

The following appendix includes all supplied source files, so this Markdown guide is independently usable even without extracting the ZIP.

## Source: package.json

```json
{
  "name": "nea-integration-kit",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests.mjs",
    "start": "node examples/node/server.mjs",
    "test:live": "node scripts/live-check.mjs",
    "start:express": "node examples/express/server.mjs"
  },
  "engines": {
    "node": ">=22"
  }
}
```

## Source: adapter.mjs

```javascript
import {analyze} from './statement.mjs';
export const SOURCE = 'https://neabilling.com/viewonline/';
export function clean(value) {
 return value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/\s+/g,' ').trim();
}
export function branches(html) {
 const select=html.match(/<select\b[^>]*name=["']NEA_location["'][^>]*>([\s\S]*?)<\/select>/i)?.[1];
 if(!select) throw new Error('NEA branch list format has changed.');
 const list=[...select.matchAll(/<option\b[^>]*value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi)].map(m=>({id:m[1],name:clean(m[2]),label:m[1]==='241'?'Damauli DC':clean(m[2])}));
 if(!list.length) throw new Error('NEA returned no branches.');
 return list;
}
const number=s=>s===''?null:Number.isFinite(Number(s.replace(/,/g,'')))?Number(s.replace(/,/g,'')):null;
export function parseStatement(html, input) {
 html=html.replace(/<!--[\s\S]*?-->/g,'');
 const cells=[...html.matchAll(/<td\b[^>]*>([^]*?)<\/td>/gi)].map(m=>clean(m[1]));
 function detail(label) {const i=cells.findIndex(c=>c.toLowerCase()===label.toLowerCase());return i<0?null:cells[i+1];}
 // Match detail pairs directly: nested outer table cells otherwise absorb the first label.
 function pair(label) { const m=html.match(new RegExp('<td\\b[^>]*>\\s*'+label+'\\s*</td>\\s*<td\\b[^>]*>([^]*?)</td>','i'));return m?clean(m[1]):detail(label); }
 const account={name:pair('Customer Name'),location:pair('NEA Location'),consumerId:pair('Consumer Id'),scNo:pair('SC No'),branchId:input.branch};
 if(!account.consumerId || !account.scNo) throw new Error('NEA did not return a matching account. Check consumer ID, SC number and branch.');
 if(account.consumerId!==input.consumerId || account.scNo.toUpperCase()!==input.scNo.toUpperCase()) throw new Error('NEA returned a different account. Please check your details.');
 if(!/CONSUMED\s+UNITS/i.test(clean(html))) throw new Error('NEA statement format has changed.');
 const records=[];const groups=[];let group={id:1,status:null,records:[],sourceTotals:null};
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const c=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
  if(c.length===13&&c[3].toUpperCase()==='TOTAL'){group.status=c[1]||null;group.sourceTotals={billAmount:number(c[5]),payableAmount:number(c[8]),paidAmount:number(c[9])};groups.push(group);group={id:groups.length+1,status:null,records:[],sourceTotals:null};continue;}
  if(c.length!==13 || !/^\d+$/.test(c[0])) continue;
  const category=!c[2]&&number(c[9])!==null?'receipt':/^ADVANCE$/i.test(c[2])?'advance':/^PAID\s+UP\s*TO\b/i.test(c[2])||/^PAY\s+ADVANCE$/i.test(c[1])?'balance':!c[2]?'receipt':/^VAT$/i.test(c[2])?'vat':/^ARREARS$/i.test(c[2])?'arrears':/\/\d{4}$/.test(c[2])?'monthly':'other';
  const record={sequence:Number(c[0]),statementGroup:group.id,kind:['advance','balance'].includes(category)?'balance':c[2]?'bill':'payment',category,status:c[1],period:c[2]||null,billDate:c[3]||null,consumedUnits:number(c[4]),billAmount:number(c[5]),adjustment:c[6]||null,rate:number(c[7]),payableAmount:number(c[8]),paidAmount:number(c[9]),merchant:c[10]||null,transactionId:c[11]||null,paidDate:c[12]||null};records.push(record);group.records.push(record);
 }
 if(group.records.length)groups.push(group);
 const summary=analyze(records,null,account.scNo,groups);
 if(summary.sourceTotalMismatches.length) throw new Error('NEA statement rows do not reconcile with its totals. Please retry or use the official portal.');
 return {account,records,summary,source:SOURCE,fetchedAt:new Date().toISOString(),range:{from:input.from,to:input.to},readingAvailability:{previousReading:false,currentReading:false,consumedUnits:summary.months.some(r=>r.consumedUnits!==null)},note:'NEA exposes billed consumed units, not cumulative meter readings. Blank upstream values are returned as null. VAT and arrears are separate bill rows; payment receipts are separate payment rows. Advance and balance information is preserved separately from bill/payment totals.'};
}
export function validate(body) {
 const consumerId=String(body.consumerId??'').trim(), scNo=String(body.scNo??'').trim(), branch=String(body.branch??'').trim();
 if(!/^\d{1,20}$/.test(consumerId)) throw new Error('Enter a numeric consumer ID.');
 if(!/^[A-Za-z0-9.\/-]{3,40}$/.test(scNo)) throw new Error('Enter the SC number exactly as printed on your bill.');
 if(!/^\d{1,6}$/.test(branch)) throw new Error('Select a branch.');
 const dates=[body.from,body.to];
 if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d??'') || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10)!==d)) throw new Error('Choose valid from and to dates.');
 if(body.from>body.to) throw new Error('From date must come before to date.');
 if(Date.parse(body.to)-Date.parse(body.from)>3*366*86400000) throw new Error('Choose a range of three years or less.');
 return {consumerId,scNo,branch,from:body.from,to:body.to};
}
const format=d=>d.slice(5,7)+'/'+d.slice(8,10)+'/'+d.slice(0,4);
export async function upstream(url,options={}) {
 const signal=AbortSignal.timeout(25000);
 const parsed=new URL(url);
 const candidates=[url];
 // Both HTTPS aliases serve NEA's verified public form. Never retry access denials.
 if(parsed.hostname==='neabilling.com'){const alternate=new URL(parsed);alternate.hostname='www.neabilling.com';candidates.push(alternate.href);}
 const transient=new Set([500,502,503,504,520,521,522,523,524]);
 let lastError;
 for(let i=0;i<candidates.length;i++){
  let response;
  try{response=await fetch(candidates[i],{...options,signal});}
  catch(error){lastError=error;if(signal.aborted||i===candidates.length-1)throw error;continue;}
  if(!response.ok){
   lastError=new Error('NEA service returned HTTP '+response.status+'. Please try again later.');
   if(transient.has(response.status)&&i<candidates.length-1){await response.body?.cancel();continue;}
   throw lastError;
  }
  const text=await response.text();
  if(text.length>3000000)throw new Error('NEA returned an unexpectedly large response. Choose a shorter range.');
  return text;
 }
 throw lastError;
}
export async function lookup(input) {
 const body=new URLSearchParams({NEA_location:input.branch,sc_no:input.scNo,consumer_id:input.consumerId,Fromdatepicker:format(input.from),Todatepicker:format(input.to)});
 return parseStatement(await upstream(SOURCE+'viewonlineresult/',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'}}),input);
}
```

## Source: statement.mjs

```javascript
// Derived views preserve NEA rows. Never estimate VAT or allocate shared receipts.
const moneyUnits=n=>Math.round(n*10000);
export const sumMoney=values=>values.some(n=>n===null)?null:values.reduce((s,n)=>s+moneyUnits(n),0)/10000;
export function billISO(value) {
 const m=value?.match(/^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/i);if(!m)return null;
 const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2].toUpperCase())+1;if(!month)return null;
 const y=m[3].length===2?2000+Number(m[3]):Number(m[3]);const date=`${y}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 return new Date(date).toISOString().slice(0,10)===date?date:null;
}
const rowId=r=>(r.statementGroup??'legacy')+':'+r.sequence;
const key=r=>r.transactionId&&r.paidDate?(r.statementGroup??'legacy')+'|'+r.transactionId+'|'+r.paidDate:null;
export function analyze(records,sourceTotals,scNo,groups=[]) {
 const monthly=records.filter(r=>r.category==='monthly');
 const extras=records.filter(r=>r.kind==='bill'&&r.category!=='monthly');
 const transactions=new Map();
 for(const r of records){const k=key(r);if(k){if(!transactions.has(k))transactions.set(k,[]);transactions.get(k).push(r);}}
 const assigned=new Set();
 const months=monthly.map(r=>{
  const group=key(r)?transactions.get(key(r)):[];
  const uniqueMonth=group?.filter(x=>x.category==='monthly').length===1;
  const related=uniqueMonth?group.filter(x=>x.kind==='bill'&&x.category!=='monthly'):[];
  related.forEach(x=>assigned.add(rowId(x)));
  const vat=related.filter(x=>x.category==='vat'),other=related.filter(x=>x.category!=='vat');
  const receipts=uniqueMonth?group.filter(x=>x.kind==='payment'):[];
  const adjustmentAmount=r.billAmount!==null&&r.payableAmount!==null?(moneyUnits(r.payableAmount)-moneyUnits(r.billAmount))/10000:null;
  const totalPayable=sumMoney([r.payableAmount,...related.map(x=>x.payableAmount)]);
  const paid=receipts.length===1?receipts[0].paidAmount:null;
  return {sequence:r.sequence,statementGroup:r.statementGroup??null,period:r.period,billDate:r.billDate,billDateISO:billISO(r.billDate),consumedUnits:r.consumedUnits,baseAmount:r.billAmount,adjustment:r.adjustment,adjustmentRate:r.rate,adjustmentAmount,adjustedBaseAmount:r.payableAmount,vatAmount:sumMoney(vat.map(x=>x.billAmount)),vatPayable:sumMoney(vat.map(x=>x.payableAmount)),vatPresent:vat.length>0,otherCharges:sumMoney(other.map(x=>x.payableAmount)),totalPayable,paidAmount:paid,paymentDifference:paid!==null&&totalPayable!==null?(moneyUnits(paid)-moneyUnits(totalPayable))/10000:null,status:r.status,transactionId:r.transactionId,paidDate:r.paidDate,sourceSequences:[r.sequence,...related.map(x=>x.sequence)],receiptSequence:receipts.length===1?receipts[0].sequence:null,association:uniqueMonth?'single-month transaction':'monthly row only; no unique transaction allocation'};
 }).sort((a,b)=>(a.billDateISO??'').localeCompare(b.billDateISO??'')||a.sequence-b.sequence);
 const totals={billAmount:sumMoney(records.filter(r=>r.kind==='bill').map(r=>r.billAmount)),payableAmount:sumMoney(records.filter(r=>r.kind==='bill').map(r=>r.payableAmount)),paidAmount:sumMoney(records.filter(r=>r.kind==='payment').map(r=>r.paidAmount))};
 let mismatches=sourceTotals?Object.keys(totals).filter(k=>sourceTotals[k]!==null&&(totals[k]===null||moneyUnits(totals[k])!==moneyUnits(sourceTotals[k]))):[];
 const statementGroups=groups.map(g=>{
  const computedTotals=Object.fromEntries(['billAmount','payableAmount','paidAmount'].map(field=>{
   const values=g.records.map(r=>r[field]).filter(n=>n!==null);
   return [field,values.length?sumMoney(values):0];
  }));
  const fields=g.sourceTotals?Object.keys(computedTotals).filter(field=>g.sourceTotals[field]!==null&&(computedTotals[field]===null||moneyUnits(computedTotals[field])!==moneyUnits(g.sourceTotals[field]))):[];
  return {id:g.id,status:g.status||g.records[0]?.status||null,billing:g.records.length===0||g.records.some(r=>r.kind!=='balance'),recordSequences:g.records.map(r=>r.sequence),sourceTotals:g.sourceTotals,computedTotals,mismatches:fields};
 });
 if(groups.length){
  mismatches=statementGroups.flatMap(g=>g.mismatches.map(field=>'section '+g.id+': '+field));
  const billingGroups=groups.filter(g=>g.records.length===0||g.records.some(r=>r.kind!=='balance'));
  const haveSeparateControls=billingGroups.length>0&&billingGroups.every(g=>g.sourceTotals&&g.records.every(r=>r.kind!=='balance'));
  sourceTotals=haveSeparateControls?Object.fromEntries(['billAmount','payableAmount','paidAmount'].map(field=>{
   const values=billingGroups.map(g=>g.sourceTotals[field]).filter(n=>n!==null);
   return [field,values.length?sumMoney(values):null];
  })):null;
 }
 const paidDifference=totals.paidAmount!==null&&totals.payableAmount!==null?(moneyUnits(totals.paidAmount)-moneyUnits(totals.payableAmount))/10000:null;
 const reportedMonths=months.filter(m=>m.consumedUnits!==null);
 const consumption={totalReportedUnits:reportedMonths.length?reportedMonths.reduce((total,m)=>total+m.consumedUnits,0):null,reportedMonthlyBills:reportedMonths.length,missingMonthlyBills:months.length-reportedMonths.length,firstReportedPeriod:reportedMonths[0]?.period??null,lastReportedPeriod:reportedMonths.at(-1)?.period??null,complete:months.length>0&&reportedMonths.length===months.length};
 const middle=scNo.match(/^\d+[.\/-](\d{1,2})[.\/-]/)?.[1];const scheduledReadingDay=middle&&Number(middle)>=1&&Number(middle)<=32?Number(middle):null;
 return {months,consumption,totals,sourceTotals,statementGroups,balanceRecords:records.filter(r=>r.kind==='balance'),paidDifference,sourceTotalMismatches:mismatches,unallocatedCharges:extras.filter(x=>!assigned.has(rowId(x))),scheduledReadingDay};
}
```

## Source: api.mjs

```javascript
import {SOURCE,branches,upstream,lookup,validate} from './adapter.mjs';
import {apiSpecification} from './openapi.mjs';
import {API_DOCS_HTML} from './documentation.mjs';

const API_PREFIX='/api/v1/';
const MAX_BODY_BYTES=4096;
const PUBLIC_CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'Retry-After, X-Request-ID','Access-Control-Max-Age':'86400'};
class InputError extends Error {constructor(message,status=400,code='INVALID_REQUEST'){super(message);this.status=status;this.code=code;}}
async function requestJson(request){
 if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES)throw new InputError('Request too large.',413,'REQUEST_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new InputError('A JSON request body is required.');
 const chunks=[];let size=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw new InputError('Request too large.',413,'REQUEST_TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new InputError('Provide valid JSON.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new InputError('Provide a JSON object with consumerId, scNo, branch, from and to.');
 try{return validate(body);}catch(error){throw new InputError(error.message);}
}
export async function api(request,env={}){
 const path=new URL(request.url).pathname;
 const isPublic=path.startsWith(API_PREFIX)||path==='/api/v1';
 const requestId=isPublic?crypto.randomUUID():null;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(isPublic?{...PUBLIC_CORS,'X-Request-ID':requestId}:{})};
 const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
 const fail=(message,status,code,extra={})=>json({error:message,...(isPublic?{code,requestId}:{})},status,extra);
 const routes={'/api/v1/branches':'GET','/api/v1/readings':'POST','/api/v1/health':'GET','/api/v1/openapi.json':'GET'};
 if(path==='/api/docs'){
  if(request.method!=='GET')return fail('Method not allowed.',405,'METHOD_NOT_ALLOWED',{Allow:'GET'});
  return new Response(API_DOCS_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 }
 if(isPublic){
  if(!routes[path])return fail('Unknown API endpoint.',404,'NOT_FOUND');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,Allow:routes[path]+', OPTIONS'}});
  if(request.method!==routes[path])return fail('Method not allowed.',405,'METHOD_NOT_ALLOWED',{Allow:routes[path]+', OPTIONS'});
  if(path==='/api/v1/openapi.json')return json(apiSpecification());
  if(path==='/api/v1/health')return json({status:'ok',apiVersion:'1',requestId,upstream:'NEA is checked only when a lookup is requested.'});
 }
 const branchRoute=path==='/api/branches'||path==='/api/v1/branches';
 const readingRoute=path==='/api/readings'||path==='/api/v1/readings';
 if(!(branchRoute&&request.method==='GET')&&!(readingRoute&&request.method==='POST'))return fail('Unknown endpoint or unsupported method.',404,'NOT_FOUND');
 if(!isPublic&&readingRoute){const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return fail('Cross-origin requests are not allowed.',403,'FORBIDDEN');}
 if(isPublic&&readingRoute&&request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return fail('Use Content-Type: application/json.',415,'UNSUPPORTED_MEDIA_TYPE');
 try {
  // Cloudflare supplies this header; callers cannot choose a trusted identity key.
  if(env.API_RATE_LIMITER){
   let allowed;try{allowed=await env.API_RATE_LIMITER.limit({key:'nea-billing:client:'+(request.headers.get('CF-Connecting-IP')||'unknown')});}
   catch{return fail('Request limiting is temporarily unavailable.',503,'RATE_LIMITER_UNAVAILABLE');}
   if(!allowed.success)return fail('Too many NEA requests. Retry in 60 seconds.',429,'RATE_LIMITED',{'Retry-After':'60'});
  }else if(env.REQUIRE_API_RATE_LIMIT==='true')return fail('Request limiting is not configured.',503,'RATE_LIMITER_UNAVAILABLE');
  if(branchRoute){const data={branches:branches(await upstream(SOURCE)),source:SOURCE};return json({...data,...(isPublic?{apiVersion:'1',requestId}:{})});}
  const input=await requestJson(request);
  const data=await lookup(input);
  return json({...data,...(isPublic?{apiVersion:'1',requestId}:{})});
 }catch(error){
  if(error instanceof InputError)return fail(error.message,error.status,error.code);
  return fail(error.name==='TimeoutError'?'NEA is taking too long to respond. Please try again.':error.message,502,'NEA_LOOKUP_FAILED');
 }
}
```

## Source: openapi.mjs

```javascript
export function apiSpecification(){return {
  "openapi": "3.1.0",
  "info": {
    "title": "NEA Billing Public API",
    "version": "1.0.0",
    "description": "Independent, unauthenticated, read-only adapter to NEA billing HTML. Amounts are NPR. Missing units remain null. Rate limit: 30 NEA-bound requests per minute per client IP per Cloudflare location; an approximate protective limit, not a global quota. Shared-IP clients share capacity. No account statement storage."
  },
  "servers": [
    {
      "url": "/",
      "description": "The Cloudflare origin serving this specification"
    }
  ],
  "security": [],
  "paths": {
    "/api/v1/branches": {
      "get": {
        "operationId": "listBranches",
        "summary": "List current NEA branches",
        "responses": {
          "200": {
            "description": "Branch directory",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "branches": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Branch"
                      }
                    },
                    "source": {
                      "type": "string"
                    },
                    "apiVersion": {
                      "type": "string"
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "description": "Rate limit; wait 60 seconds",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            },
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "integer",
                  "example": 60
                },
                "description": "Seconds to wait before retrying."
              }
            }
          },
          "502": {
            "description": "NEA lookup failed or statement could not be verified",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Request limiter unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/readings": {
      "post": {
        "operationId": "fetchStatement",
        "summary": "Fetch an authorized account statement",
        "description": "Dates are Gregorian ISO; maximum range approximately three years. Consumed units are billed monthly usage, not cumulative meter readings. Use recorded VAT/payables instead of recomputing tax. Identifiers shown in examples are placeholders.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LookupRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Verified live NEA statement",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Statement"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Body exceeds 4096 bytes",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "JSON Content-Type required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate limit; wait 60 seconds",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            },
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "integer",
                  "example": 60
                },
                "description": "Seconds to wait before retrying."
              }
            }
          },
          "502": {
            "description": "NEA lookup failed or statement could not be verified",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Request limiter unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/health": {
      "get": {
        "operationId": "health",
        "summary": "Check API runtime availability; does not contact NEA",
        "responses": {
          "200": {
            "description": "API available",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "const": "ok"
                    },
                    "apiVersion": {
                      "type": "string"
                    },
                    "requestId": {
                      "type": "string"
                    },
                    "upstream": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/openapi.json": {
      "get": {
        "operationId": "openApi",
        "summary": "Download this OpenAPI specification",
        "responses": {
          "200": {
            "description": "OpenAPI 3.1 specification",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "LookupRequest": {
        "type": "object",
        "properties": {
          "consumerId": {
            "type": "string",
            "pattern": "^[0-9]{1,20}$",
            "example": "12345"
          },
          "scNo": {
            "type": "string",
            "minLength": 3,
            "maxLength": 40,
            "example": "001.19.001",
            "description": "SC number including separators; not physical meter serial."
          },
          "branch": {
            "type": "string",
            "pattern": "^[0-9]{1,6}$",
            "example": "241"
          },
          "from": {
            "type": "string",
            "format": "date",
            "example": "2026-03-01"
          },
          "to": {
            "type": "string",
            "format": "date",
            "example": "2026-10-13"
          }
        },
        "required": [
          "consumerId",
          "scNo",
          "branch",
          "from",
          "to"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "code": {
            "type": "string"
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "error",
          "code",
          "requestId"
        ]
      },
      "Branch": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name",
          "label"
        ]
      },
      "Totals": {
        "type": "object",
        "properties": {
          "billAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "payableAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          }
        }
      },
      "Record": {
        "type": "object",
        "properties": {
          "consumedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "billAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "rate": {
            "type": [
              "number",
              "null"
            ]
          },
          "payableAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "period": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "adjustment": {
            "type": [
              "string",
              "null"
            ]
          },
          "merchant": {
            "type": [
              "string",
              "null"
            ]
          },
          "transactionId": {
            "type": [
              "string",
              "null"
            ]
          },
          "paidDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "sequence": {
            "type": "integer"
          },
          "kind": {
            "type": "string",
            "enum": [
              "bill",
              "payment",
              "balance"
            ]
          },
          "category": {
            "type": "string",
            "enum": [
              "monthly",
              "vat",
              "arrears",
              "receipt",
              "other",
              "advance",
              "balance"
            ]
          },
          "status": {
            "type": "string"
          },
          "statementGroup": {
            "type": "integer",
            "description": "Section containing this original row; use with sequence to identify rows within a snapshot."
          }
        }
      },
      "Month": {
        "type": "object",
        "properties": {
          "consumedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "baseAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustmentRate": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustmentAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustedBaseAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "vatAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "vatPayable": {
            "type": [
              "number",
              "null"
            ]
          },
          "otherCharges": {
            "type": [
              "number",
              "null"
            ]
          },
          "totalPayable": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paymentDifference": {
            "type": [
              "number",
              "null"
            ]
          },
          "period": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDateISO": {
            "type": [
              "string",
              "null"
            ]
          },
          "adjustment": {
            "type": [
              "string",
              "null"
            ]
          },
          "transactionId": {
            "type": [
              "string",
              "null"
            ]
          },
          "paidDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "association": {
            "type": [
              "string",
              "null"
            ]
          },
          "sequence": {
            "type": "integer"
          },
          "vatPresent": {
            "type": "boolean"
          },
          "status": {
            "type": "string"
          },
          "sourceSequences": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "receiptSequence": {
            "type": [
              "integer",
              "null"
            ]
          },
          "statementGroup": {
            "type": [
              "integer",
              "null"
            ]
          }
        }
      },
      "Consumption": {
        "type": "object",
        "properties": {
          "totalReportedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "reportedMonthlyBills": {
            "type": "integer"
          },
          "missingMonthlyBills": {
            "type": "integer"
          },
          "firstReportedPeriod": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastReportedPeriod": {
            "type": [
              "string",
              "null"
            ]
          },
          "complete": {
            "type": "boolean"
          }
        }
      },
      "Statement": {
        "type": "object",
        "properties": {
          "apiVersion": {
            "type": "string",
            "const": "1"
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          },
          "account": {
            "type": "object",
            "properties": {
              "name": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "location": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "consumerId": {
                "type": "string"
              },
              "scNo": {
                "type": "string"
              },
              "branchId": {
                "type": "string"
              }
            }
          },
          "records": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Record"
            }
          },
          "summary": {
            "type": "object",
            "properties": {
              "months": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Month"
                }
              },
              "consumption": {
                "$ref": "#/components/schemas/Consumption"
              },
              "totals": {
                "$ref": "#/components/schemas/Totals"
              },
              "sourceTotals": {
                "anyOf": [
                  {
                    "$ref": "#/components/schemas/Totals"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Aggregated reported controls for separate billing sections; null if no separate billing controls are supplied. Original section controls remain in statementGroups."
              },
              "paidDifference": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "sourceTotalMismatches": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "unallocatedCharges": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Record"
                }
              },
              "scheduledReadingDay": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "statementGroups": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/StatementGroup"
                }
              },
              "balanceRecords": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Record"
                }
              }
            }
          },
          "source": {
            "type": "string",
            "format": "uri"
          },
          "fetchedAt": {
            "type": "string",
            "format": "date-time"
          },
          "range": {
            "type": "object",
            "properties": {
              "from": {
                "type": "string",
                "format": "date"
              },
              "to": {
                "type": "string",
                "format": "date"
              }
            }
          },
          "readingAvailability": {
            "type": "object",
            "properties": {
              "previousReading": {
                "type": "boolean",
                "const": false
              },
              "currentReading": {
                "type": "boolean",
                "const": false
              },
              "consumedUnits": {
                "type": "boolean"
              }
            }
          },
          "note": {
            "type": "string"
          }
        }
      },
      "StatementGroup": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "status": {
            "type": [
              "string",
              "null"
            ]
          },
          "billing": {
            "type": "boolean"
          },
          "recordSequences": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "sourceTotals": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/Totals"
              },
              {
                "type": "null"
              }
            ]
          },
          "computedTotals": {
            "$ref": "#/components/schemas/Totals"
          },
          "mismatches": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    }
  }
};}
```

## Source: documentation.mjs

```javascript
export const API_DOCS_HTML="<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>NEA Billing \u00b7 Public API</title><meta name=\"description\" content=\"Public, read-only NEA billing API. Fetch branches, billed consumption and verified statement history.\"><style>:root{font-family:system-ui,sans-serif;color:#173c32;background:#f3f7f3}*{box-sizing:border-box}body{margin:0}main{max-width:980px;margin:auto;padding:45px 24px}h1{font-size:38px;letter-spacing:-1.5px}h2{font-size:22px;margin-top:32px}p,li{line-height:1.8;color:#52715e}a{color:#17684d}section{background:white;border:1px solid #dbe7da;border-radius:14px;padding:23px;margin:20px 0}code,pre{font-family:ui-monospace,monospace;font-size:13px}pre{background:#163b30;color:#edf5e9;border-radius:10px;padding:18px;overflow:auto;line-height:1.7}.method{font-size:11px;color:#3d805b;background:#edf4e8;border-radius:5px;padding:5px 8px;margin-right:8px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e6eee3}th{color:#709065;font-weight:500}.actions{display:flex;flex-wrap:wrap;gap:15px}.note{font-size:13px}footer{padding:25px 0;color:#789076;font-size:12px}.endpoint{overflow-wrap:anywhere}@media(max-width:600px){h1{font-size:30px}section{padding:18px}td,th{padding:9px}table{font-size:12px}}</style></head><body><main><a href=\"/\">\u2190 NEA Billing app</a><h1>NEA Billing Public API</h1><p>Fetch NEA branches, monthly consumed units, bills and payment history from one Cloudflare-hosted service. No API key or login is required.</p><div class=\"actions\"><a href=\"/api/v1/openapi.json\">OpenAPI specification \u2197</a><a href=\"/api/v1/branches\">View branch directory \u2197</a><a href=\"/api/v1/health\">API health \u2197</a></div><p>Base URL: <code id=\"base-url\"></code></p><section><h2><span class=\"method\">GET</span><code class=\"endpoint\">/api/v1/branches</code></h2><p>Returns the current NEA branch directory. Use the branch\u2019s string <code>id</code> in lookup requests. Damauli DC is <code>241</code>.</p><pre id=\"branches-example\"></pre></section><section><h2><span class=\"method\">POST</span><code class=\"endpoint\">/api/v1/readings</code></h2><p>Send <code>Content-Type: application/json</code> with these five fields. Dates use Gregorian ISO format; statement period labels use Nepali BS.</p><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody><tr><td><code>consumerId</code></td><td>Consumer ID as a string</td></tr><tr><td><code>scNo</code></td><td>Service connection number, including separators</td></tr><tr><td><code>branch</code></td><td>NEA branch ID as a string</td></tr><tr><td><code>from</code></td><td>Starting date: YYYY-MM-DD</td></tr><tr><td><code>to</code></td><td>Ending date: YYYY-MM-DD</td></tr></tbody></table><p class=\"note\">Example identifiers below are placeholders. Replace them with details for a connection you are authorized to query.</p><pre id=\"curl-example\"></pre><h2>JavaScript / browser</h2><pre id=\"javascript-example\"></pre></section><section><h2>Reading the response</h2><ul><li><code>account</code>: NEA account details checked against the requested ID and SC number.</li><li><code>records</code>: original statement rows, including bills, VAT, arrears, receipts and advance/balance information.</li><li><code>summary.months</code>: monthly consumed units and payable breakdowns.</li><li><code>summary.consumption</code>: total reported units, reporting coverage and first/last reported month.</li><li><code>summary.statementGroups</code>: each NEA section, its original subtotal and reconciliation result.</li><li><code>summary.balanceRecords</code>: advance/balance rows kept outside billed and paid totals.</li><li><code>summary.totals</code> and <code>summary.sourceTotals</code>: billing/payment totals reconciled with their matching section controls.</li><li><code>fetchedAt</code> and <code>range</code>: lookup time and requested date range.</li></ul><p>Missing consumed units remain <code>null</code>, not zero. Amounts are NPR. Preserve recorded VAT and payable amounts rather than calculating a universal 13% addition. Payment receipts are counted once; shared receipts are not assigned arbitrarily to monthly bills. Previous/current cumulative meter readings are not exposed by the upstream portal.</p></section><section><h2>Limits and errors</h2><p>Data endpoints allow approximately 30 requests per minute per client IP per Cloudflare location. The web app and public API share the limit. Clients behind the same network share capacity. Health, documentation, specification and CORS preflight requests do not count. No customer statements are saved or cached.</p><p>Lookup bodies are limited to 4 KB, date ranges to approximately three years, and NEA requests time out after 25 seconds. Browser cross-origin requests are supported without cookies.</p><table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody><tr><td>400</td><td>Invalid JSON or account/date input</td></tr><tr><td>404 / 405</td><td>Unknown endpoint / wrong method</td></tr><tr><td>413 / 415</td><td>Body too large / JSON Content-Type required</td></tr><tr><td>429</td><td>Rate limit reached; wait the Retry-After seconds</td></tr><tr><td>502</td><td>NEA failed, account could not be verified, or statement totals changed</td></tr><tr><td>503</td><td>Request limiting temporarily unavailable</td></tr></tbody></table><p>Public errors include <code>error</code>, <code>code</code> and <code>requestId</code>. The <code>X-Request-ID</code> response header identifies the request. A successful health response checks this API, not NEA\u2019s availability.</p></section><footer>Independent service, not an official NEA API. Results depend on NEA\u2019s public billing portal. Source: <a href=\"https://www.neabilling.com/viewonline/\">NEA billing</a>.</footer></main><script>\nconst base=location.origin;document.getElementById('base-url').textContent=base;document.getElementById('branches-example').textContent='curl '+base+'/api/v1/branches';const details={consumerId:'12345',scNo:'001.19.001',branch:'241',from:'2026-03-01',to:'2026-10-13'};document.getElementById('curl-example').textContent='curl '+base+'/api/v1/readings \\\\\\n  -H \"Content-Type: application/json\" \\\\\\n  --data '+\"'\"+JSON.stringify(details)+\"'\";document.getElementById('javascript-example').textContent='const response = await fetch(\"'+base+'/api/v1/readings\", {\\n  method: \"POST\",\\n  headers: { \"Content-Type\": \"application/json\" },\\n  body: JSON.stringify('+JSON.stringify(details,null,2)+')\\n});\\nconst data = await response.json();\\nif (!response.ok) throw new Error(data.error);\\nconsole.log(data.summary.months);';\n</script></body></html>\n";
```

## Source: worker.mjs

```javascript
import {api} from './api.mjs';
export default {fetch:api};
```

## Source: examples/frontend-client.mjs

```javascript
const endpoint=(baseUrl,path)=>baseUrl.replace(/\/$/,'')+'/api/v1/'+path;
export async function fetchNeaStatement(details,{signal,baseUrl=''}={}) {
  const response=await fetch(endpoint(baseUrl,'readings'),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(details),signal,credentials:'omit',
  });
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch the NEA statement.');
  return result;
}
export async function fetchNeaBranches({signal,baseUrl=''}={}) {
  const response=await fetch(endpoint(baseUrl,'branches'),{signal,credentials:'omit'});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch NEA branches.');
  return result.branches;
}
```

## Source: examples/node/server.mjs

```javascript
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {api} from '../../api.mjs';

const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const port=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost:'+port));
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];let size=0;
      for await(const chunk of req) {
        size+=chunk.length;
        if(size>4096) {
          res.writeHead(413,{'Content-Type':'application/json','Cache-Control':'no-store'});
          res.end(JSON.stringify({error:'Request too large.'}));return;
        }
        chunks.push(chunk);
      }
      const request=new Request(url,{method:req.method,headers:req.headers,
        ...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
      const response=await api(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(await response.text());return;
    }
    if(url.pathname!=='/' || !['GET','HEAD'].includes(req.method)) {
      res.writeHead(404);res.end('Not found');return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?'':html);
  } catch {
    res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Unexpected server error.'}));
  }
});
server.listen(port,'127.0.0.1',()=>console.log('NEA demo: http://localhost:'+port));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
```

## Source: examples/node/index.html

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEA Readings · Your electricity, in view</title><meta name="description" content="Look up NEA billed consumption and electricity statement history using your consumer ID, SC number and branch."><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#183438;background:#f4f7f5;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}a{color:#126759}header{background:#fff;border-bottom:1px solid #dde7e1;padding:22px 5vw;display:flex;justify-content:space-between;align-items:center}.brand{display:flex;gap:12px;align-items:center;font-weight:750;font-size:20px}.mark{background:#145d4e;color:#fff;border-radius:12px;width:40px;height:40px;display:grid;place-items:center;font-size:24px}.brand small{font-size:11px;font-weight:500;display:block;color:#778780;letter-spacing:1.2px;margin-top:3px}.header-note{font-size:12px;color:#60776b}.header-note:before{content:'●';color:#96ad68;margin-right:8px}main{max-width:1260px;margin:auto;padding:48px 36px 28px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#648671;font-weight:700}h1{font-size:clamp(30px,4vw,46px);font-weight:650;letter-spacing:-1.8px;margin:10px 0 12px}h1 span{color:#3e8769}.intro{color:#6a7c73;font-size:15px;line-height:1.7;max-width:650px;margin:0}.layout{display:grid;grid-template-columns:340px 1fr;gap:26px;margin-top:32px;align-items:start}.panel{background:#fff;border:1px solid #dfe8e2;border-radius:18px;padding:25px;box-shadow:0 4px 18px #17372b04}.panel h2{font-size:18px;margin:0 0 7px;letter-spacing:-.4px}.subtitle{font-size:12px;color:#78867e;line-height:1.7;margin:0 0 23px}.step{color:#4c866b;background:#eef4ee;border-radius:6px;padding:4px 7px;font-size:11px;margin-right:8px}label{display:block;font-size:12px;font-weight:650;margin:19px 0 8px}input,select{width:100%;border:1px solid #d6e1d9;background:#fbfcfa;border-radius:9px;padding:12px;color:#294b3b;min-height:45px;outline:none}input:focus,select:focus{border-color:#408b6b;box-shadow:0 0 0 3px #408b6b18}.hint{font-size:11px;color:#829086;line-height:1.6;margin-top:6px}.date-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.date-grid input{font-size:12px;padding:10px 7px}.primary{background:#185f4d;border:0;color:white;width:100%;border-radius:9px;padding:14px;font-size:13px;font-weight:650;margin-top:24px;cursor:pointer}.primary:hover{background:#0e4b3b}.primary:disabled{opacity:.6;cursor:wait}.quiet{background:none;border:0;color:#58846b;font-size:12px;cursor:pointer;padding:12px 0 0}.privacy{display:flex;gap:8px;font-size:11px;color:#819086;line-height:1.6;margin-top:20px;border-top:1px solid #eef2ee;padding-top:17px}.workspace{min-width:0}.empty{min-height:440px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:radial-gradient(ellipse at 50% 38%,#eaf3e9,transparent 55%),#fff}.empty-icon{width:76px;height:76px;border:1px solid #c9dccd;border-radius:24px;background:#f3f8f1;display:grid;place-items:center;margin-bottom:23px;color:#6a946f}.empty h2{font-size:22px}.empty p{font-size:13px;line-height:1.9;color:#7c8c80;max-width:330px;margin:6px 0 28px}.empty-tags{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.empty-tags span{font-size:10px;border:1px solid #e2e9e2;border-radius:20px;padding:7px 11px;color:#6c8371}.footnote{display:flex;justify-content:space-between;gap:16px;font-size:11px;color:#829185;padding:20px 4px;line-height:1.7}.footnote a{color:inherit}.error{background:#fff2e7;border:1px solid #f0ceb1;color:#8c4a28;border-radius:10px;padding:14px;font-size:13px;line-height:1.7;margin-bottom:16px}.error[hidden],[hidden]{display:none!important}.account{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:20px}.account h2{font-size:18px;margin:8px 0}.account p{font-size:12px;color:#809084;margin:0;line-height:1.7}.pill{border-radius:20px;font-size:10px;padding:7px 10px;background:#eaf4eb;color:#367650;white-space:nowrap}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.stat{border:1px solid #e0e8df;border-radius:12px;padding:18px 14px;background:#f9fbf7}.stat:first-child{background:#185f4d;color:#fff;border-color:#185f4d}.stat .label{font-size:10px;opacity:.7}.stat strong{font-size:25px;display:block;margin:10px 0 5px;letter-spacing:-1px}.stat small{font-size:10px;opacity:.65}.note{background:#f3f6ed;padding:12px 14px;border-radius:9px;font-size:11px;color:#6f7d5b;line-height:1.8;margin:15px 0}.chart{height:126px;display:flex;gap:16px;align-items:flex-end;margin-top:18px;padding:0 12px 20px;border-bottom:1px solid #e9eee7}.bar-col{flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0}.bar{width:100%;max-width:50px;background:#bfd4a0;border-radius:6px 6px 0 0;min-height:2px}.bar-col:last-child .bar{background:#428769}.bar-col span{font-size:9px;white-space:nowrap;color:#72836b;margin-top:8px}.bar-col b{font-size:10px;margin-bottom:5px;color:#526c51}.table-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:26px;margin-bottom:14px}.tabs{display:flex;gap:6px}.tabs button{padding:8px 10px;border:0;border-radius:7px;background:transparent;color:#768573;font-size:12px;cursor:pointer}.tabs button.active{background:#eaf2e7;color:#3f7052}.export{font-size:11px;border:1px solid #d7e1d5;color:#4a7055;background:white;border-radius:7px;padding:8px 10px;cursor:pointer}.scroll{overflow:auto;max-height:520px}table{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}th{text-align:left;background:#f6f8f3;color:#82917c;font-weight:500;font-size:10px;position:sticky;top:0}td,th{padding:13px 10px;border-bottom:1px solid #edf1e9}td{color:#4b624b}td .pill{font-size:9px;padding:4px 7px}.updated{font-size:10px;color:#8c9986;margin-top:17px}.guide{margin-top:18px;background:transparent;box-shadow:none;padding:22px 24px}.guide h3{font-size:12px;margin:0 0 8px}.guide p{font-size:11px;line-height:1.8;color:#7b8a7d;margin:0}.loader{display:inline-block;width:13px;height:13px;border:2px solid #ffffff66;border-top-color:white;border-radius:50%;animation:spin .8s linear infinite;margin-right:7px;vertical-align:middle}@keyframes spin{to{transform:rotate(360deg)}}footer{border-top:1px solid #dfe7df;font-size:10px;color:#8a9789;padding:20px 0;margin-top:25px;display:flex;justify-content:space-between;gap:15px}button:focus-visible,a:focus-visible{outline:3px solid #94b772;outline-offset:3px}@media(max-width:920px){.layout{grid-template-columns:290px 1fr;gap:18px}.panel{padding:20px}.stats{grid-template-columns:1fr}.stat strong{font-size:23px}.stat{padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.stat strong{margin:0 0 0 auto}.stat small{width:100%}}@media(max-width:680px){header{padding:18px 22px}.header-note{display:none}main{padding:32px 20px}.layout{grid-template-columns:1fr}.empty{min-height:330px}.stats{grid-template-columns:repeat(3,1fr);gap:7px}.stat{display:block;padding:13px 9px}.stat strong{font-size:21px;margin:10px 0 5px}.account{flex-wrap:wrap}.footnote,footer{flex-direction:column}h1{letter-spacing:-1px}.chart{gap:7px}}@media(prefers-reduced-motion:reduce){.loader{animation:none}}
.breakdown{display:grid;grid-template-columns:1fr 1fr;gap:22px;background:#fafcf8;border:1px solid #e0e8df;border-radius:12px;padding:20px;margin:20px 0}.breakdown dl,.totals dl{margin:0}.breakdown dl div,.totals dl div{display:flex;justify-content:space-between;gap:15px;padding:7px 0;font-size:12px}.breakdown dt,.totals dt{color:#75836d}.breakdown dd,.totals dd{margin:0;text-align:right}.breakdown .grand{font-weight:750;border-top:1px solid #dde6d8;margin-top:5px;padding-top:12px}.totals{margin-top:20px;padding:18px;border:1px solid #dce6d7;border-radius:10px}.rules{margin-top:24px}.rules summary{cursor:pointer;font-size:13px;font-weight:650;padding:10px 0}.rules p{font-size:12px;color:#73816d;line-height:1.8}.rules table{margin:12px 0}.month-label{margin-top:0}.statement-label{font-size:11px;color:#73816d;line-height:1.7}.receipt-difference{color:#8c4a28}.tabs{flex-wrap:wrap}.export{white-space:nowrap}@media(max-width:680px){.breakdown{grid-template-columns:1fr}.table-head{align-items:start}.breakdown dl div,.totals dl div{font-size:11px}} </style></head><body><header><div class="brand"><div class="mark" aria-hidden="true">ϟ</div><div>NEA Readings<small>ELECTRICITY, IN VIEW</small></div></div><div class="header-note">Independent tool · NEA billing data</div></header><main><div class="eyebrow">Your connection. Your consumption.</div><h1>A clearer view of <span>your electricity.</span></h1><p class="intro">Find billed consumption and statement history in one place.<br>Use the consumer details printed on your NEA bill.</p><div class="layout"><aside><section class="panel"><h2><span class="step">01</span>Find your connection</h2><p class="subtitle">Three details from your bill. No login needed.</p><form id="lookup"><label for="consumer">Consumer ID</label><input id="consumer" name="consumerId" required inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20" placeholder="e.g. 12345" value=""><label for="sc">SC number</label><input id="sc" name="scNo" required maxlength="40" placeholder="e.g. 001.19.001" value=""><div class="hint">Service connection number, including the dots.<br>This is the SC No. on your bill, not the meter serial.</div><div id="reading-schedule" class="hint"></div><label for="branch">Branch / distribution centre</label><select id="branch" name="branch" required><option value="241">Damauli DC</option></select><div class="hint" id="branch-status">Loading NEA’s current branch list…</div><div class="date-grid"><div><label for="from">From date · AD</label><input id="from" name="from" type="date" required></div><div><label for="to">To date · AD</label><input id="to" name="to" type="date" required></div></div><button id="submit" class="primary" type="submit">Fetch statement <span aria-hidden="true">↗</span></button><button id="pdf-range" class="quiet" type="button">Use sample range: 1 Mar–13 Oct 2026</button><br><button id="reset" class="quiet" type="button">Clear details</button></form><div class="privacy"><span aria-hidden="true">♧</span><span>Your details are sent to NEA for this lookup.<br>This app does not save your account or statement.</span></div></section><section class="panel guide"><h3>What can I see?</h3><p>Monthly billed units, bill amounts and payment records. Cumulative meter readings are not exposed by NEA’s public billing portal.</p></section></aside><div class="workspace"><div id="error" class="error" role="alert" hidden></div><section id="empty" class="panel empty"><div class="empty-icon" aria-hidden="true"><svg width="38" height="38" viewBox="0 0 40 40" fill="none"><rect x="8" y="4" width="24" height="32" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M13 11h14v9H13zM14 27h2m4 0h2m4 0h2" stroke="currentColor" stroke-width="1.5"/><path d="m21 12-4 5h5l-3 4" stroke="currentColor"/></svg></div><h2>Your statement starts here</h2><p>Enter your connection details and select a date range to fetch your records from NEA.</p><div class="empty-tags"><span>Billed consumption</span><span>Bill history</span><span>Payment records</span></div></section><section id="result" class="panel" hidden aria-live="polite"><div class="account"><div><div class="eyebrow">Connection overview</div><h2 id="account-name"></h2><p id="account-details"></p></div><span class="pill">Fetched from NEA</span></div><div class="stats"><div class="stat"><div class="label">LATEST CONSUMED UNITS · kWh</div><strong id="units">—</strong><small id="units-period"></small></div><div class="stat"><div class="label">LATEST TOTAL PAYABLE · NPR</div><strong id="bill">—</strong><small id="bill-period"></small></div><div class="stat"><div class="label">MONTHLY BILLS</div><strong id="count">—</strong><small>In the selected range</small></div></div><div id="availability" class="note"></div><label for="month" class="month-label">Monthly breakdown · units &amp; NPR</label><select id="month"></select><div id="breakdown" class="breakdown"></div><div id="consumption-overview" class="totals"></div><div id="chart" class="chart" role="img" aria-label="Billed consumption by month" hidden></div><div class="table-head"><div class="tabs" role="group" aria-label="Statement view"><button type="button" id="bills-tab" class="active" aria-pressed="true">Monthly bills</button><button type="button" id="payments-tab" aria-pressed="false">Payments</button><button type="button" id="source-tab" aria-pressed="false">NEA source rows</button></div><button type="button" id="export" class="export">↓ Export CSV</button></div><div class="scroll"><table><thead id="table-head"></thead><tbody id="rows"></tbody></table></div><div id="totals" class="totals"></div><details class="rules"><summary>Reading schedule, VAT, rebates &amp; late charges</summary><p id="schedule-guide"></p><p>Regular customers: 2% rebate within 7 days of meter reading; no rebate or fine on days 8–15; 5% surcharge on days 16–30, 10% on days 31–40, and 25% after day 40. Non-payment through day 60 can lead to disconnection. Special categories and supplementary bills have different rules. <a href="https://www.nea.org.np/uploads/shares/publication/51207195.pdf" target="_blank" rel="noopener">NEA collection regulations, sections 7–10</a>.</p><p>The 2083 VAT guideline took effect on 1 Shrawan 2083: non-household supply is generally taxed at 13%; household consumption up to 50 units is exempt, with 5% on the taxable consumption above that threshold. The portal does not report account category or taxable base. VAT here is always NEA’s recorded VAT, not a computed 13% addition. <a href="https://ird.gov.np/content/13581/guidelines-for-/" target="_blank" rel="noopener">IRD electricity VAT guideline</a>.</p><p>Base bills may include energy, minimum/service and demand charges, depending on the tariff category. This statement does not separate those amounts. NEA’s published schedule lists NPR 250 for disconnection and NPR 500 for reconnection; these are separate service charges, not amounts automatically added by this app. <a href="https://www.nea.org.np/uploads/shares/Tarrif_rates/Consumer_Tarrif_data.pdf" target="_blank" rel="noopener">NEA tariff and service charges</a>.</p></details><p id="updated" class="updated"></p></section><div class="footnote"><span>Read-only lookup. Records depend on NEA’s latest updates.</span><a href="https://www.neabilling.com/viewonline/" target="_blank" rel="noopener">Open NEA billing portal ↗</a></div></div></div><footer><span><a href="/api/docs">Public API documentation ↗</a><br>NEA Readings · An independent tool, not affiliated with Nepal Electricity Authority.</span><span>Source: NEA Computerized Billing and Network Division</span></footer></main><script>
const $=id=>document.getElementById(id);let data=null,view='monthly';const nf=new Intl.NumberFormat('en-NP',{maximumFractionDigits:2});const fmt=n=>n===null||n===undefined?'Not available':nf.format(n);function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}const now=new Date(),lastYear=new Date(now);lastYear.setFullYear(now.getFullYear()-1);$('to').value=iso(now);$('from').value=iso(lastYear);
async function readJson(response){const j=await response.json();if(!response.ok)throw Error(j.error||'Lookup failed. Please try again.');return j}
fetch('/api/branches').then(readJson).then(j=>{const selected=$('branch').value;$('branch').replaceChildren(...j.branches.map(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=b.label;return o}));$('branch').value=selected;$('branch-status').textContent=j.branches.length+' branches from NEA’s billing portal.'}).catch(()=>{$('branch-status').textContent='Branch list unavailable. Damauli DC is available; refresh to retry.'});
function showSchedule(){const day=$('sc').value.match(/^\d+[.\/-](\d{1,2})[.\/-]/)?.[1];$('reading-schedule').textContent=day&&Number(day)>0&&Number(day)<=32?'Expected reading: '+Number(day)+'th of each Nepali month. Actual bill dates take precedence.':''}showSchedule();$('sc').addEventListener('input',showSchedule);$('pdf-range').onclick=()=>{$('from').value='2026-03-01';$('to').value='2026-10-13'};
function drawRows(){const records=view==='monthly'?data.summary.months:view==='payment'?data.records.filter(r=>r.kind==='payment'):data.records;const headers=view==='monthly'?['Period · BS','Bill date · AD','Consumed units · kWh','Base · NPR','Adjustment · NPR','VAT payable · NPR','Other · NPR','Total payable · NPR','Status']:view==='payment'?['Paid date · AD','Paid · NPR','Transaction ID']:['SNo','Status','Due bill of','Bill date · AD','Consumed units · kWh','Bill amount · NPR','Rebate / penalty','Rate %','Payable · NPR','Paid · NPR','Merchant','Transaction ID','Paid date · AD'];$('table-head').replaceChildren();const tr=document.createElement('tr');headers.forEach(h=>{const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th)});$('table-head').append(tr);$('rows').replaceChildren();records.forEach(r=>{const tr=document.createElement('tr');const values=view==='monthly'?[r.period,r.billDate||'—',r.consumedUnits===null?'Not reported by NEA':fmt(r.consumedUnits),fmt(r.baseAmount),(r.adjustmentAmount>0?'+':'')+fmt(r.adjustmentAmount)+(r.adjustmentRate?' ('+r.adjustmentRate+'%)':''),r.vatPresent?fmt(r.vatPayable):'None recorded',fmt(r.otherCharges),fmt(r.totalPayable),r.status]:view==='payment'?[r.paidDate||'—',fmt(r.paidAmount),r.transactionId||'—']:[r.sequence,r.status,r.period||'—',r.billDate||'—',r.consumedUnits===null?'—':fmt(r.consumedUnits),fmt(r.billAmount),r.adjustment||'—',fmt(r.rate),fmt(r.payableAmount),r.paidAmount===null?'—':fmt(r.paidAmount),r.merchant||'—',r.transactionId||'—',r.paidDate||'—'];values.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});$('rows').append(tr)});if(!records.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='No records returned for this date range.';tr.append(td);$('rows').append(tr)}[['bills','monthly'],['payments','payment'],['source','source']].forEach(([t,k])=>{const active=view===k;$(t+'-tab').classList.toggle('active',active);$(t+'-tab').setAttribute('aria-pressed',active)})}
function dl(container,items){const list=document.createElement('dl');items.forEach(([label,value,grand])=>{const row=document.createElement('div');if(grand)row.className='grand';const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);list.append(row)});container.append(list)}
function monthBreakdown(){const m=data.summary.months[Number($('month').value)];$('breakdown').replaceChildren();if(!m){$('breakdown').textContent='No monthly bills returned.';return}dl($('breakdown'),[['Consumed units · kWh',m.consumedUnits===null?'Not reported by NEA':fmt(m.consumedUnits)],['Base bill',fmt(m.baseAmount)],[m.adjustment==='PENALTY'?'Penalty ('+m.adjustmentRate+'%)':m.adjustment==='REBATE'?'Rebate ('+m.adjustmentRate+'%)':'Adjustment',(m.adjustmentAmount>0?'+':'')+fmt(m.adjustmentAmount)],['Base after adjustment',fmt(m.adjustedBaseAmount)],['VAT billed',m.vatPresent?fmt(m.vatAmount):'None recorded'],['VAT payable',m.vatPresent?fmt(m.vatPayable):'None recorded'],['Other / arrears payable',fmt(m.otherCharges)],['Total payable',fmt(m.totalPayable),true]]);const right=document.createElement('div');dl(right,[['Bill date · AD',m.billDate||'—'],['Paid date · AD',m.paidDate||'—'],['Receipt paid',m.paidAmount===null?'Not uniquely allocated':fmt(m.paidAmount)],['Paid minus payable',m.paymentDifference===null?'Not uniquely allocated':fmt(m.paymentDifference)],['Statement status',m.status]]);const note=document.createElement('p');note.className='statement-label';note.textContent='Source rows '+m.sourceSequences.join(', ')+(m.receiptSequence?' · receipt row '+m.receiptSequence:'')+'. '+(m.vatPresent?'VAT billed and VAT payable differ because NEA supplies separate decimal and rounded amounts. ':'')+'Rebate/penalty amounts use the difference recorded by NEA, including rounding. A receipt covering several months is not allocated to one month.';right.append(note);$('breakdown').append(right)}
$('month').addEventListener('change',monthBreakdown);
function render(){const summary=data.summary,monthly=summary.months,latest=monthly.at(-1);$('account-name').textContent=data.account.name||'Your NEA connection';$('account-details').textContent=data.account.location+' · Consumer '+data.account.consumerId+' · SC '+data.account.scNo;$('units').textContent=latest&&latest.consumedUnits!==null?fmt(latest.consumedUnits):'—';$('units-period').textContent=latest?latest.period+(latest.consumedUnits===null?' · Not reported by NEA':''):'No monthly bill returned';$('bill').textContent=latest?fmt(latest.totalPayable):'—';$('bill-period').textContent=latest?latest.period+' · '+latest.status+' · Includes linked VAT & charges':'No monthly bill returned';$('count').textContent=monthly.length;const missing=monthly.filter(r=>r.consumedUnits===null).length;$('availability').textContent='Units are billed consumption, not cumulative meter readings.'+(missing?' NEA leaves units blank for '+missing+' monthly bill(s).':'')+' Monthly totals include VAT/arrears only where the transaction identifies one month.'+(summary.unallocatedCharges.length?' '+summary.unallocatedCharges.length+' extra charge row(s) cannot be uniquely allocated; inspect source rows.':'');$('month').replaceChildren(...monthly.map((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m.period+' · '+(m.billDate||'No bill date');return o}));$('month').value=monthly.length-1;monthBreakdown();const consumption=summary.consumption;$('consumption-overview').replaceChildren();const consumptionTitle=document.createElement('h2');consumptionTitle.textContent='Consumed units reported by NEA';$('consumption-overview').append(consumptionTitle);dl($('consumption-overview'),[['Total reported consumption · kWh',fmt(consumption.totalReportedUnits)],['Monthly bills with consumed units',consumption.reportedMonthlyBills+' of '+monthly.length],['First reported month in this range',consumption.firstReportedPeriod||'Not reported by NEA']]);const consumptionNote=document.createElement('p');consumptionNote.className='statement-label';consumptionNote.textContent=consumption.complete?'All monthly bills in this range report consumed units.':consumption.missingMonthlyBills?'NEA did not report consumed units for '+consumption.missingMonthlyBills+' earlier or other monthly bill(s) in this range. The total includes reported monthly units only; missing values are not counted as zero.':'No monthly bills returned for this range.';$('consumption-overview').append(consumptionNote);const unitRows=monthly.filter(r=>r.consumedUnits!==null).slice(-6);$('chart').hidden=!unitRows.length;$('chart').replaceChildren();if(unitRows.length){const max=Math.max(1,...unitRows.map(r=>r.consumedUnits));unitRows.forEach(r=>{const col=document.createElement('div');col.className='bar-col';const b=document.createElement('b');b.textContent=fmt(r.consumedUnits);const bar=document.createElement('div');bar.className='bar';bar.style.height=(r.consumedUnits/max*76)+'px';const span=document.createElement('span');span.textContent=r.period.split('/')[0];col.append(b,bar,span);$('chart').append(col)});$('chart').setAttribute('aria-label',unitRows.map(r=>r.period+': '+r.consumedUnits+' units').join('; '))}$('totals').replaceChildren();const title=document.createElement('h2');title.textContent='Statement reconciliation · NPR';$('totals').append(title);dl($('totals'),[['Total billed (including VAT & arrears)',fmt(summary.totals.billAmount)],['Total payable after adjustments',fmt(summary.totals.payableAmount)],['Total paid (receipts counted once)',fmt(summary.totals.paidAmount)],['Paid minus payable',fmt(summary.paidDifference)]]);const note=document.createElement('p');note.className='statement-label';const checkedSections=(summary.statementGroups||[]).filter(g=>g.sourceTotals);note.textContent=(checkedSections.length?'Parsed rows reconcile with '+checkedSections.length+' NEA section subtotal(s). Advance/balance information is excluded from billed and paid totals.':summary.sourceTotals?'Transaction totals match NEA’s billing TOTAL row.':'NEA did not supply control totals; totals are calculated from returned transactions.')+(summary.paidDifference?' The paid/payable difference is present in NEA’s records; it is not automatically treated as credit, a fee or an unpaid balance.':'');$('totals').append(note);if(summary.balanceRecords?.length){const balanceTitle=document.createElement('h3');balanceTitle.textContent='NEA advance / balance information';$('totals').append(balanceTitle);dl($('totals'),summary.balanceRecords.map(r=>[r.period||r.status,fmt(r.billAmount)]));const balanceNote=document.createElement('p');balanceNote.className='statement-label';balanceNote.textContent='These are NEA’s reported balance rows, not additional monthly bills or payment receipts. The original section totals remain available in the API and all rows in the source view.';$('totals').append(balanceNote);}$('schedule-guide').textContent=summary.scheduledReadingDay?'SC reading group '+summary.scheduledReadingDay+': expected reading on the '+summary.scheduledReadingDay+'th of each Nepali month. Use the actual meter-reading/bill date for payment windows; statement bill dates and the date filter are Gregorian (AD), while bill periods are Nepali (BS).':'Use the actual meter-reading/bill date for payment windows. Bill periods use BS; statement dates and date filters use AD.';$('updated').textContent='Fetched '+new Date(data.fetchedAt).toLocaleString()+' · '+data.range.from+' to '+data.range.to+' (AD) · '+data.records.length+' source rows';$('result').hidden=false;$('empty').hidden=true;drawRows()}
$('lookup').addEventListener('submit',async e=>{e.preventDefault();$('error').hidden=true;$('result').hidden=true;$('empty').hidden=false;data=null;if($('from').value>$('to').value){$('error').textContent='From date must come before to date.';$('error').hidden=false;return;}const b=$('submit');b.disabled=true;b.innerHTML='<span class="loader" aria-hidden="true"></span>Fetching from NEA…';$('empty').setAttribute('aria-busy','true');try{data=await fetch('/api/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}).then(readJson);view='monthly';render()}catch(err){$('error').textContent=err.message;$('error').hidden=false}finally{b.disabled=false;b.textContent='Fetch statement ↗';$('empty').setAttribute('aria-busy','false')}});
$('reset').onclick=()=>{data=null;$('consumer').value='';$('sc').value='';$('result').hidden=true;$('empty').hidden=false;$('error').hidden=true;showSchedule();$('consumer').focus()};$('bills-tab').onclick=()=>{view='monthly';drawRows()};$('payments-tab').onclick=()=>{view='payment';drawRows()};$('source-tab').onclick=()=>{view='source';drawRows()};$('export').onclick=()=>{if(!data)return;const fields=['sequence','statementGroup','kind','category','period','billDate','consumedUnits','billAmount','adjustment','rate','payableAmount','status','paidAmount','merchant','transactionId','paidDate'];const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const csv=[fields.join(','),...data.records.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='nea-statement-'+data.range.from+'-'+data.range.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
</script></body></html>
```

## Source: examples/nextjs/app/api/readings/route.js

```javascript
import {api} from '../../../lib/nea/api.mjs';
export const runtime='nodejs';
export async function POST(request) {
  // Apply your existing login and connection-ownership checks before calling api.
  return api(request);
}
```

## Source: examples/nextjs/app/api/branches/route.js

```javascript
import {api} from '../../../lib/nea/api.mjs';
export const runtime='nodejs';
export async function GET(request) {
  return api(request);
}
```

## Source: examples/nextjs/app/api/v1/[...segments]/route.js

```javascript
import {api} from '../../../../lib/nea/api.mjs';
export const runtime='nodejs';
export const GET=request=>api(request);
export const POST=request=>api(request);
export const OPTIONS=request=>api(request);
```

## Source: examples/nextjs/app/api/docs/route.js

```javascript
import {api} from '../../../lib/nea/api.mjs';
export const runtime='nodejs';
export const GET=request=>api(request);
```

## Source: examples/express/server.mjs

```javascript
// Optional local example: npm install express before running this file.
import express from 'express';
import {api} from '../../api.mjs';
const app=express();
app.use('/api',express.raw({type:()=>true,limit:'4kb'}),async(req,res)=>{
 try {
  const url=new URL(req.originalUrl,req.protocol+'://'+req.get('host'));
  const request=new Request(url,{method:req.method,headers:req.headers,
   ...(['GET','HEAD'].includes(req.method)?{}:{body:req.body})});
  const response=await api(request);
  res.status(response.status).set(Object.fromEntries(response.headers)).send(await response.text());
 }catch{res.status(500).json({error:'Unexpected server error.'});}
});
app.use((error,req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.originalUrl.startsWith('/api/v1/'))res.setHeader('Access-Control-Allow-Origin','*');
 if(error.type==='entity.too.large')return res.status(413).json({error:'Request too large.'});
 res.status(500).json({error:'Unexpected server error.'});
});
app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('NEA Express example running on localhost'));
```

## Source: scripts/live-check.mjs

```javascript
import {lookup,validate} from '../adapter.mjs';
let raw='';
for await (const chunk of process.stdin) {raw+=chunk;if(raw.length>4096)throw new Error('Request too large.');}
if(!raw.trim())throw new Error('Provide an authorized connection request as JSON on stdin. See README.');
const data=await lookup(validate(JSON.parse(raw)));
console.log(JSON.stringify({sourceRows:data.records.length,monthlyBills:data.summary.months.length,totals:data.summary.totals,sourceTotals:data.summary.sourceTotals,paidDifference:data.summary.paidDifference},null,2));
```

## Source: tests.mjs

```javascript
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseStatement,validate,branches} from './adapter.mjs';import {api} from './api.mjs';
const input={consumerId:'12345',scNo:'001.19.001',branch:'241',from:'2025-10-13',to:'2026-10-13'};
const detail='<td>Customer Name</td><td>Example</td><td>SC No</td><td>001.19.001</td><td>NEA Location</td><td>TANAHU DC</td><td>Consumer Id</td><td>12345</td>';
const row=values=>'<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
const fixture='<table>'+detail+'<th>CONSUMED UNITS</th>'+row(['1','PAID','Bhadra/2083','04-SEP-26','','81786','REBATE','2','80151','','KHALTI','txn','9/9/2026'])+row(['2','PAID','','','','0','','0','0','91431','','txn','9/9/2026'])+row(['3','PAID','Ashwin/2083','05-OCT-26','11282','82771','REBATE','2','81116','','KHALTI','txn2','10/11/2026'])+'</table>';
test('Preserves missing units, distinguishes receipts, parses monthly consumption',()=>{const j=parseStatement(fixture,input);assert.equal(j.records.length,3);assert.equal(j.records[0].consumedUnits,null);assert.equal(j.records[1].kind,'payment');assert.equal(j.records[2].consumedUnits,11282);assert.equal(j.account.location,'TANAHU DC');assert.equal(j.readingAvailability.currentReading,false)});
test('Rejects mismatched accounts and unexpected statement format',()=>{assert.throws(()=>parseStatement(fixture.replaceAll('12345','999'),input),/different account/);assert.throws(()=>parseStatement('<html>unavailable</html>',input),/matching account/);assert.throws(()=>parseStatement(fixture.replace('CONSUMED UNITS','changed'),input),/format/)});
test('Validates actual calendar dates and date order',()=>{assert.deepEqual(validate(input),input);assert.throws(()=>validate({...input,from:'2026-02-30'}));assert.throws(()=>validate({...input,from:'2027-01-01'}));assert.throws(()=>validate({...input,consumerId:'abc'}))});
test('Reads branch IDs from NEA form',()=>{assert.deepEqual(branches('<select name="NEA_location"><option value="">Select</option><option value="241">DAMAULI</option></select>'),[{id:'241',name:'DAMAULI',label:'Damauli DC'}])});
test('Rejects invalid JSON and foreign origins before calling NEA',async()=>{assert.equal((await api(new Request('https://example.com/api/readings',{method:'POST',body:'invalid'}))).status,400);assert.equal((await api(new Request('https://example.com/api/readings',{method:'POST',headers:{Origin:'https://foreign.test'},body:'{}'}))).status,403)});
import {analyze} from './statement.mjs';
const component=(sequence,category,overrides={})=>({sequence,category,kind:category==='receipt'?'payment':'bill',period:category==='monthly'?'Ashwin/2083':category==='vat'?'VAT':null,billDate:category==='monthly'?'05-OCT-26':null,consumedUnits:category==='monthly'?11282:category==='vat'?0:null,billAmount:category==='monthly'?82771:category==='vat'?10760.36:0,payableAmount:category==='monthly'?81116:category==='vat'?10761:0,paidAmount:category==='receipt'?91877:null,transactionId:'test-receipt',paidDate:'10/11/2026 4:18:36 PM',status:'PAID',adjustment:category==='monthly'?'REBATE':null,rate:category==='monthly'?2:0,...overrides});
test('Monthly payable includes recorded VAT and rounded rebate, counts receipt once',()=>{const a=analyze([component(1,'receipt'),component(2,'monthly'),component(3,'vat')],null,input.scNo);const m=a.months[0];assert.equal(m.totalPayable,91877);assert.equal(m.vatAmount,10760.36);assert.equal(m.vatPayable,10761);assert.equal(m.adjustmentAmount,-1655);assert.equal(a.totals.paidAmount,91877);assert.equal(a.scheduledReadingDay,19);assert.equal(m.billDateISO,'2026-10-05');assert.deepEqual(m.sourceSequences,[2,3])});
test('Shared receipts never duplicate paid money or guess VAT allocation',()=>{const a=analyze([component(1,'receipt'),component(2,'monthly'),component(3,'monthly',{period:'Bhadra/2083'}),component(4,'vat')],null,input.scNo);assert.equal(a.months[0].paidAmount,null);assert.equal(a.months[1].paidAmount,null);assert.equal(a.unallocatedCharges.length,1);assert.equal(a.totals.paidAmount,91877)});
test('Reconciliation preserves discrepancies instead of inventing balances',()=>{const a=analyze([component(1,'receipt',{paidAmount:95244.35}),component(2,'monthly',{billAmount:85805,payableAmount:84089}),component(3,'vat',{billAmount:11153.73,payableAmount:11154})],null,input.scNo);assert.equal(a.months[0].totalPayable,95243);assert.equal(a.months[0].paymentDifference,1.35);assert.equal(a.paidDifference,1.35)});
test('Reads NEA TOTAL row and rejects incomplete financial data',()=>{const total=row(['','PAID','','TOTAL','','164557','','','161267','91431','','','']);const f=fixture.replace('</table>',total+'</table>');assert.equal(parseStatement(f,input).summary.totals.payableAmount,161267);assert.throws(()=>parseStatement(f.replace('164557','164558'),input),/reconcile/)});
test('Consumption totals include monthly units and exclude VAT zeros and missing months',()=>{const a=analyze([component(1,'monthly',{period:'Ashad/2083',billDate:'03-JUL-26',consumedUnits:null}),component(2,'monthly',{period:'Shrawan/2083',billDate:'04-AUG-26',consumedUnits:11655}),component(3,'monthly',{period:'Bhadra/2083',billDate:'04-SEP-26',consumedUnits:11974}),component(4,'monthly',{period:'Ashwin/2083',billDate:'05-OCT-26',consumedUnits:11282}),component(5,'vat',{consumedUnits:0})],null,input.scNo);assert.deepEqual(a.consumption,{totalReportedUnits:34911,reportedMonthlyBills:3,missingMonthlyBills:1,firstReportedPeriod:'Shrawan/2083',lastReportedPeriod:'Ashwin/2083',complete:false})});
test('An actual zero-consumption month is reported; absent consumption stays unavailable',()=>{const zero=analyze([component(1,'monthly',{consumedUnits:0})],null,input.scNo);assert.equal(zero.consumption.totalReportedUnits,0);assert.equal(zero.consumption.reportedMonthlyBills,1);assert.equal(zero.consumption.complete,true);const missing=analyze([component(1,'monthly',{consumedUnits:null}),component(2,'vat',{consumedUnits:0})],null,input.scNo);assert.equal(missing.consumption.totalReportedUnits,null);assert.equal(missing.consumption.firstReportedPeriod,null);assert.equal(missing.consumption.reportedMonthlyBills,0);assert.equal(missing.consumption.complete,false)});
test('Public API allows cross-origin preflight and exposes structured validation errors',async()=>{const preflight=await api(new Request('https://example.com/api/v1/readings',{method:'OPTIONS',headers:{Origin:'https://another-app.test','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'*');const bad=await api(new Request('https://example.com/api/v1/readings',{method:'POST',headers:{Origin:'https://another-app.test','Content-Type':'application/json'},body:'{}'}));assert.equal(bad.status,400);assert.equal(bad.headers.get('Access-Control-Allow-Origin'),'*');const error=await bad.json();assert.equal(error.code,'INVALID_REQUEST');assert.equal(error.requestId,bad.headers.get('X-Request-ID'))});
test('Public API rejects wrong methods, media types and oversized bodies',async()=>{const wrong=await api(new Request('https://example.com/api/v1/readings'));assert.equal(wrong.status,405);assert.match(wrong.headers.get('Allow'),/POST/);const media=await api(new Request('https://example.com/api/v1/readings',{method:'POST',body:'{}'}));assert.equal(media.status,415);const large=await api(new Request('https://example.com/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(4097)}));assert.equal(large.status,413);assert.equal((await large.json()).code,'REQUEST_TOO_LARGE')});
test('Public rate limits stop upstream requests; aliases share the same client key',async()=>{const keys=[];const limiter={limit:async({key})=>{keys.push(key);return {success:false}}};for(const path of ['/api/v1/branches','/api/branches']){const r=await api(new Request('https://example.com'+path,{headers:{'CF-Connecting-IP':'192.0.2.1'}}),{API_RATE_LIMITER:limiter});assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');}assert.equal(keys[0],keys[1]);const missing=await api(new Request('https://example.com/api/v1/branches'),{REQUIRE_API_RATE_LIMIT:'true'});assert.equal(missing.status,503)});
test('Documentation, health and OpenAPI work without NEA or rate-limit capacity',async()=>{const env={REQUIRE_API_RATE_LIMIT:'true',API_RATE_LIMITER:{limit:async()=>{throw Error('should not be called')}}};const health=await api(new Request('https://example.com/api/v1/health'),env);assert.equal(health.status,200);const spec=await api(new Request('https://example.com/api/v1/openapi.json'),env);const j=await spec.json();assert.equal(j.openapi,'3.1.0');assert.ok(j.paths['/api/v1/readings'].post);assert.deepEqual(j.security,[]);const docs=await api(new Request('https://example.com/api/docs'),env);assert.equal(docs.status,200);assert.match(docs.headers.get('Content-Type'),/text\/html/)});
test('Public lookup verifies account and returns consumption with CORS using NEA HTML',async()=>{const original=globalThis.fetch;let upstreamCalls=0;globalThis.fetch=async(url,options)=>{upstreamCalls++;assert.match(String(url),/viewonline\/viewonlineresult\/$/);assert.equal(options.body.get('consumer_id'),input.consumerId);return new Response(fixture)};try{const r=await api(new Request('https://example.com/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://another-app.test'},body:JSON.stringify(input)}),{API_RATE_LIMITER:{limit:async()=>({success:true})}});assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');const j=await r.json();assert.equal(j.apiVersion,'1');assert.equal(j.summary.consumption.totalReportedUnits,11282);assert.equal(j.account.consumerId,input.consumerId);assert.equal(upstreamCalls,1)}finally{globalThis.fetch=original}});
test('Public upstream failures return CORS-enabled 502 without claiming success',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('unavailable',{status:503});try{const r=await api(new Request('https://example.com/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(r.status,502);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.equal((await r.json()).code,'NEA_LOOKUP_FAILED')}finally{globalThis.fetch=original}});
test('Upstream tries the verified HTTPS alias for 522 using one shared deadline, but never retries access denials',async()=>{const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),signal:options.signal});return calls.length===1?new Response('timeout',{status:522}):new Response('NEA form')};try{const {upstream,SOURCE}=await import('./adapter.mjs');assert.equal(await upstream(SOURCE),'NEA form');assert.equal(calls[0].url,'https://neabilling.com/viewonline/');assert.equal(calls[1].url,'https://www.neabilling.com/viewonline/');assert.equal(calls[0].signal,calls[1].signal);let deniedCalls=0;globalThis.fetch=async()=>{deniedCalls++;return new Response('denied',{status:403})};await assert.rejects(upstream(SOURCE),/HTTP 403/);assert.equal(deniedCalls,1)}finally{globalThis.fetch=original}});
const subtotal=(status,bill,payable,paid)=>row(['',status,'','TOTAL','',bill,'','',payable,paid,'','','']);
const advanceRows=row(['4','PAY ADVANCE','ADVANCE','13-OCT-26','0','-1.4300','NO REBATE OR PENALTY','0','0','','','',''])+row(['5','PAY ADVANCE','PAID UPTO 2083-06','','0','0','NO REBATE OR PENALTY','0','0','','','','']);
const multiSectionFixture=fixture.replace('</table>',subtotal('PAID','164557','161267','91431')+advanceRows+subtotal('PAY ADVANCE','-1.4300','0','')+'</table>');
test('Multiple TOTAL rows reconcile separately; advance balances do not replace billing totals',()=>{const s=parseStatement(multiSectionFixture,input);assert.equal(s.records.length,5);assert.deepEqual(s.summary.totals,{billAmount:164557,payableAmount:161267,paidAmount:91431});assert.deepEqual(s.summary.sourceTotals,s.summary.totals);assert.equal(s.summary.statementGroups.length,2);assert.equal(s.summary.statementGroups[1].sourceTotals.billAmount,-1.43);assert.equal(s.summary.balanceRecords.length,2);assert.equal(s.summary.balanceRecords[0].kind,'balance');assert.equal(s.summary.consumption.totalReportedUnits,11282);assert.deepEqual(s.summary.sourceTotalMismatches,[])});
test('Genuine mismatches in either billing or advance subtotals still reject the statement',()=>{assert.throws(()=>parseStatement(multiSectionFixture.replace('<td>164557</td>','<td>164558</td>'),input),/reconcile/);assert.throws(()=>parseStatement(multiSectionFixture.replace('13-OCT-26</td><td>0</td><td>-1.4300','13-OCT-26</td><td>0</td><td>-2.4300'),input),/reconcile/)});
test('Four-decimal source amounts reconcile without premature per-row paisa rounding',()=>{const f='<table>'+detail+'<th>CONSUMED UNITS</th>'+row(['1','UNPAID','Ashwin/2083','05-OCT-26','1','10.0049','','0','10.0049','','','',''])+row(['2','UNPAID','VAT','','0','1.0001','','0','1.0001','','','',''])+subtotal('UNPAID','11.0050','11.0050','')+'</table>';const s=parseStatement(f,input);assert.equal(s.summary.totals.billAmount,11.005);assert.equal(s.summary.totals.payableAmount,11.005);assert.equal(s.summary.sourceTotals.paidAmount,null)});
test('Empty valid statements and multiple paid/unpaid sections retain their control totals',()=>{const empty='<table>'+detail+'<th>CONSUMED UNITS</th>'+subtotal('PAID','0','0','0')+'</table>';assert.equal(parseStatement(empty,input).records.length,0);const f='<table>'+detail+'<th>CONSUMED UNITS</th>'+row(['1','PAID','Bhadra/2083','04-SEP-26','2','100','','0','100','','','',''])+row(['2','PAID','','','','0','','0','0','100','','',''])+subtotal('PAID','100','100','100')+row(['1','UNPAID','Ashwin/2083','05-OCT-26','3','50','PENALTY','10','55','','','',''])+subtotal('UNPAID','50','55','')+'</table>';const s=parseStatement(f,input);assert.deepEqual(s.summary.totals,{billAmount:150,payableAmount:155,paidAmount:100});assert.deepEqual(s.summary.sourceTotals,s.summary.totals);assert.equal(s.records[2].statementGroup,2)});
test('Explicit paid receipt rows remain payments even under PAY ADVANCE status',()=>{const f='<table>'+detail+'<th>CONSUMED UNITS</th>'+row(['1','PAY ADVANCE','','','','0','','0','0','100','','',''])+subtotal('PAY ADVANCE','0','0','100')+'</table>';const s=parseStatement(f,input);assert.equal(s.records[0].kind,'payment');assert.equal(s.summary.totals.paidAmount,100);assert.equal(s.summary.balanceRecords.length,0)});
```
