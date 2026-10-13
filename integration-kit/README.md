# NEA integration kit

The three reusable modules are adapter.mjs (NEA request, validation and HTML parsing), statement.mjs (monthly views and reconciliation), and api.mjs (Web Request/Response endpoints). Copy them together into your backend. They have no third-party dependencies. Use Node 22+ or a compatible Worker runtime. Run npm test for the portable checks. worker.mjs is an optional minimal Worker entrypoint. This kit contains no Site identity, credentials, customer PDF or fetched customer statement.

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

api(request) recognizes GET /api/branches and POST /api/readings exactly. POST accepts the same JSON as the direct-use example. It returns account, records, summary, source, fetchedAt, range, readingAvailability and note.

For Next.js, place all three modules under lib/nea and create app/api/readings/route.js:

```js
import {api} from '../../../lib/nea/api.mjs';
export const runtime = 'nodejs';
export async function POST(request) {
  // Apply the project's authentication and connection-ownership check here.
  return api(request);
}
```

Create app/api/branches/route.js with the same import/runtime and `export async function GET(request) { return api(request); }`. If the project uses src/, place app and lib under src. If you rename the public endpoints, update the api handler's path checks or call adapter exports directly.

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

The parser strips HTML comments, extracts customer details, checks returned consumer ID and SC number against the input, requires the consumed-units header, and keeps source rows. Blank numbers stay null. The TOTAL row is a control total, not another bill. The small parser uses regexes tied to the observed HTML; a larger product can replace it with a DOM parser while preserving the account checks, null handling and totals reconciliation.

Category rules: empty period -> receipt; VAT -> vat; ARREARS -> arrears; period ending in /four-digit-year -> monthly; anything else -> other. kind is payment for receipt, bill otherwise. Preserve unknown categories for audit rather than dropping them.

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

- totals.billAmount sums bill component rows only
- totals.payableAmount sums bill component rows only
- totals.paidAmount sums receipt rows only
- sourceTotals stores NEA's TOTAL row
- paidDifference is paid minus payable, not an asserted outstanding balance/credit

The parser rejects disagreements with NEA's totals. The current implementation sums integer paisa and returns numbers, matching the verified statement. For future fractional-paisa records or audited imports retain original four-decimal strings and use decimal arithmetic or four-decimal integers.

## Verified regression case

For an owner-authorized development account and 2026-03-01 to 2026-10-13, the independently fetched HTML matched the uploaded official PDF: 20 source rows, 8 monthly bills, 8 receipts, and 5 monthly rows with missing units. Totals: billed 625809.93; payable 613963; paid 613964.35. Shrawan's receipt exceeded its component payable by 1.35. Ashwin: 11282 consumed units, base 82771, recorded rebate difference -1655, adjusted base 81116, VAT billed 10760.36, VAT payable 10761, total payable and paid 91877. These are historical regression values; fetch live rather than serving them as account data.

## Errors and limits

400 invalid input/JSON; 403 foreign browser origin; 413 oversized request; 502 upstream timeout/failure, missing or different account, changed format, or totals mismatch; 404 unknown route/method. Responses are no-store. Upstream timeout is 25 seconds. The application date-range limit is approximately three years, not a documented NEA restriction. Missing account and upstream failures are not currently distinguished by typed error codes; add those if your product needs separate UI states.

The origin check is not authentication. Add your project's login, connection ownership, request rate limits and import concurrency control for public use. Do not log consumer details or send them in URLs. Keep upstream destinations fixed. Render normalized strings as text, never inject NEA HTML into your frontend.

## Database imports

This adapter does not persist anything. For importing, use connections (owner, branch ID, consumer ID, SC number), import runs (connection, range, fetched time, parser version), source rows (import ID, sequence, source fields), and optional derived monthly views. Scope sequence to an import because it changes with date range. Do not use transaction ID as a source-row unique key: bills, VAT and receipts share it.

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

The Next.js example directory is a set of route templates, not a standalone Next.js project. Copy its app/api files into your existing app and copy the root adapter.mjs, statement.mjs and api.mjs into that app's lib/nea directory. Both the app and lib directories belong under src if your project uses src.

The Express example has an optional dependency. Install it only if choosing that example:

