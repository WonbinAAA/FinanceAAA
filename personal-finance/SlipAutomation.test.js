'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const harness=fs.readFileSync('Finance.test.js','utf8').split("test('Connection")[0];
const {context,sheets,call,base}=new Function('require',harness+'\nreturn {context,sheets,call,base};')(require);
context.today_=()=> '2026-10-19';
let locked=false;
context.LockService={getScriptLock:()=>({waitLock(){assert.equal(locked,false,'Nested script locks are not supported');locked=true;},releaseLock(){locked=false;}})};
const props=context.ocrProperties,key='a'.repeat(64),notices=[],images=new Map();
props.set('N8N_AUTOMATION_KEY',key);props.set('LINE_CHANNEL_SECRET','line-secret');props.set('LINE_CHANNEL_ACCESS_TOKEN','line-token');props.set('LINE_ALLOWED_USER_IDS','UOWNER');
let downloads=0,eventSerial=0;
context.UrlFetchApp.fetch=(url,options)=>{
  if(url.startsWith('https://api-data.line.me/v2/bot/message/')) {
    downloads++;const id=url.split('/').at(-2),bytes=[...(images.get(id)||Buffer.from('image-'+id))];
    assert.equal(options.headers.Authorization,'Bearer line-token');
    return {getResponseCode:()=>200,getBlob:()=>({getBytes:()=>bytes,getContentType:()=> 'image/jpeg'})};
  }
  assert.ok(url==='https://api.line.me/v2/bot/message/push'||url==='https://api.line.me/v2/bot/message/reply');
  notices.push(JSON.parse(options.payload));return {getResponseCode:()=>200};
};
const request=(n8n_action,extra={})=>call('n8nSlipDispatch_',{automation_key:key,n8n_action,...extra});
const event=(extra,user='UOWNER')=>({webhookEventId:'E'+(++eventSerial),replyToken:'reply-'+eventSerial,source:{type:'user',userId:user},...extra});
function send(e) {
  const raw=JSON.stringify({events:[e]});
  return request('prepare',{raw_body:raw,line_signature:crypto.createHmac('sha256','line-secret').update(raw).digest('base64')});
}
const image=id=>send(event({type:'message',message:{type:'image',id:String(id)}})).jobs[0];
const getJob=id=>call('slipJobs_').find(j=>j.job_id===id);
const data=id=>JSON.parse(getJob(id).data_json);
function answer(id,field,value,user) {return send(event({type:'postback',postback:{data:'SLIP:'+JSON.stringify({id,key:field,value})}},user));}
const evidence=(extra={})=>({is_receipt:true,multiple_transactions:false,payment_status:'COMPLETED',currency:'THB',amount:100.5,transaction_date:'2026-10-19',
  amount_confidence:.99,date_confidence:.99,fee_amount:0,payee:'ร้านทดสอบ',bank_reference:null,...extra});
function finish(job,facts=evidence()) {return request('finish',{job_id:job.job_id,nonce:job.nonce,ai_response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(facts)}]}]}});}
const rowCount=()=>sheets['รายการเงิน'].getLastRow();
function describe(name,fn) {fn();console.log('PASS',name);}

