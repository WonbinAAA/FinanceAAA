import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readCompanySummary,validateCompanySummary} from '../src/company-summary.js';
import worker from '../src/worker.js';
import {authRoute,session} from '../src/auth.js';
import {testDb} from './helpers.js';

const summary=extra=>({source:'company-owner-ledger',owner_id:'owner',scope:'all-active-entries',currency:'THB',income_cents:10001,expense_cents:13000,net_cents:-2999,entry_count:3,pending_count:0,read_at:'2026-11-04T00:00:00Z',...extra});
test('service read uses only the fixed owner summary URL and preserves signed exact cents',async()=>{
 let calls=0;const data=await readCompanySummary({COMPANY_LEDGER:{fetch:async request=>{calls++;assert.equal(request.method,'GET');assert.equal(request.url,'https://company-expenses-ledger.sugrid-kumpa.workers.dev/finance/api/summary');assert.equal(request.headers.get('cookie'),null);return Response.json(summary({ignored:'not-forwarded'}));}}});
 assert.equal(calls,1);assert.equal(data.net_cents,-2999);assert.equal(data.ignored,undefined);
});
test('unavailable or malformed source cannot fall back to wallet funds or a false zero',async()=>{
 await assert.rejects(readCompanySummary({}),e=>e.status===503);
 await assert.rejects(readCompanySummary({COMPANY_LEDGER:{fetch:async()=>new Response('unavailable',{status:503})}}),e=>e.status===503);
 for(const data of [summary({owner_id:'other'}),summary({scope:'month'}),summary({net_cents:0}),summary({income_cents:0.1}),summary({pending_count:-1})])assert.throws(()=>validateCompanySummary(data),e=>e.status===503);
 assert.equal(validateCompanySummary(summary({income_cents:0,expense_cents:0,net_cents:0,entry_count:0})).net_cents,0);
});
test('HTTP summary is authenticated and read-only, without changing the money snapshot',async()=>{
 const env={DB:testDb(),APP_ORIGIN:'http://127.0.0.1:8787',APP_ENV:'local',LOCAL_DEV_LOGIN:'true',COMPANY_LEDGER:{fetch:async()=>Response.json(summary())}};
 assert.equal((await worker.fetch(new Request(env.APP_ORIGIN+'/api/company-ledger-summary'),env)).status,401);
 const logged=await authRoute(new Request(env.APP_ORIGIN+'/auth/local',{method:'POST',headers:{Origin:env.APP_ORIGIN}}),env),cookie=logged.headers.get('set-cookie').split(';')[0];
 const auth=await session(new Request(env.APP_ORIGIN,{headers:{cookie}}),env);assert.ok(auth);
 const response=await worker.fetch(new Request(env.APP_ORIGIN+'/api/company-ledger-summary',{headers:{cookie}}),env);
 assert.equal(response.status,200);assert.equal((await response.json()).net_cents,-2999);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await env.DB.prepare('SELECT revision FROM finance_state').first()).revision,0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ledger_records').first()).n,0);
});
function browser(fetcher){
 const nodes=new Map(['dashboardCompanyHeld','dashboardCompanyNetCaption','cash'].map(id=>[id,{textContent:id==='cash'?'unchanged cash':'',attributes:{},classes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},classList:{toggle(){}}}]));
 const card={attributes:{},classes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};card.classList={toggle(k,v){card.classes[k]=v;}};
 const context={cloudSession:async()=>({}),fetch:fetcher,document:{getElementById:id=>nodes.get(id),querySelector:()=>card}};context.window=context;
 vm.runInNewContext(readFileSync(new URL('../public/company-net.js',import.meta.url),'utf8'),context);return {context,nodes,card};
}
test('dashboard paints the book deficit while bank cash stays untouched; failure clears stale amounts',async()=>{
 let fail=false;const {context,nodes,card}=browser(async()=>fail?new Response('',{status:503}):Response.json(summary()));
 await context.refreshCompanyLedgerNet();assert.equal(nodes.get('dashboardCompanyHeld').textContent,'−฿29.99');assert.equal(nodes.get('cash').textContent,'unchanged cash');assert.equal(card.classes['company-net-negative'],true);
 fail=true;await context.refreshCompanyLedgerNet();assert.equal(nodes.get('dashboardCompanyHeld').textContent,'—');assert.match(nodes.get('dashboardCompanyNetCaption').textContent,/อ่านยอดไม่สำเร็จ/);assert.equal(nodes.get('cash').textContent,'unchanged cash');
});
