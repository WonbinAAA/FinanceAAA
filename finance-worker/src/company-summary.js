import {AppError} from './errors.js';

export function validateCompanySummary(data){
 const unsigned=['income_cents','expense_cents','entry_count','pending_count'];
 if(data?.source!=='company-owner-ledger'||data.owner_id!=='owner'||data.scope!=='all-active-entries'||data.currency!=='THB'
   ||unsigned.some(key=>!Number.isSafeInteger(data[key])||data[key]<0)||!Number.isSafeInteger(data.net_cents)
   ||data.net_cents!==data.income_cents-data.expense_cents||typeof data.read_at!=='string'||!Number.isFinite(Date.parse(data.read_at)))
  throw new AppError('ยอดจากสมุดบริษัทไม่สมบูรณ์ กรุณาลองใหม่',503,'COMPANY_SUMMARY_INVALID');
 return Object.fromEntries(['source','owner_id','scope','currency',...unsigned,'net_cents','read_at'].map(key=>[key,data[key]]));
}
export async function readCompanySummary(env){
 if(!env.COMPANY_LEDGER?.fetch)throw new AppError('ยังอ่านสมุดบริษัทไม่ได้ กรุณาลองใหม่',503,'COMPANY_SUMMARY_UNAVAILABLE');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  // A fixed read-only service request; no browser cookie, query or credential is forwarded.
  const response=await env.COMPANY_LEDGER.fetch(new Request('https://company-expenses-ledger.sugrid-kumpa.workers.dev/finance/api/summary',{
   method:'GET',headers:{Accept:'application/json'},signal:controller.signal}));
  if(!response.ok)throw new AppError('ยังอ่านสมุดบริษัทไม่ได้ กรุณาลองใหม่',503,'COMPANY_SUMMARY_UNAVAILABLE');
  return validateCompanySummary(await response.json());
 }catch(error){
  if(error instanceof AppError)throw error;
  throw new AppError('ยังอ่านสมุดบริษัทไม่ได้ กรุณาลองใหม่',503,'COMPANY_SUMMARY_UNAVAILABLE');
 }finally{clearTimeout(timer);}
}