```bash
npm install express
npm run start:express
```

Stop the default demo first if you use the same port. The Express example provides API endpoints only; use your own frontend or the browser client functions. Its middleware differs from api.mjs: it relies on your application's access/CORS policy instead of the Web handler's origin check.

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

There are eleven portable tests, including monthly-consumption coverage and the distinction between missing values and actual zero consumption. Live upstream statements were also checked during development. The ZIP does not include the downloaded statements used by those original optional fixture tests. The test:live script accepts an authorized connection request on stdin, fetches its own response and reports parsed record counts and totals. A failing historical assertion can mean NEA changed its records, so investigate rather than hardcoding the expected amounts into the importer.

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
export const SOURCE = 'https://www.neabilling.com/viewonline/';
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
 const records=[];let sourceTotals=null;
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const c=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
  if(c.length===13&&c[3]==='TOTAL'){sourceTotals={billAmount:number(c[5]),payableAmount:number(c[8]),paidAmount:number(c[9])};continue;}
  if(c.length!==13 || !/^\d+$/.test(c[0])) continue;
  records.push({sequence:Number(c[0]),kind:c[2]?'bill':'payment',category:!c[2]?'receipt':/^VAT$/i.test(c[2])?'vat':/^ARREARS$/i.test(c[2])?'arrears':/\/\d{4}$/.test(c[2])?'monthly':'other',status:c[1],period:c[2]||null,billDate:c[3]||null,consumedUnits:number(c[4]),billAmount:number(c[5]),adjustment:c[6]||null,rate:number(c[7]),payableAmount:number(c[8]),paidAmount:number(c[9]),merchant:c[10]||null,transactionId:c[11]||null,paidDate:c[12]||null});
 }
 const summary=analyze(records,sourceTotals,account.scNo);
 if(summary.sourceTotalMismatches.length) throw new Error('NEA statement rows do not reconcile with its totals. Please retry or use the official portal.');
 return {account,records,summary,source:SOURCE,fetchedAt:new Date().toISOString(),range:{from:input.from,to:input.to},readingAvailability:{previousReading:false,currentReading:false,consumedUnits:summary.months.some(r=>r.consumedUnits!==null)},note:'NEA exposes billed consumed units, not cumulative meter readings. Blank upstream values are returned as null. VAT and arrears are separate bill rows; payment receipts are separate payment rows.'};
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
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});
 if(!response.ok) throw new Error('NEA service returned HTTP '+response.status+'. Please try again later.');
 const text=await response.text();
 if(text.length>3000000) throw new Error('NEA returned an unexpectedly large response. Choose a shorter range.');
 return text;
}
export async function lookup(input) {
 const body=new URLSearchParams({NEA_location:input.branch,sc_no:input.scNo,consumer_id:input.consumerId,Fromdatepicker:format(input.from),Todatepicker:format(input.to)});
 return parseStatement(await upstream(SOURCE+'viewonlineresult/',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'}}),input);
}
```

## Source: statement.mjs

```javascript
// Derived views preserve NEA rows. Never estimate VAT or allocate shared receipts.
const cents=n=>Math.round(n*100);
export const sumMoney=values=>values.some(n=>n===null)?null:values.reduce((s,n)=>s+cents(n),0)/100;
export function billISO(value) {
 const m=value?.match(/^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/i);if(!m)return null;
 const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2].toUpperCase())+1;if(!month)return null;
 const y=m[3].length===2?2000+Number(m[3]):Number(m[3]);const date=`${y}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 return new Date(date).toISOString().slice(0,10)===date?date:null;
}
const key=r=>r.transactionId&&r.paidDate?r.transactionId+'|'+r.paidDate:null;
export function analyze(records,sourceTotals,scNo) {
 const monthly=records.filter(r=>r.category==='monthly');
 const extras=records.filter(r=>r.kind==='bill'&&r.category!=='monthly');
 const transactions=new Map();
 for(const r of records){const k=key(r);if(k){if(!transactions.has(k))transactions.set(k,[]);transactions.get(k).push(r);}}
 const assigned=new Set();
 const months=monthly.map(r=>{
  const group=key(r)?transactions.get(key(r)):[];
  const uniqueMonth=group?.filter(x=>x.category==='monthly').length===1;
  const related=uniqueMonth?group.filter(x=>x.kind==='bill'&&x.category!=='monthly'):[];
  related.forEach(x=>assigned.add(x.sequence));
  const vat=related.filter(x=>x.category==='vat'),other=related.filter(x=>x.category!=='vat');
  const receipts=uniqueMonth?group.filter(x=>x.kind==='payment'):[];
  const adjustmentAmount=r.billAmount!==null&&r.payableAmount!==null?(cents(r.payableAmount)-cents(r.billAmount))/100:null;
  const totalPayable=sumMoney([r.payableAmount,...related.map(x=>x.payableAmount)]);
  const paid=receipts.length===1?receipts[0].paidAmount:null;
  return {sequence:r.sequence,period:r.period,billDate:r.billDate,billDateISO:billISO(r.billDate),consumedUnits:r.consumedUnits,baseAmount:r.billAmount,adjustment:r.adjustment,adjustmentRate:r.rate,adjustmentAmount,adjustedBaseAmount:r.payableAmount,vatAmount:sumMoney(vat.map(x=>x.billAmount)),vatPayable:sumMoney(vat.map(x=>x.payableAmount)),vatPresent:vat.length>0,otherCharges:sumMoney(other.map(x=>x.payableAmount)),totalPayable,paidAmount:paid,paymentDifference:paid!==null&&totalPayable!==null?(cents(paid)-cents(totalPayable))/100:null,status:r.status,transactionId:r.transactionId,paidDate:r.paidDate,sourceSequences:[r.sequence,...related.map(x=>x.sequence)],receiptSequence:receipts.length===1?receipts[0].sequence:null,association:uniqueMonth?'single-month transaction':'monthly row only; no unique transaction allocation'};
 }).sort((a,b)=>(a.billDateISO??'').localeCompare(b.billDateISO??'')||a.sequence-b.sequence);
 const totals={billAmount:sumMoney(records.filter(r=>r.kind==='bill').map(r=>r.billAmount)),payableAmount:sumMoney(records.filter(r=>r.kind==='bill').map(r=>r.payableAmount)),paidAmount:sumMoney(records.filter(r=>r.kind==='payment').map(r=>r.paidAmount))};
 const mismatches=sourceTotals?Object.keys(totals).filter(k=>sourceTotals[k]!==null&&(totals[k]===null||cents(totals[k])!==cents(sourceTotals[k]))):[];
 const paidDifference=totals.paidAmount!==null&&totals.payableAmount!==null?(cents(totals.paidAmount)-cents(totals.payableAmount))/100:null;
 const reportedMonths=months.filter(m=>m.consumedUnits!==null);
 const consumption={totalReportedUnits:reportedMonths.length?reportedMonths.reduce((total,m)=>total+m.consumedUnits,0):null,reportedMonthlyBills:reportedMonths.length,missingMonthlyBills:months.length-reportedMonths.length,firstReportedPeriod:reportedMonths[0]?.period??null,lastReportedPeriod:reportedMonths.at(-1)?.period??null,complete:months.length>0&&reportedMonths.length===months.length};
 const middle=scNo.match(/^\d+[.\/-](\d{1,2})[.\/-]/)?.[1];const scheduledReadingDay=middle&&Number(middle)>=1&&Number(middle)<=32?Number(middle):null;
 return {months,consumption,totals,sourceTotals,paidDifference,sourceTotalMismatches:mismatches,unallocatedCharges:extras.filter(x=>!assigned.has(x.sequence)),scheduledReadingDay};
}
```

## Source: api.mjs

```javascript
import {SOURCE,branches,upstream,lookup,validate} from './adapter.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function api(request) {
 const path=new URL(request.url).pathname;
 try {
  if(path==='/api/branches' && request.method==='GET') return json({branches:branches(await upstream(SOURCE)),source:SOURCE});
  if(path==='/api/readings' && request.method==='POST') {
   const origin=request.headers.get('Origin');
   if(origin && origin!==new URL(request.url).origin) return json({error:'Cross-origin requests are not allowed.'},403);
   if(Number(request.headers.get('content-length'))>4096) return json({error:'Request too large.'},413);
   const raw=await request.text();
   if(raw.length>4096) return json({error:'Request too large.'},413);
   let input;try { input=validate(JSON.parse(raw)); } catch(e) { return json({error:e.message},400); }
   return json(await lookup(input));
  }
  return json({error:'Unknown endpoint or unsupported method.'},404);
 } catch(e) {return json({error:e.name==='TimeoutError'?'NEA is taking too long to respond. Please try again.':e.message},502);}
}
```

## Source: worker.mjs

```javascript
import {api} from './api.mjs';
export default {fetch:api};
```

## Source: examples/frontend-client.mjs

```javascript
export async function fetchNeaStatement(details,{signal}={}) {
  const response=await fetch('/api/readings',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(details),signal,
  });
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch the NEA statement.');
  return result;
}
export async function fetchNeaBranches({signal}={}) {
  const response=await fetch('/api/branches',{signal});
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
.breakdown{display:grid;grid-template-columns:1fr 1fr;gap:22px;background:#fafcf8;border:1px solid #e0e8df;border-radius:12px;padding:20px;margin:20px 0}.breakdown dl,.totals dl{margin:0}.breakdown dl div,.totals dl div{display:flex;justify-content:space-between;gap:15px;padding:7px 0;font-size:12px}.breakdown dt,.totals dt{color:#75836d}.breakdown dd,.totals dd{margin:0;text-align:right}.breakdown .grand{font-weight:750;border-top:1px solid #dde6d8;margin-top:5px;padding-top:12px}.totals{margin-top:20px;padding:18px;border:1px solid #dce6d7;border-radius:10px}.rules{margin-top:24px}.rules summary{cursor:pointer;font-size:13px;font-weight:650;padding:10px 0}.rules p{font-size:12px;color:#73816d;line-height:1.8}.rules table{margin:12px 0}.month-label{margin-top:0}.statement-label{font-size:11px;color:#73816d;line-height:1.7}.receipt-difference{color:#8c4a28}.tabs{flex-wrap:wrap}.export{white-space:nowrap}@media(max-width:680px){.breakdown{grid-template-columns:1fr}.table-head{align-items:start}.breakdown dl div,.totals dl div{font-size:11px}} </style></head><body><header><div class="brand"><div class="mark" aria-hidden="true">ϟ</div><div>NEA Readings<small>ELECTRICITY, IN VIEW</small></div></div><div class="header-note">Independent tool · NEA billing data</div></header><main><div class="eyebrow">Your connection. Your consumption.</div><h1>A clearer view of <span>your electricity.</span></h1><p class="intro">Find billed consumption and statement history in one place.<br>Use the consumer details printed on your NEA bill.</p><div class="layout"><aside><section class="panel"><h2><span class="step">01</span>Find your connection</h2><p class="subtitle">Three details from your bill. No login needed.</p><form id="lookup"><label for="consumer">Consumer ID</label><input id="consumer" name="consumerId" required inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20" placeholder="e.g. 12345" value=""><label for="sc">SC number</label><input id="sc" name="scNo" required maxlength="40" placeholder="e.g. 001.19.001" value=""><div class="hint">Service connection number, including the dots.<br>This is the SC No. on your bill, not the meter serial.</div><div id="reading-schedule" class="hint"></div><label for="branch">Branch / distribution centre</label><select id="branch" name="branch" required><option value="241">Damauli DC</option></select><div class="hint" id="branch-status">Loading NEA’s current branch list…</div><div class="date-grid"><div><label for="from">From date · AD</label><input id="from" name="from" type="date" required></div><div><label for="to">To date · AD</label><input id="to" name="to" type="date" required></div></div><button id="submit" class="primary" type="submit">Fetch statement <span aria-hidden="true">↗</span></button><button id="pdf-range" class="quiet" type="button">Use sample range: 1 Mar–13 Oct 2026</button><br><button id="reset" class="quiet" type="button">Clear details</button></form><div class="privacy"><span aria-hidden="true">♧</span><span>Your details are sent to NEA for this lookup.<br>This app does not save your account or statement.</span></div></section><section class="panel guide"><h3>What can I see?</h3><p>Monthly billed units, bill amounts and payment records. Cumulative meter readings are not exposed by NEA’s public billing portal.</p></section></aside><div class="workspace"><div id="error" class="error" role="alert" hidden></div><section id="empty" class="panel empty"><div class="empty-icon" aria-hidden="true"><svg width="38" height="38" viewBox="0 0 40 40" fill="none"><rect x="8" y="4" width="24" height="32" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M13 11h14v9H13zM14 27h2m4 0h2m4 0h2" stroke="currentColor" stroke-width="1.5"/><path d="m21 12-4 5h5l-3 4" stroke="currentColor"/></svg></div><h2>Your statement starts here</h2><p>Enter your connection details and select a date range to fetch your records from NEA.</p><div class="empty-tags"><span>Billed consumption</span><span>Bill history</span><span>Payment records</span></div></section><section id="result" class="panel" hidden aria-live="polite"><div class="account"><div><div class="eyebrow">Connection overview</div><h2 id="account-name"></h2><p id="account-details"></p></div><span class="pill">Fetched from NEA</span></div><div class="stats"><div class="stat"><div class="label">LATEST CONSUMED UNITS · kWh</div><strong id="units">—</strong><small id="units-period"></small></div><div class="stat"><div class="label">LATEST TOTAL PAYABLE · NPR</div><strong id="bill">—</strong><small id="bill-period"></small></div><div class="stat"><div class="label">MONTHLY BILLS</div><strong id="count">—</strong><small>In the selected range</small></div></div><div id="availability" class="note"></div><label for="month" class="month-label">Monthly breakdown · units &amp; NPR</label><select id="month"></select><div id="breakdown" class="breakdown"></div><div id="consumption-overview" class="totals"></div><div id="chart" class="chart" role="img" aria-label="Billed consumption by month" hidden></div><div class="table-head"><div class="tabs" role="group" aria-label="Statement view"><button type="button" id="bills-tab" class="active" aria-pressed="true">Monthly bills</button><button type="button" id="payments-tab" aria-pressed="false">Payments</button><button type="button" id="source-tab" aria-pressed="false">NEA source rows</button></div><button type="button" id="export" class="export">↓ Export CSV</button></div><div class="scroll"><table><thead id="table-head"></thead><tbody id="rows"></tbody></table></div><div id="totals" class="totals"></div><details class="rules"><summary>Reading schedule, VAT, rebates &amp; late charges</summary><p id="schedule-guide"></p><p>Regular customers: 2% rebate within 7 days of meter reading; no rebate or fine on days 8–15; 5% surcharge on days 16–30, 10% on days 31–40, and 25% after day 40. Non-payment through day 60 can lead to disconnection. Special categories and supplementary bills have different rules. <a href="https://www.nea.org.np/uploads/shares/publication/51207195.pdf" target="_blank" rel="noopener">NEA collection regulations, sections 7–10</a>.</p><p>The 2083 VAT guideline took effect on 1 Shrawan 2083: non-household supply is generally taxed at 13%; household consumption up to 50 units is exempt, with 5% on the taxable consumption above that threshold. The portal does not report account category or taxable base. VAT here is always NEA’s recorded VAT, not a computed 13% addition. <a href="https://ird.gov.np/content/13581/guidelines-for-/" target="_blank" rel="noopener">IRD electricity VAT guideline</a>.</p><p>Base bills may include energy, minimum/service and demand charges, depending on the tariff category. This statement does not separate those amounts. NEA’s published schedule lists NPR 250 for disconnection and NPR 500 for reconnection; these are separate service charges, not amounts automatically added by this app. <a href="https://www.nea.org.np/uploads/shares/Tarrif_rates/Consumer_Tarrif_data.pdf" target="_blank" rel="noopener">NEA tariff and service charges</a>.</p></details><p id="updated" class="updated"></p></section><div class="footnote"><span>Read-only lookup. Records depend on NEA’s latest updates.</span><a href="https://www.neabilling.com/viewonline/" target="_blank" rel="noopener">Open NEA billing portal ↗</a></div></div></div><footer><span>NEA Readings · An independent tool, not affiliated with Nepal Electricity Authority.</span><span>Source: NEA Computerized Billing and Network Division</span></footer></main><script>
const $=id=>document.getElementById(id);let data=null,view='monthly';const nf=new Intl.NumberFormat('en-NP',{maximumFractionDigits:2});const fmt=n=>n===null||n===undefined?'Not available':nf.format(n);function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}const now=new Date(),lastYear=new Date(now);lastYear.setFullYear(now.getFullYear()-1);$('to').value=iso(now);$('from').value=iso(lastYear);
async function readJson(response){const j=await response.json();if(!response.ok)throw Error(j.error||'Lookup failed. Please try again.');return j}
fetch('/api/branches').then(readJson).then(j=>{const selected=$('branch').value;$('branch').replaceChildren(...j.branches.map(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=b.label;return o}));$('branch').value=selected;$('branch-status').textContent=j.branches.length+' branches from NEA’s billing portal.'}).catch(()=>{$('branch-status').textContent='Branch list unavailable. Damauli DC is available; refresh to retry.'});
function showSchedule(){const day=$('sc').value.match(/^\d+[.\/-](\d{1,2})[.\/-]/)?.[1];$('reading-schedule').textContent=day&&Number(day)>0&&Number(day)<=32?'Expected reading: '+Number(day)+'th of each Nepali month. Actual bill dates take precedence.':''}showSchedule();$('sc').addEventListener('input',showSchedule);$('pdf-range').onclick=()=>{$('from').value='2026-03-01';$('to').value='2026-10-13'};
function drawRows(){const records=view==='monthly'?data.summary.months:view==='payment'?data.records.filter(r=>r.kind==='payment'):data.records;const headers=view==='monthly'?['Period · BS','Bill date · AD','Consumed units · kWh','Base · NPR','Adjustment · NPR','VAT payable · NPR','Other · NPR','Total payable · NPR','Status']:view==='payment'?['Paid date · AD','Paid · NPR','Transaction ID']:['SNo','Status','Due bill of','Bill date · AD','Consumed units · kWh','Bill amount · NPR','Rebate / penalty','Rate %','Payable · NPR','Paid · NPR','Merchant','Transaction ID','Paid date · AD'];$('table-head').replaceChildren();const tr=document.createElement('tr');headers.forEach(h=>{const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th)});$('table-head').append(tr);$('rows').replaceChildren();records.forEach(r=>{const tr=document.createElement('tr');const values=view==='monthly'?[r.period,r.billDate||'—',r.consumedUnits===null?'Not reported by NEA':fmt(r.consumedUnits),fmt(r.baseAmount),(r.adjustmentAmount>0?'+':'')+fmt(r.adjustmentAmount)+(r.adjustmentRate?' ('+r.adjustmentRate+'%)':''),r.vatPresent?fmt(r.vatPayable):'None recorded',fmt(r.otherCharges),fmt(r.totalPayable),r.status]:view==='payment'?[r.paidDate||'—',fmt(r.paidAmount),r.transactionId||'—']:[r.sequence,r.status,r.period||'—',r.billDate||'—',r.consumedUnits===null?'—':fmt(r.consumedUnits),fmt(r.billAmount),r.adjustment||'—',fmt(r.rate),fmt(r.payableAmount),r.paidAmount===null?'—':fmt(r.paidAmount),r.merchant||'—',r.transactionId||'—',r.paidDate||'—'];values.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});$('rows').append(tr)});if(!records.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='No records returned for this date range.';tr.append(td);$('rows').append(tr)}[['bills','monthly'],['payments','payment'],['source','source']].forEach(([t,k])=>{const active=view===k;$(t+'-tab').classList.toggle('active',active);$(t+'-tab').setAttribute('aria-pressed',active)})}
function dl(container,items){const list=document.createElement('dl');items.forEach(([label,value,grand])=>{const row=document.createElement('div');if(grand)row.className='grand';const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);list.append(row)});container.append(list)}
function monthBreakdown(){const m=data.summary.months[Number($('month').value)];$('breakdown').replaceChildren();if(!m){$('breakdown').textContent='No monthly bills returned.';return}dl($('breakdown'),[['Consumed units · kWh',m.consumedUnits===null?'Not reported by NEA':fmt(m.consumedUnits)],['Base bill',fmt(m.baseAmount)],[m.adjustment==='PENALTY'?'Penalty ('+m.adjustmentRate+'%)':m.adjustment==='REBATE'?'Rebate ('+m.adjustmentRate+'%)':'Adjustment',(m.adjustmentAmount>0?'+':'')+fmt(m.adjustmentAmount)],['Base after adjustment',fmt(m.adjustedBaseAmount)],['VAT billed',m.vatPresent?fmt(m.vatAmount):'None recorded'],['VAT payable',m.vatPresent?fmt(m.vatPayable):'None recorded'],['Other / arrears payable',fmt(m.otherCharges)],['Total payable',fmt(m.totalPayable),true]]);const right=document.createElement('div');dl(right,[['Bill date · AD',m.billDate||'—'],['Paid date · AD',m.paidDate||'—'],['Receipt paid',m.paidAmount===null?'Not uniquely allocated':fmt(m.paidAmount)],['Paid minus payable',m.paymentDifference===null?'Not uniquely allocated':fmt(m.paymentDifference)],['Statement status',m.status]]);const note=document.createElement('p');note.className='statement-label';note.textContent='Source rows '+m.sourceSequences.join(', ')+(m.receiptSequence?' · receipt row '+m.receiptSequence:'')+'. '+(m.vatPresent?'VAT billed and VAT payable differ because NEA supplies separate decimal and rounded amounts. ':'')+'Rebate/penalty amounts use the difference recorded by NEA, including rounding. A receipt covering several months is not allocated to one month.';right.append(note);$('breakdown').append(right)}
$('month').addEventListener('change',monthBreakdown);
function render(){const summary=data.summary,monthly=summary.months,latest=monthly.at(-1);$('account-name').textContent=data.account.name||'Your NEA connection';$('account-details').textContent=data.account.location+' · Consumer '+data.account.consumerId+' · SC '+data.account.scNo;$('units').textContent=latest&&latest.consumedUnits!==null?fmt(latest.consumedUnits):'—';$('units-period').textContent=latest?latest.period+(latest.consumedUnits===null?' · Not reported by NEA':''):'No monthly bill returned';$('bill').textContent=latest?fmt(latest.totalPayable):'—';$('bill-period').textContent=latest?latest.period+' · '+latest.status+' · Includes linked VAT & charges':'No monthly bill returned';$('count').textContent=monthly.length;const missing=monthly.filter(r=>r.consumedUnits===null).length;$('availability').textContent='Units are billed consumption, not cumulative meter readings.'+(missing?' NEA leaves units blank for '+missing+' monthly bill(s).':'')+' Monthly totals include VAT/arrears only where the transaction identifies one month.'+(summary.unallocatedCharges.length?' '+summary.unallocatedCharges.length+' extra charge row(s) cannot be uniquely allocated; inspect source rows.':'');$('month').replaceChildren(...monthly.map((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m.period+' · '+(m.billDate||'No bill date');return o}));$('month').value=monthly.length-1;monthBreakdown();const consumption=summary.consumption;$('consumption-overview').replaceChildren();const consumptionTitle=document.createElement('h2');consumptionTitle.textContent='Consumed units reported by NEA';$('consumption-overview').append(consumptionTitle);dl($('consumption-overview'),[['Total reported consumption · kWh',fmt(consumption.totalReportedUnits)],['Monthly bills with consumed units',consumption.reportedMonthlyBills+' of '+monthly.length],['First reported month in this range',consumption.firstReportedPeriod||'Not reported by NEA']]);const consumptionNote=document.createElement('p');consumptionNote.className='statement-label';consumptionNote.textContent=consumption.complete?'All monthly bills in this range report consumed units.':consumption.missingMonthlyBills?'NEA did not report consumed units for '+consumption.missingMonthlyBills+' earlier or other monthly bill(s) in this range. The total includes reported monthly units only; missing values are not counted as zero.':'No monthly bills returned for this range.';$('consumption-overview').append(consumptionNote);const unitRows=monthly.filter(r=>r.consumedUnits!==null).slice(-6);$('chart').hidden=!unitRows.length;$('chart').replaceChildren();if(unitRows.length){const max=Math.max(1,...unitRows.map(r=>r.consumedUnits));unitRows.forEach(r=>{const col=document.createElement('div');col.className='bar-col';const b=document.createElement('b');b.textContent=fmt(r.consumedUnits);const bar=document.createElement('div');bar.className='bar';bar.style.height=(r.consumedUnits/max*76)+'px';const span=document.createElement('span');span.textContent=r.period.split('/')[0];col.append(b,bar,span);$('chart').append(col)});$('chart').setAttribute('aria-label',unitRows.map(r=>r.period+': '+r.consumedUnits+' units').join('; '))}$('totals').replaceChildren();const title=document.createElement('h2');title.textContent='Statement reconciliation · NPR';$('totals').append(title);dl($('totals'),[['Total billed (including VAT & arrears)',fmt(summary.totals.billAmount)],['Total payable after adjustments',fmt(summary.totals.payableAmount)],['Total paid (receipts counted once)',fmt(summary.totals.paidAmount)],['Paid minus payable',fmt(summary.paidDifference)]]);const note=document.createElement('p');note.className='statement-label';note.textContent=(summary.sourceTotals?'All three totals match NEA’s TOTAL row.':'NEA did not supply a TOTAL row; totals are sums of returned records.')+(summary.paidDifference?' The paid/payable difference is present in NEA’s records; it is not automatically treated as credit, a fee or an unpaid balance.':'');$('totals').append(note);$('schedule-guide').textContent=summary.scheduledReadingDay?'SC reading group '+summary.scheduledReadingDay+': expected reading on the '+summary.scheduledReadingDay+'th of each Nepali month. Use the actual meter-reading/bill date for payment windows; statement bill dates and the date filter are Gregorian (AD), while bill periods are Nepali (BS).':'Use the actual meter-reading/bill date for payment windows. Bill periods use BS; statement dates and date filters use AD.';$('updated').textContent='Fetched '+new Date(data.fetchedAt).toLocaleString()+' · '+data.range.from+' to '+data.range.to+' (AD) · '+data.records.length+' source rows';$('result').hidden=false;$('empty').hidden=true;drawRows()}
$('lookup').addEventListener('submit',async e=>{e.preventDefault();$('error').hidden=true;$('result').hidden=true;$('empty').hidden=false;data=null;if($('from').value>$('to').value){$('error').textContent='From date must come before to date.';$('error').hidden=false;return;}const b=$('submit');b.disabled=true;b.innerHTML='<span class="loader" aria-hidden="true"></span>Fetching from NEA…';$('empty').setAttribute('aria-busy','true');try{data=await fetch('/api/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}).then(readJson);view='monthly';render()}catch(err){$('error').textContent=err.message;$('error').hidden=false}finally{b.disabled=false;b.textContent='Fetch statement ↗';$('empty').setAttribute('aria-busy','false')}});
$('reset').onclick=()=>{data=null;$('consumer').value='';$('sc').value='';$('result').hidden=true;$('empty').hidden=false;$('error').hidden=true;showSchedule();$('consumer').focus()};$('bills-tab').onclick=()=>{view='monthly';drawRows()};$('payments-tab').onclick=()=>{view='payment';drawRows()};$('source-tab').onclick=()=>{view='source';drawRows()};$('export').onclick=()=>{if(!data)return;const fields=['sequence','kind','category','period','billDate','consumedUnits','billAmount','adjustment','rate','payableAmount','status','paidAmount','merchant','transactionId','paidDate'];const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const csv=[fields.join(','),...data.records.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='nea-statement-'+data.range.from+'-'+data.range.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
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

## Source: examples/express/server.mjs

```javascript
// Optional example: npm install express before running this file.
import express from 'express';
import {SOURCE,branches,upstream,validate,lookup} from '../../adapter.mjs';
const app=express();
app.use(express.json({limit:'4kb'}));
// Add your project's authentication/authorization middleware before these routes.
app.get('/api/branches',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try { res.json({branches:branches(await upstream(SOURCE)),source:SOURCE}); }
  catch(error) { res.status(502).json({error:error.message}); }
});
app.post('/api/readings',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  let input;
  try {input=validate(req.body);}
  catch(error) {return res.status(400).json({error:error.message});}
  try {res.json(await lookup(input));}
  catch(error) {res.status(502).json({error:error.message});}
});
app.use((error,req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(error.type==='entity.too.large')return res.status(413).json({error:'Request too large.'});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON.'});
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
```