describe('Automation is off by default and both credentials and original LINE signature are required',()=>{
  const snapshot=JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k,s])=>[k,s.data])));
  assert.equal(request('status').enabled,false);
  const status=JSON.parse(call('doPost',{postData:{contents:JSON.stringify({n8n_action:'status',automation_key:key})}}).text);
  assert.equal(status.ok,true);assert.equal(status.auto_save,false);
  assert.throws(()=>image(1),/ยังไม่เปิด/);
  assert.throws(()=>call('n8nSlipDispatch_',{automation_key:'bad',n8n_action:'status'}),/ไม่ได้รับอนุญาต/);
  props.set('N8N_LINE_ENABLED','true');props.set('N8N_AUTOSAVE_ENABLED','true');
  assert.throws(()=>request('prepare',{raw_body:'{"events":[]}',line_signature:'bad'}),/ลายเซ็น/);
  send(event({type:'message',message:{type:'image',id:'1'}},'UOTHER'));
  assert.equal(downloads,0);assert.equal(sheets['รับสลิป LINE'],undefined);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k,s])=>[k,s.data]))),snapshot);
});
let first;
describe('Image facts alone do not invent category, bank account, company ownership or funding',()=>{
  first=image(1);const before=rowCount();finish(first);
  assert.equal(getJob(first.job_id).status,'WAITING');assert.equal(data(first.job_id).question,'kind');
  assert.equal(rowCount(),before);assert.equal(data(first.job_id).tx.account_id,undefined);
  answer(first.job_id,'kind','PERSONAL');assert.equal(data(first.job_id).question,'account_id');
  answer(first.job_id,'account_id','ACC002');assert.equal(data(first.job_id).question,'category_id');
});
describe('The final required answer saves once immediately, with no extra approval or DRAFT',()=>{
  const before=call('getDashboard'),count=rowCount();answer(first.job_id,'category_id','CAT008');
  assert.equal(rowCount(),count+1);assert.equal(getJob(first.job_id).status,'SAVED');
  const tx=call('getTransaction',getJob(first.job_id).transaction_id);
  assert.equal(tx.status,'ACTIVE');assert.equal(tx.source_type,'LINE');assert.equal(tx.amount,100.5);
  assert.equal(call('getDashboard').real_cash,before.real_cash-100.5);
  answer(first.job_id,'category_id','CAT008');finish(first);assert.equal(rowCount(),count+1);
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT001',amount:1,source_type:'LINE',status:'ACTIVE'}),/DRAFT/);
});
describe('Exact image duplication and another LINE user cannot create another transaction',()=>{
  images.set('2',Buffer.from('image-1'));const count=rowCount();
  assert.equal(image(2),undefined);assert.equal(rowCount(),count);
  answer(first.job_id,'kind','INCOME','UOTHER');assert.equal(rowCount(),count);
  const j=image(3);assert.equal(image(3),undefined);assert.equal(getJob(j.job_id).status,'READING');
  assert.throws(()=>request('finish',{job_id:j.job_id,nonce:'wrong',ai_response:{}}),/หมดอายุ/);
  assert.equal(rowCount(),count);
});
describe('Unreadable data, AI refusal, foreign currency and multiple receipts never auto-save',()=>{
  const count=rowCount(),j=image(4);finish(j,evidence({amount_confidence:.3,transaction_date:null}));
  assert.equal(data(j.job_id).question,'amount');
  send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id+' | ยอด=45.75'}}));
  assert.equal(data(j.job_id).question,'transaction_date');
  [evidence({currency:'USD'}),evidence({multiple_transactions:true}),evidence({is_receipt:false})].forEach((facts,i)=>{
    const next=image(10+i);finish(next,facts);assert.equal(getJob(next.job_id).status,'ERROR');
  });
  const refusal=image(15);request('finish',{job_id:refusal.job_id,nonce:refusal.nonce,ai_response:{status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]}});
  assert.equal(getJob(refusal.job_id).status,'ERROR');assert.equal(rowCount(),count);
  const fee=image(16);finish(fee,evidence({fee_amount:5}));assert.equal(data(fee.job_id).question,'amount');
});
describe('Company pool shortfalls are asked explicitly and stale consent is asked again',()=>{
  call('saveTransaction',{...base,transaction_date:'2026-10-01',transaction_type:'INCOME',amount:60,company_kind:'ADVANCE',company_funding:'POOL'});
  const j=image(20);finish(j,evidence({amount:100}));answer(j.job_id,'kind','COMPANY');answer(j.job_id,'account_id','ACC002');answer(j.job_id,'category_id','CAT008');
  const before=rowCount();answer(j.job_id,'company_funding','POOL');
  assert.equal(data(j.job_id).question,'company_expected_personal');assert.equal(data(j.job_id).expected_personal,40);assert.equal(rowCount(),before);
  call('saveTransaction',{...base,transaction_date:'2026-10-02',transaction_type:'EXPENSE',expense_owner:'COMPANY',category_id:'CAT008',company_funding:'POOL',amount:10});
  answer(j.job_id,'company_expected_personal',40);assert.equal(data(j.job_id).expected_personal,50);assert.equal(rowCount(),before+1);
  answer(j.job_id,'company_expected_personal',50);assert.equal(rowCount(),before+2);
  const tx=call('getTransaction',getJob(j.job_id).transaction_id);assert.equal(tx.company_funded_amount,50);
  assert.equal(call('getCompanySummary').pool.remaining,0);assert.equal(call('getCompanySummary').remaining,50);
});
describe('Reimbursement selection preserves unchecked claims and sends surplus only after a specific answer',()=>{
  const claims=call('getCompanySummary').claims.filter(c=>c.remaining_amount>0),selected=claims.find(c=>c.remaining_amount===50);
  const j=image(30);finish(j,evidence({amount:100.25}));answer(j.job_id,'kind','INCOME');answer(j.job_id,'account_id','ACC002');answer(j.job_id,'category_id','CAT004');
  assert.equal(data(j.job_id).question,'allocations');const before=rowCount();
  send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id+' | จับคู่='+selected.claim_id+':25.25'}}));
  assert.equal(data(j.job_id).question,'company_expected_pool');assert.equal(data(j.job_id).expected_pool,75);assert.equal(rowCount(),before);
  answer(j.job_id,'company_expected_pool',75);assert.equal(rowCount(),before+1);
  assert.equal(call('getCompanySummary').claims.find(c=>c.claim_id===selected.claim_id).remaining_amount,24.75);
  assert.equal(call('getCompanySummary').pool.remaining,75);
});
describe('A disabled auto-save switch keeps a complete item pending without changing money',()=>{
  props.set('N8N_AUTOSAVE_ENABLED','false');const j=image(40),before=rowCount();finish(j,evidence({amount:12.34}));
  answer(j.job_id,'kind','PERSONAL');answer(j.job_id,'account_id','ACC002');answer(j.job_id,'category_id','CAT008');
  assert.equal(data(j.job_id).question,'ready');assert.equal(rowCount(),before);props.set('N8N_AUTOSAVE_ENABLED','true');
  send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id}}));assert.equal(rowCount(),before+1);
});
describe('Interrupted commit recovery repairs the same transaction instead of adding cash twice',()=>{
  const j=image(50);finish(j,evidence({amount:11.11}));answer(j.job_id,'kind','PERSONAL');answer(j.job_id,'account_id','ACC002');
  const original=context.slipComplete_;context.slipComplete_=()=>{throw new Error('Simulated interruption after transaction append');};
  const before=rowCount();answer(j.job_id,'category_id','CAT008');assert.equal(rowCount(),before+1);
  context.slipComplete_=original;send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id}}));
  assert.equal(rowCount(),before+1);assert.equal(getJob(j.job_id).status,'SAVED');
});
describe('Reference checks are repeated at commit and receipt text cannot become a Sheet formula',()=>{
  const a=image(60),b=image(61),facts=evidence({amount:8.88,bank_reference:'BANKREF-TEST-123',payee:'=HYPERLINK("bad")'});
  finish(a,facts);finish(b,facts);assert.match(data(a.job_id).tx.description,/^'/);
  [a,b].forEach(j=>{answer(j.job_id,'kind','PERSONAL');answer(j.job_id,'account_id','ACC002');});
  const before=rowCount();answer(a.job_id,'category_id','CAT008');answer(b.job_id,'category_id','CAT008');
  assert.equal(rowCount(),before+1);assert.equal(getJob(b.job_id).status,'CANCELLED');
});
describe('Numbered partial reimbursement choices and cancelled image processing do not guess selections',()=>{
  const j=image(70);finish(j,evidence({amount:13.13}));answer(j.job_id,'kind','INCOME');answer(j.job_id,'account_id','ACC002');answer(j.job_id,'category_id','CAT004');
  assert.ok(data(j.job_id).claim_choices.length);assert.equal(data(j.job_id).question,'allocations');
  const before=rowCount();send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id+' | จับคู่=1:5.05'}}));
  assert.equal(data(j.job_id).allocations[0].claim_id,data(j.job_id).claim_choices[0].claim_id);
  assert.equal(data(j.job_id).expected_pool,8.08);assert.equal(rowCount(),before);
  const cancel=image(71);send(event({type:'message',message:{type:'text',text:'สลิป '+cancel.job_id+' | ยกเลิก=ใช่'}}));
  assert.equal(getJob(cancel.job_id).status,'CANCELLED');finish(cancel);assert.equal(rowCount(),before);
});
describe('Interrupted multi-claim matching resumes only the missing matches without another bank inflow',()=>{
  call('saveTransaction',{...base,transaction_date:'2026-10-19',transaction_type:'EXPENSE',expense_owner:'COMPANY',category_id:'CAT008',company_funding:'PERSONAL',amount:10});
  const claims=call('getCompanySummary').claims.filter(c=>c.remaining_amount>=5),j=image(80);
  finish(j,evidence({amount:20}));answer(j.job_id,'kind','INCOME');answer(j.job_id,'account_id','ACC002');answer(j.job_id,'category_id','CAT004');
  send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id+' | จับคู่='+claims[0].claim_id+':5,'+claims[1].claim_id+':5'}}));
  const add=context.addMatches_,before=rowCount(),cash=call('getDashboard').real_cash;
  context.addMatches_=(id,items)=>{add(id,[items[0]]);throw new Error('Simulated interrupted match write');};
  answer(j.job_id,'company_expected_pool',10);assert.equal(rowCount(),before+1);
  context.addMatches_=add;send(event({type:'message',message:{type:'text',text:'สลิป '+j.job_id}}));
  const txId=getJob(j.job_id).transaction_id,applied=call('matches_').filter(m=>m.reimbursement_transaction_id===txId&&m.status==='ACTIVE');
  assert.equal(applied.length,2);assert.equal(applied.reduce((sum,m)=>sum+m.amount,0),10);
  assert.equal(rowCount(),before+1);assert.equal(Math.round(call('getDashboard').real_cash*100),Math.round(cash*100)+2000);
  call('updateTransaction',txId,{allocations:[{claim_id:claims[0].claim_id,amount:4},{claim_id:claims[1].claim_id,amount:4}],
    company_surplus_to_pool:true,company_surplus_confirmed:true,company_expected_refund:8,company_expected_pool:12});
  const afterEdit=JSON.stringify(call('matches_'));finish(j);
  assert.equal(JSON.stringify(call('matches_')),afterEdit,'A late webhook must not restore matching amounts from before a manual edit');
});

