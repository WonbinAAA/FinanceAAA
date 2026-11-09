import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,testDb,transaction} from './helpers.js';
import {executeFinance} from '../src/finance.js';
import {commitSnapshot,loadSnapshot} from '../src/storage.js';
import {companyOptions,applyCompanyEvent,installCompanyBaseline,linkHash,protectCompanyWrites,previewCompanyBatch} from '../src/company-link.js';

const config=(extra={})=>({kind:'EXPENSE',funding:'PERSONAL',accountId:'ACC1',categoryId:'EX',projectName:'',...extra});
const source=(extra={})=>({id:'synthetic-source',revision:1,date:'2026-11-03',direction:'expense',amount_cents:1000,item_name:'รายการจำลอง',note:'',recipient:'',deleted:false,finance:config(),...extra});
const event=entry=>({source:'company-expenses-ledger',ownerId:'owner',entry});
async function setup(){
 const env={DB:testDb()},initial=fixture();
 await commitSnapshot(env.DB,await loadSnapshot(env.DB),initial,'seed','seed',{});
 return env;
}
async function baseline(env,entries=[source()],extra={}){
 const before=await loadSnapshot(env.DB),created=executeFinance(before,'saveTransaction',[transaction({amount:entries.reduce((n,e)=>n+e.amount_cents,0)/100,expense_owner:'COMPANY',company_funding:'PERSONAL',...extra})]);
 await commitSnapshot(env.DB,before,created.snapshot,'setup-'+crypto.randomUUID(),'setup',{});
 const snapshot=await loadSnapshot(env.DB),target=snapshot.tables['รายการเงิน'].rows.find(r=>r.transaction_id===created.result.id);
 const group={transactionId:target.transaction_id,transactionHash:await linkHash(target),entries};
 await installCompanyBaseline(env,'owner',{expectedRevision:snapshot.revision,groups:[group]});
 return target.transaction_id;
}
const dashboard=async env=>executeFinance(await loadSnapshot(env.DB),'getDashboard').result;

