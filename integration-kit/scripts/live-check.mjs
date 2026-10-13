import {lookup,validate} from '../adapter.mjs';
let raw='';
for await (const chunk of process.stdin) {raw+=chunk;if(raw.length>4096)throw new Error('Request too large.');}
if(!raw.trim())throw new Error('Provide an authorized connection request as JSON on stdin. See README.');
const data=await lookup(validate(JSON.parse(raw)));
console.log(JSON.stringify({sourceRows:data.records.length,monthlyBills:data.summary.months.length,totals:data.summary.totals,sourceTotals:data.summary.sourceTotals,paidDifference:data.summary.paidDifference},null,2));
