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
