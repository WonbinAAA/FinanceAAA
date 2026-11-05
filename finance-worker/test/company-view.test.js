import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompanyBook,displayLedger} from '../src/company-view.js';
import {executeFinance} from '../src/finance.js';
import {fixture,options,transaction,testDb} from './helpers.js';
import worker from '../src/worker.js';
import {authRoute,session} from '../src/auth.js';

const config=kind=>JSON.stringify({kind,accountId:'ACC1',categoryId:'EX',funding:'PERSONAL'});
function data(){
 const rows=[{transaction_id:'bank-combined',transaction_date:'2026-11-03',transaction_type:'EXPENSE',expense_owner:'COMPANY',amount:600,account_id:'ACC1',account_name:'บัญชีจำลอง',category_id:'EX',company_kind:'OTHER_ALLOWANCE',status:'ACTIVE'},
 {transaction_id:'bank-self',transaction_date:'2026-11-03',transaction_type:'INCOME',company_kind:'SELF_ALLOWANCE',amount:300,account_id:'ACC1',status:'ACTIVE'},
 {transaction_id:'old-company',expense_owner:'COMPANY',transaction_date:'2026-10-01',amount:10,status:'ACTIVE'},
 {transaction_id:'personal',transaction_date:'2026-11-04',transaction_type:'EXPENSE',expense_owner:'PERSONAL',account_id:'ACC1',category_id:'EX',amount:50,status:'ACTIVE',description:'อาหารจำลอง'}];
 const entries=[1,2,3,4].map((n)=>({id:'source-'+n,owner_id:'owner',revision:1,date:'2026-11-03',direction:'expense',item_base:'เบี้ยเลี้ยง',item_name:'เบี้ยเลี้ยงบุคคลจำลอง'+n,amount_cents:n===4?30000:20000,note:'บรรทัดแรก\nบรรทัดสอง',project_id:'project'}));
 const links=entries.map((e,i)=>({source_id:e.id,revision:1,transaction_id:i===3?'bank-self':'bank-combined',config_json:config(i===3?'SELF_ALLOWANCE':'OTHER_ALLOWANCE')}));
 return {rows,book:{entries,refs:[{id:'project',name:'งานจำลอง'}]},links};
}
test('company source replaces combined and unmatched company display rows, preserving original cash records',()=>{
 const {rows,book,links}=data(),before=JSON.stringify(rows),result=displayLedger(rows,book,links);
 assert.equal(result.length,5);assert.deepEqual(result.filter(r=>r.source).map(r=>r.amount).sort((a,b)=>a-b),[200,200,200,300]);
 assert.equal(result.some(r=>['bank-combined','bank-self','old-company'].includes(r.transaction_id)),false);
 assert.equal(result.filter(r=>r.source&&r.company_kind!=='SELF_ALLOWANCE').reduce((n,r)=>n+r.amount,0),600);
 assert.equal(result.filter(r=>r.source).reduce((n,r)=>n+r.amount,0),900);
 assert.equal(JSON.stringify(rows),before);assert.strictEqual(result.find(r=>r.transaction_id==='personal'),rows[3]);
 const snapshot=executeFinance(fixture(),'saveTransaction',[transaction()],options()).snapshot;
 const totals=executeFinance(snapshot,'getDashboard').result;displayLedger(rows,book,links);
 assert.deepEqual(executeFinance(snapshot,'getDashboard').result,totals);
});
test('source edits, trash, filters and newest limit use current source values instead of stale Finance descriptions',()=>{
 const {rows,book,links}=data();book.entries[0]={...book.entries[0],revision:2,date:'2026-11-05',amount_cents:25000,item_name:'รายการชื่อใหม่'};
 book.entries=book.entries.slice(0,3);
 const all=displayLedger(rows,book,links);assert.equal(all.length,4);assert.equal(all[0].amount,250);assert.equal(all[0].sync_pending,true);
 assert.equal(displayLedger(rows,book,links,{query:'ชื่อใหม่'}).length,1);
 assert.equal(displayLedger(rows,book,links,{query:'งานจำลอง'}).length,3);
 assert.equal(displayLedger(rows,book,links,{type:'EXPENSE',owner:'COMPANY',date:'2026-11-03',account_id:'ACC1',category_id:'EX'}).length,2);
 assert.equal(displayLedger(rows,book,links,{owner:'PERSONAL'}).length,1);
 assert.equal(displayLedger(rows,book,links,{date_from:'2026-11-04',date_to:'2026-11-05'}).length,2);
 assert.equal(displayLedger(rows,book,links,{limit:1})[0].source_id,'source-1');
 assert.equal(displayLedger(rows,book,links,{source_id:'source-4'}).length,0);
});
test('fixed source read forwards no credentials, rejects missing/foreign/duplicate data and never falls back',async()=>{
 const {book}=data();const body={...book,owner:{id:'owner'}};let request;
 const env={COMPANY_LEDGER:{fetch:async r=>{request=r;return Response.json(body);}}};
 assert.equal((await readCompanyBook(env)).entries.length,4);assert.equal(request.method,'GET');assert.equal(request.headers.get('cookie'),null);assert.match(request.url,/\/finance\/api\/bootstrap$/);
 await assert.rejects(readCompanyBook({}),e=>e.status===503);
 for(const invalid of [{...body,owner:{id:'other'}},{...body,entries:[...book.entries,book.entries[0]]},{...body,entries:[{...book.entries[0],amount_cents:.5}]}])await assert.rejects(readCompanyBook({COMPANY_LEDGER:{fetch:async()=>Response.json(invalid)}}),e=>e.status===503);
});
test('display RPC remains authenticated/CSRF protected and leaves D1 ledger and revision untouched',async()=>{
 const {book}=data(),env={DB:testDb(),APP_ENV:'local',LOCAL_DEV_LOGIN:'true',APP_ORIGIN:'http://127.0.0.1:8787',COMPANY_LEDGER:{fetch:async()=>Response.json({...book,owner:{id:'owner'}})}};
 const make=headers=>new Request(env.APP_ORIGIN+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json',Origin:env.APP_ORIGIN,...headers},body:JSON.stringify({method:'getDisplayTransactions',args:[{}]})});
 assert.equal((await worker.fetch(make({}),env)).status,401);
 const login=await authRoute(new Request(env.APP_ORIGIN+'/auth/local',{method:'POST',headers:{Origin:env.APP_ORIGIN}}),env),cookie=login.headers.get('set-cookie').split(';')[0],auth=await session(new Request(env.APP_ORIGIN,{headers:{cookie}}),env);
 assert.equal((await worker.fetch(make({cookie}),env)).status,403);
 const response=await worker.fetch(make({cookie,'X-CSRF-Token':auth.csrf_token}),env);assert.equal(response.status,200);assert.equal((await response.json()).length,4);
 assert.equal((await env.DB.prepare('SELECT revision FROM finance_state').first()).revision,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ledger_records').first()).n,0);
});
