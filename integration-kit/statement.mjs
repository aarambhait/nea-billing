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
