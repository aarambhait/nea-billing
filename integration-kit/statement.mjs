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
 const middle=scNo.match(/^\d+[.\/-](\d{1,2})[.\/-]/)?.[1];const scheduledReadingDay=middle&&Number(middle)>=1&&Number(middle)<=32?Number(middle):null;
 return {months,totals,sourceTotals,paidDifference,sourceTotalMismatches:mismatches,unallocatedCharges:extras.filter(x=>!assigned.has(x.sequence)),scheduledReadingDay};
}