async function workflowTests() {
  const {buildWorkflow,normalizeWebhook,buildRequests}=require('./n8n/build-workflow.cjs');
  const wf=buildWorkflow();assert.equal(wf.active,false);assert.equal(wf.nodes[0].parameters.options.rawBody,true);
  assert.equal(wf.nodes.filter(n=>n.credentials?.httpCustomAuth).length,2);
  assert.equal(wf.settings.saveDataSuccessExecution,'none');
  const raw=' { "events" : [] } ',AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,normalize=new AsyncFunction('$input',normalizeWebhook);
  const output=await normalize.call({helpers:{getBinaryDataBuffer:async()=>Buffer.from(raw)}},{first:()=>({binary:{data:{}},json:{headers:{'x-line-signature':'signature'}}})});
  assert.equal(output[0].json.raw_body,raw);
  await assert.rejects(()=>normalize({first:()=>({json:{body:{events:[]},headers:{}}})}),/Raw Body/);
  const make=new Function('$json',buildRequests);assert.equal(make({ok:true,jobs:[]}).length,0);
  const built=make({ok:true,jobs:[{job_id:'SLIP-TEST',nonce:'nonce',image_url:'data:image/jpeg;base64,eA=='}]});
  assert.equal(built[0].json.request.store,false);assert.equal(built[0].json.request.text.format.strict,true);
  assert.match(built[0].json.request.instructions,/Never select financial/);
  console.log('PASS Inactive n8n workflow preserves exact raw bytes, encrypted credentials, structured image requests and skips AI for text replies');
}
workflowTests().then(()=>console.log('All slip automation tests passed')).catch(error=>{console.error(error);process.exitCode=1;});
