import {AppError} from './errors.js';
import {isCompanyCategory,isCompanyRecord} from './company-policy.js';

const unavailable=()=>new AppError('อ่านรายการบริษัทไม่สำเร็จ กรุณาลองใหม่',503,'COMPANY_VIEW_UNAVAILABLE');

export async function readCompanyBook(env){
 if(!env.COMPANY_LEDGER?.fetch)throw unavailable();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await env.COMPANY_LEDGER.fetch(new Request('https://company-expenses-ledger.sugrid-kumpa.workers.dev/finance/api/bootstrap',{
   method:'GET',headers:{Accept:'application/json'},signal:controller.signal}));
  if(!response.ok)throw unavailable();
  const data=await response.json(),ids=new Set();
  if(data?.owner?.id!=='owner'||!Array.isArray(data.entries)||!Array.isArray(data.refs))throw unavailable();
  for(const e of data.entries){
   if(typeof e.id!=='string'||!e.id||ids.has(e.id)||e.owner_id!=='owner'||e.deleted_at||!['income','expense'].includes(e.direction)
    ||!Number.isSafeInteger(e.amount_cents)||e.amount_cents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||typeof e.item_name!=='string')throw unavailable();
   ids.add(e.id);
  }
  // Never forward bootstrap accounts, profile settings or credentials to the Finance client.
  return {entries:data.entries,refs:data.refs};
 }catch{throw unavailable();}finally{clearTimeout(timer);}
}

export function displayLedger(rows,book,links,filters={},accountRows=[],categoryRows=[]){
 const byTarget=new Map(rows.map(r=>[r.transaction_id,r])),bySource=new Map(links.map(r=>[r.source_id,r]));
 const refs=new Map(book.refs.map(r=>[r.id,r.name]));
 const accounts=new Map([...rows.filter(r=>r.account_id),...accountRows].map(r=>[r.account_id,r.account_name]));
 const company=book.entries.map(e=>{
  const link=bySource.get(e.id),target=byTarget.get(link?.transaction_id);
  const config=e.finance_link_json?JSON.parse(e.finance_link_json):link?.config_json?JSON.parse(link.config_json):{};
  const kind=config.kind==='REIMBURSEMENT'?'MIXED_RECEIPT':config.kind==='EXPENSE'?'':config.kind||target?.company_kind||'';
  const account=config.accountId||target?.account_id||'';
  return {transaction_id:'company:'+e.id,source_id:e.id,source:'company-owner-ledger',source_title:e.item_name,
   transaction_date:e.date,transaction_type:e.direction==='income'?'INCOME':'EXPENSE',expense_owner:'COMPANY',
   amount:e.amount_cents/100,status:'ACTIVE',created_at:e.created_at||'',description:e.note||'',
   category_id:config.categoryId||target?.category_id||'',category_name:e.item_base||e.item_name,
   account_id:account,account_name:accounts.get(account)||target?.account_name||account,
   company_kind:kind,company_funding:config.funding||target?.company_funding||'',
   project_name:refs.get(e.project_id)||config.projectName||'',recipient:refs.get(e.person_id)||'',
   sync_pending:!link||link.revision!==e.revision};
 });
 const f=filters||{},query=String(f.query||'').toLocaleLowerCase();
 const companyCategories=new Set(categoryRows.filter(isCompanyCategory).map(category=>category.category_id));
 const linkedTargets=new Set(links.map(link=>link.transaction_id));
 // Accounting rows remain intact for cash/audit. Only source rows represent company entries in the view.
 let result=[...rows.filter(r=>!linkedTargets.has(r.transaction_id)&&!companyCategories.has(r.category_id)&&!isCompanyRecord(r)),...company].filter(r=>
  (!f.source_id||r.source_id===f.source_id)&&
  ((f.date_from||f.date_to)?(!f.date_from||r.transaction_date>=f.date_from)&&(!f.date_to||r.transaction_date<=f.date_to):
   f.date?r.transaction_date===f.date:!f.month||r.transaction_date.slice(0,7)===f.month)&&
  (!f.type||r.transaction_type===f.type)&&(!f.owner||r.expense_owner===f.owner)&&
  (!f.account_id||r.account_id===f.account_id||r.to_account_id===f.account_id)&&(!f.category_id||r.category_id===f.category_id)&&
  (!query||[r.description,r.source_title,r.project_name,r.recipient].some(v=>String(v||'').toLocaleLowerCase().includes(query))));
 result.sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)||String(b.created_at).localeCompare(String(a.created_at))||a.transaction_id.localeCompare(b.transaction_id));
 if(f.limit!==undefined){if(!Number.isInteger(f.limit)||f.limit<1||f.limit>50)throw new AppError('จำนวนรายการไม่ถูกต้อง');result=result.slice(0,f.limit);}
 return result;
}