test('bridge is owner-only, disabled until reviewed, and options reads do not mutate money',async()=>{
 const env=await setup(),before=JSON.stringify(await loadSnapshot(env.DB));
 assert.equal((await companyOptions(env,'owner')).enabled,false);
 await assert.rejects(companyOptions(env,'someone-else'),/เฉพาะสมุด/);
 await assert.rejects(applyCompanyEvent(env,event(source())),/ยังไม่เปิด/);
 assert.equal(JSON.stringify(await loadSnapshot(env.DB)),before);
});
test('baseline keeps IDs and cash while using the owner-approved company date',async()=>{
 const env=await setup(),id=await baseline(env,[source({date:'2026-11-02'})]);
 const after=await loadSnapshot(env.DB),target=after.tables['รายการเงิน'].rows.find(r=>r.transaction_id===id);
 assert.equal(target.transaction_date,'2026-11-02');assert.equal(after.tables['รายการเงิน'].rows.length,1);
 assert.equal((await dashboard(env)).real_cash,9990.01);
 assert.ok(after.tables['ประวัติการแก้ไข'].rows.some(r=>r.field_name==='transaction_date'));
 await assert.rejects(protectCompanyWrites(env.DB,'updateTransaction',[id,{}]),/เว็บบริษัท/);
});
test('concurrent retry, edit, delete and restore move bank cash once and preserve VOID history',async()=>{
 const env=await setup(),id=await baseline(env),first=source({id:'synthetic-new',amount_cents:2000});
 const replies=await Promise.all([applyCompanyEvent(env,event(first)),applyCompanyEvent(env,event(first))]);
 assert.equal(replies[0].transactionId,replies[1].transactionId);
 assert.equal((await dashboard(env)).real_cash,9970.01);
 await applyCompanyEvent(env,event({...first,revision:2,amount_cents:2500}));
 assert.equal((await dashboard(env)).real_cash,9965.01);
 await assert.rejects(applyCompanyEvent(env,event({...first,revision:2,amount_cents:2600})),/รหัสคำขอ/);
 await applyCompanyEvent(env,event({...first,revision:3,amount_cents:2500,deleted:true}));
 assert.equal((await dashboard(env)).real_cash,9990.01);
 await applyCompanyEvent(env,event({...first,revision:4,amount_cents:2500}));
 assert.equal((await dashboard(env)).real_cash,9965.01);
 const rows=(await loadSnapshot(env.DB)).tables['รายการเงิน'].rows;
 assert.equal(rows.filter(r=>r.status==='VOID').length,1);assert.ok(rows.some(r=>r.transaction_id===id));
});
test('three source allowances stay one payment and deleting one adjusts only its share',async()=>{
 const env=await setup(),entries=[1,2,3].map(i=>source({id:'synthetic-person-'+i,amount_cents:20000}));
 const id=await baseline(env,entries),before=(await dashboard(env)).real_cash;
 await applyCompanyEvent(env,event({...entries[0],revision:2,deleted:true}));
 const rows=(await loadSnapshot(env.DB)).tables['รายการเงิน'].rows;
 assert.equal(rows.length,1);assert.equal(rows[0].transaction_id,id);assert.equal(rows[0].amount,400);
 assert.equal((await dashboard(env)).real_cash,before+200);
 await assert.rejects(applyCompanyEvent(env,event({...entries[1],revision:2,finance:config({accountId:'ACC2'})})),/หลายคน/);
});
test('a changed bank target or stale initial plan stops the bridge without partial records',async()=>{
 const env=await setup(),id=await baseline(env),before=await loadSnapshot(env.DB);
 const edited=executeFinance(before,'updateTransaction',[id,{amount:11}]);
 await commitSnapshot(env.DB,before,edited.snapshot,'external','external',{});
 const state=JSON.stringify(await loadSnapshot(env.DB));
 await assert.rejects(applyCompanyEvent(env,event(source({revision:2,amount_cents:1200}))),/แก้แยก/);
 assert.equal(JSON.stringify(await loadSnapshot(env.DB)),state);
});
test('company advances and expenses keep personal income separate and never auto-select refund claims',async()=>{
 const env=await setup();await baseline(env);
 const advance=source({id:'synthetic-advance',direction:'income',amount_cents:10000,finance:config({kind:'ADVANCE',categoryId:'',funding:'POOL'})});
 await applyCompanyEvent(env,event(advance));
 const expense=source({id:'synthetic-pool-expense',amount_cents:3000,finance:config({funding:'POOL'})});
 await applyCompanyEvent(env,event(expense));
 assert.equal((await dashboard(env)).income,0);
 assert.equal((await dashboard(env)).real_cash,10060.01);
 assert.equal(executeFinance(await loadSnapshot(env.DB),'getCompanySummary').result.pool.remaining,70);
 const refund=source({id:'synthetic-refund',direction:'income',amount_cents:500,finance:config({kind:'REIMBURSEMENT',categoryId:'RF',funding:'POOL',allocations:[],surplusConfirmed:true})});
 await applyCompanyEvent(env,event(refund));
 const snap=await loadSnapshot(env.DB);
 assert.equal(snap.tables['จับคู่เงินคืนบริษัท'].rows.length,0);
 assert.equal(executeFinance(snap,'getCompanySummary').result.remaining,10);
});
test('batch preview reserves funding in order and requires exact consent before any write',async()=>{
 const env=await setup();await baseline(env);
 await applyCompanyEvent(env,event(source({id:'synthetic-batch-advance',direction:'income',amount_cents:10000,finance:config({kind:'ADVANCE',categoryId:'',funding:'POOL'})})));
 const entries=[1,2].map(i=>source({id:'synthetic-batch-'+i,amount_cents:6000,recipient:'บุคคลจำลอง '+i,finance:config({kind:'OTHER_ALLOWANCE',funding:'POOL'})}));
 const before=JSON.stringify(await loadSnapshot(env.DB));
 const preview=await previewCompanyBatch(env,'owner',entries);
 assert.equal(preview.entries[0].funding.personal_amount,0);assert.equal(preview.entries[1].funding.personal_amount,20);
 await assert.rejects(previewCompanyBatch(env,'owner',entries,true),/ยืนยัน/);
 assert.equal(JSON.stringify(await loadSnapshot(env.DB)),before);
 Object.assign(entries[1].finance,{shortfallConfirmed:true,expectedPersonalCents:2000});
 await previewCompanyBatch(env,'owner',entries,true);
 assert.equal(JSON.stringify(await loadSnapshot(env.DB)),before);
});
test('linked rows cannot clear known funding and insufficient self allowances never move cash',async()=>{
 const env=await setup();await baseline(env);const before=JSON.stringify(await loadSnapshot(env.DB));
 await assert.rejects(applyCompanyEvent(env,event(source({revision:2,finance:config({funding:''})}))),/ล้างแหล่งเงิน/);
 await assert.rejects(applyCompanyEvent(env,event(source({id:'synthetic-self-empty',finance:config({kind:'SELF_ALLOWANCE',funding:'POOL'})}))),/เพียงพอ/);
 assert.equal(JSON.stringify(await loadSnapshot(env.DB)),before);
});

test('company project ID can receive advances and fund a self allowance without changing cash twice', async () => {
  const env = await setup();
  await baseline(env);
  const before = await dashboard(env);
  const projectName = 'company-project:' + 'a'.repeat(64);
  const funding = { funding: 'PROJECT', projectName };
  const advance = source({ id: 'new-project-advance', direction: 'income', amount_cents: 12000,
    finance: config({ ...funding, kind: 'ADVANCE', categoryId: '' }) });
  await applyCompanyEvent(env, event(advance));
  const allowance = source({ id: 'new-project-self-allowance', amount_cents: 5000,
    finance: config({ ...funding, kind: 'SELF_ALLOWANCE' }) });
  const first = await applyCompanyEvent(env, event(allowance));
  const second = await applyCompanyEvent(env, event(allowance));
  assert.equal(first.transactionId, second.transactionId);
  const after = await dashboard(env);
  assert.equal(after.real_cash, before.real_cash + 120);
  assert.equal(after.income, before.income + 50);
  const state = await companyOptions(env, 'owner');
  assert.equal(state.company.project_catalog.find(project => project.project_name === projectName).remaining, 70);
});
