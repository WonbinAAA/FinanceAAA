const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const schema = {
  'ผู้ใช้งาน': ['user_id','display_name','email','role','is_active','created_at'],
  'บัญชี': ['account_id','user_id','account_name','account_type','opening_balance','opening_date','is_active','note'],
  'รายการเงิน': ['transaction_id','user_id','transaction_date','transaction_type','account_id','to_account_id','category_id','amount','expense_owner','description','source_type','attachment_url','ai_status','status','created_at','updated_at','void_reason'],
  'หมวดหมู่': ['category_id','category_name','transaction_type','is_active','sort_order'],
  'หนี้สิน': ['debt_id','user_id','debt_name','debt_type','opening_balance','start_date','due_day','total_interest','status','note','due_amount'],
  'รายการหนี้': ['debt_transaction_id','debt_id','transaction_date','transaction_type','amount','account_id','linked_transaction_id','description','status','created_at','updated_at'],
  'เงินสำรองบริษัท': ['claim_id','user_id','transaction_id','expense_date','description','claim_amount','returned_amount','remaining_amount','status','created_at','updated_at'],
  'รายการประจำ': ['recurring_id','user_id','recurring_name','transaction_type','amount','frequency','due_day','account_id','category_id','expense_owner','start_date','end_date','is_active','note'],
  'ตั้งค่าระบบ': ['setting_key','setting_value','description_th','updated_at'],
  'ประวัติการแก้ไข': ['audit_id','user_id','record_type','record_id','action','field_name','old_value','new_value','change_source','reason','changed_at']
};
const readCounts = {};
class Range {
  constructor(sheet, row, column, height, width) { Object.assign(this, {sheet,row,column,height,width}); }
  getValues() { readCounts[this.sheet.name]=(readCounts[this.sheet.name]||0)+1;
    return Array.from({length:this.height}, (_,r) => Array.from({length:this.width}, (_,c) => this.sheet.data[this.row+r-1]?.[this.column+c-1] ?? '')); }
  setValues(values) { values.forEach((line,r) => line.forEach((value,c) => this.setAt(r,c,value))); return this; }
  setValue(value) { this.setAt(0,0,value); return this; }
  setAt(r,c,value) { const index=this.row+r-1; this.sheet.data[index] ||= []; this.sheet.data[index][this.column+c-1]=value; }
}
class Sheet {
  constructor(name,headers) { this.name=name; this.data=[headers.slice(),headers.map(() => '')]; }
  getLastRow() { let i=this.data.length; while(i>0 && !(this.data[i-1]||[]).some(v=>v!==''&&v!==null&&v!==undefined)) i--; return i; }
  getLastColumn() { return this.data[0].length; }
  getRange(row,column,height=1,width=1) { return new Range(this,row,column,height,width); }
  appendRow(values) { this.data.push(values.slice()); }
  setFrozenRows() {}
}
const sheets = Object.fromEntries(Object.entries(schema).map(([name,headers]) => [name,new Sheet(name,headers)]));
const book = { getSheetByName:name=>sheets[name]||null, getSheets:()=>Object.keys(sheets).map(name=>({getName:()=>name})),
  insertSheet:name=>(sheets[name]=new Sheet(name,[])), getName:()=> 'Personal Finance', getId:()=> 'YOUR_SPREADSHEET_ID' };
let serial = 0;
function formatDate(date,zone,format) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  const day=`${parts.year}-${parts.month}-${parts.day}`;
  return format==='yyyy-MM-dd' ? day : format==="yyyy-MM-dd'T'HH:mm:ss" ? `${day}T${parts.hour}:${parts.minute}:${parts.second}` : day;
}
const context = vm.createContext({
  Date,console,
  SpreadsheetApp:{openById:id=>{assert.equal(id,book.getId());return book;}},
  Utilities:{getUuid:()=>String(++serial).padStart(8,'0'),formatDate,
    base64Decode:value=>Array.from(Buffer.from(value,'base64')),
    base64Encode:bytes=>Buffer.from(bytes).toString('base64'),
    computeHmacSha256Signature:(message,key)=>Array.from(crypto.createHmac('sha256',key).update(message).digest()),
    computeDigest:(_,bytes)=>Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest()),
    DigestAlgorithm:{SHA_256:'SHA_256'},newBlob:(bytes,mime,name)=>({bytes,mime,name})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  Session:{getActiveUser:()=>({getEmail:()=>context.ocrActiveEmail||''}),
    getEffectiveUser:()=>({getEmail:()=> 'owner@example.com'})},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>context.ocrProperties.get(key)||null,
    setProperty:(key,value)=>context.ocrProperties.set(key,String(value))})},
  UrlFetchApp:{fetch:()=>{context.ocrFetchCount++;return context.ocrMockResponse;}},
  DriveApp:{createFile:()=>({getUrl:()=> 'https://drive.google.com/file/d/private-slip/view',setTrashed(){}})}
});
context.ContentService={MimeType:{JSON:'JSON'},createTextOutput:text=>({text,setMimeType(){return this;}})};
context.ocrProperties=new Map();
context.ocrFetchCount=0;
context.ocrMockResponse={getResponseCode:()=>200,getContentText:()=>JSON.stringify({responses:[{
  fullTextAnnotation:{text:'โอนเงินสำเร็จ\nจำนวนเงิน 123.45 บาท\nวันที่ 05/10/2569'}}]})};
vm.runInContext(fs.readFileSync('Code.gs','utf8'),context);
const call = (name,...args) => context[name](...args);
function seed(name, object) { sheets[name].appendRow(schema[name].map(key=>object[key]??'')); }
function test(name, fn) { fn(); console.log('PASS',name); }
const date='2026-09-28';
context.today_=()=> '2026-09-29';
const base={transaction_date:date,account_id:'ACC002',description:'ทดสอบ'};
seed('ผู้ใช้งาน',{user_id:'USR001',display_name:'เจ้าของบัญชี',role:'OWNER',is_active:true});
['เงินสด','กรุงไทย','กสิกร','MAKE','TrueMoney'].forEach((name,index)=>seed('บัญชี',{account_id:`ACC00${index+1}`,user_id:'USR001',account_name:name,account_type:'BANK',opening_balance:0,is_active:true}));
[['CAT001','เงินเดือน','INCOME'],['CAT003','เบี้ยเลี้ยง','INCOME'],['CAT004','เงินคืนบริษัท','INCOME'],
 ['CAT008','อาหาร/เครื่องดื่ม','EXPENSE'],['CAT021','ดอกเบี้ย','EXPENSE'],['CAT022','ชำระหนี้','EXPENSE']]
  .forEach(([category_id,category_name,transaction_type],index)=>seed('หมวดหมู่',{category_id,category_name,transaction_type,is_active:true,sort_order:index+1}));
seed('รายการเงิน',{transaction_id:'TX-OLD',user_id:'USR001',transaction_date:new Date('2026-09-28T06:00:00+07:00'),transaction_type:'INCOME',account_id:'ACC002',category_id:'CAT001',amount:1000,description:'จากชีต',status:'ACTIVE',created_at:new Date('2026-09-28T06:01:00+07:00')});

test('Connection and Google Sheet → WebApp date conversion',()=>{
  assert.equal(call('getConnectionStatus').ok,true);
  const bootstrap=call('getBootstrap');
  assert.equal(bootstrap.dashboard.real_cash,1000);
  assert.equal(bootstrap.latestTransactions[0].transaction_date,date);
  assert.equal(typeof bootstrap.latestTransactions[0].created_at,'string');
  assert.doesNotThrow(()=>JSON.stringify(bootstrap));
});
test('Income and personal expense',()=>{
  call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT001',amount:100});
  const expense=call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:'CAT008',expense_owner:'PERSONAL',amount:50});
  assert.equal(call('getDashboard').income,1100);
  assert.equal(call('getDashboard').personal_expense,50);
  assert.equal(call('getDashboard').real_cash,1050);
  assert.equal(call('getDashboard').opening_total,0);
  assert.equal(call('getDashboard').cash_inflow,1100);
  assert.equal(call('getDashboard').cash_outflow,50);
  assert.equal(call('getDashboard').opening_total+call('getDashboard').cash_inflow-call('getDashboard').cash_outflow,1050);
  context.personalExpenseId=expense.id;
});
test('Edit transaction, audit and Dashboard recalculation',()=>{
  call('updateTransaction',context.personalExpenseId,{amount:75});
  assert.equal(call('getDashboard').personal_expense,75);
  assert.equal(call('getDashboard').real_cash,1025);
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('UPDATE')&&row.includes('amount')));
});
test('VOID restores balance and remains visible',()=>{
  call('voidTransaction',context.personalExpenseId,'แก้รายการ');
  assert.equal(call('getDashboard').personal_expense,0);
  assert.equal(call('getTransaction',context.personalExpenseId).status,'VOID');
  assert.ok(call('getTransactions',{}).some(item=>item.transaction_id===context.personalExpenseId));
});
test('Transfer changes account balances but no income/expense',()=>{
  const before=call('getDashboard');
  call('saveTransaction',{...base,transaction_type:'TRANSFER',to_account_id:'ACC001',amount:200});
  const after=call('getDashboard');
  assert.equal(after.real_cash,before.real_cash);
  assert.equal(after.income,before.income);
  assert.equal(after.personal_expense,before.personal_expense);
  assert.equal(after.balances.ACC001,200);
});
test('Available cash uses selected accounts and handles cross-group transfers',()=>{
  const before=call('getDashboard');
  assert.equal(before.available_cash,(before.balances.ACC001||0)+(before.balances.ACC002||0));
  const moved=call('saveTransaction',{...base,transaction_type:'TRANSFER',account_id:'ACC002',to_account_id:'ACC003',amount:15});
  const after=call('getDashboard');
  assert.equal(after.real_cash,before.real_cash);
  assert.equal(after.available_cash,before.available_cash-15);
  assert.equal(after.available_opening+after.available_inflow-after.available_outflow,after.available_cash);
  call('setAccountAvailable','ACC003',true);
  assert.equal(call('getDashboard').available_cash,before.available_cash);
  assert.equal(call('getBootstrap').accounts.find(a=>a.account_id==='ACC003').include_in_available,true);
  call('setAccountAvailable','ACC003',false);
  assert.equal(call('getDashboard').available_cash,before.available_cash-15);
  call('voidTransaction',moved.id,'ทดสอบยอดพร้อมใช้');
  assert.equal(call('getDashboard').available_cash,before.available_cash);
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('include_in_available')));
});
test('Company expense and receivable',()=>{
  call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:'CAT008',expense_owner:'COMPANY',amount:200,description:'บริษัท A'});
  call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:'CAT008',expense_owner:'COMPANY',amount:50,description:'บริษัท B'});
  assert.equal(call('getCompanySummary').remaining,250);
  assert.equal(call('getDashboard').company_expense,250);
});
test('Partial reimbursement, FIFO and manual matching',()=>{
  const claims=call('getCompanySummary').claims;
  const preview=call('getReimbursementPreview',80);
  assert.equal(preview.length,1);
  assert.equal(preview[0].claim_id,claims[0].claim_id);
  const first=call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT004',amount:80});
  assert.equal(call('getCompanySummary').remaining,170);
  assert.equal(call('getDashboard').income,1100);
  const second=call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT004',amount:60,
    allocations:[{claim_id:claims[1].claim_id,amount:50},{claim_id:claims[0].claim_id,amount:10}]});
  assert.equal(call('getCompanySummary').remaining,110);
  assert.equal(call('getCompanySummary').returned,140);
  call('voidTransaction',second.id,'ทดสอบ');
  assert.equal(call('getCompanySummary').remaining,170);
  context.refundId=first.id;
});
test('Debt increase and payment without duplicate expense',()=>{
  const debt=call('createDebt',{debt_name:'Shopee',opening_balance:300,due_day:15,due_amount:100,start_date:date});
  const debtId=debt.debts[0].debt_id;
  assert.equal(debt.debts[0].default_due_amount,0);
  assert.equal(debt.debts[0].monthly_dues[0].due_month,'2026-09');
  call('increaseDebt',{debt_id:debtId,amount:100,transaction_date:date});
  assert.equal(call('getDashboard').debt_balance,400);
  const before=call('getDashboard');
  const paid=call('payDebt',{debt_id:debtId,amount:80,account_id:'ACC002',transaction_date:date});
  assert.equal(call('getDashboard').debt_balance,320);
  assert.equal(call('getDebts').find(item=>item.debt_id===debtId).due_amount,20);
  assert.equal(call('getDashboard').real_cash,before.real_cash-80);
  assert.equal(call('getDashboard').personal_expense,before.personal_expense);
  const paymentId=paid.id;
  call('voidTransaction',paymentId,'ย้อนชำระ');
  assert.equal(call('getDashboard').debt_balance,400);
  assert.equal(call('getDashboard').real_cash,before.real_cash);
  assert.equal(call('getDebts').find(item=>item.debt_id===debtId).due_amount,100);
});
test('Debt rename preserves balances and writes audit history',()=>{
  const created=call('createDebt',{debt_name:'Shopee ยืม',opening_balance:240,due_day:12,due_amount:80,start_date:date});
  const debt=created.debts.find(item=>item.debt_name==='Shopee ยืม');
  const before=call('getDashboard'),auditBefore=sheets['ประวัติการแก้ไข'].getLastRow();
  const result=call('renameDebt',{debt_id:debt.debt_id,debt_name:' SEasyCash '});
  assert.equal(result.debts.find(item=>item.debt_id===debt.debt_id).debt_name,'SEasyCash');
  assert.equal(call('getDashboard').real_cash,before.real_cash);
  assert.equal(call('getDashboard').debt_balance,before.debt_balance);
  assert.equal(call('getDebts').find(item=>item.debt_id===debt.debt_id).due_amount,80);
  assert.equal(sheets['ประวัติการแก้ไข'].getLastRow(),auditBefore+1);
  const audit=call('rows_','ประวัติการแก้ไข').at(-1);
  assert.equal(audit.field_name,'debt_name');
  assert.equal(audit.old_value,'Shopee ยืม');
  assert.equal(audit.new_value,'SEasyCash');
  call('renameDebt',{debt_id:debt.debt_id,debt_name:'SEasyCash'});
  assert.equal(sheets['ประวัติการแก้ไข'].getLastRow(),auditBefore+1);
  assert.throws(()=>call('renameDebt',{debt_id:debt.debt_id,debt_name:'  '}));
});
test('Editable monthly debt due does not move cash',()=>{
  const created=call('createDebt',{debt_name:'TikTok',opening_balance:300,due_day:15,due_amount:0,start_date:date});
  const id=created.debts.find(item=>item.debt_name==='TikTok').debt_id;
  assert.equal(call('getDebts').find(item=>item.debt_id===id).needs_due,true);
  const cashBefore=call('getDashboard').real_cash,debtBefore=call('getDashboard').debt_balance;
  call('setDebtMonthlyDue',{debt_id:id,due_month:'2026-09',amount:100});
  assert.equal(call('getDebts').find(item=>item.debt_id===id).due_amount,100);
  assert.equal(call('getDebts').find(item=>item.debt_id===id).needs_due,false);
  assert.equal(call('getDashboard').real_cash,cashBefore);
  assert.equal(call('getDashboard').debt_balance,debtBefore);
  assert.throws(()=>call('setDebtMonthlyDue',{debt_id:id,due_month:'2026-09',amount:301}),/เกินหนี้/);
  const paid=call('payDebt',{debt_id:id,amount:30,account_id:'ACC002',transaction_date:date});
  assert.equal(call('getDebts').find(item=>item.debt_id===id).due_amount,70);
  call('setDebtMonthlyDue',{debt_id:id,due_month:'2026-09',amount:90});
  assert.equal(call('getDebts').find(item=>item.debt_id===id).due_amount,90);
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('DEBT_PLAN')&&row.includes('VOID')));
  call('voidTransaction',paid.id,'ทดสอบย้อนชำระ');
  assert.equal(call('getDebts').find(item=>item.debt_id===id).due_amount,120);
});
test('Monthly debt due is independent between months and old plan rows remain',()=>{
  const originalToday=context.today_;
  try {
    context.today_=()=> '2026-10-10';
    assert.equal(call('getDebts').find(item=>item.debt_name==='Shopee').due_amount,0);
    const debt=call('getDebts').find(item=>item.debt_name==='TikTok');
    assert.equal(debt.due_amount,0);
    const cashBefore=call('getDashboard').real_cash;
    call('setDebtMonthlyDue',{debt_id:debt.debt_id,due_month:'2026-10',amount:120});
    assert.equal(call('getDebts').find(item=>item.debt_id===debt.debt_id).due_amount,120);
    assert.equal(call('getDebts').find(item=>item.debt_id===debt.debt_id).monthly_dues.at(-1).amount,120);
    assert.equal(call('getDashboard').real_cash,cashBefore);
    assert.ok(call('rows_','แผนชำระหนี้').some(item=>item.due_month==='2026-09'&&item.status==='ACTIVE'));
  } finally { context.today_=originalToday; }
});
test('Debt balance adjustment preserves account cash and audit history',()=>{
  const debt=call('getDebts').find(item=>item.debt_name==='TikTok');
  const cash=call('getDashboard').real_cash,expense=call('getDashboard').personal_expense;
  call('adjustDebtBalance',{debt_id:debt.debt_id,balance:250,transaction_date:date,reason:'ตรวจยอดจริง'});
  assert.equal(call('getDebts').find(item=>item.debt_id===debt.debt_id).balance,250);
  assert.equal(call('getDashboard').real_cash,cash);
  assert.equal(call('getDashboard').personal_expense,expense);
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('ADJUST')&&row.includes('balance')));
  assert.throws(()=>call('adjustDebtBalance',{debt_id:debt.debt_id,balance:200,transaction_date:date}),/เหตุผล/);
});
test('Recurring payment creates actual transaction only after confirmation',()=>{
  const before=call('getDashboard').real_cash;
  const recurring=call('createRecurring',{recurring_name:'ค่าอินเทอร์เน็ต',transaction_type:'EXPENSE',category_id:'CAT008',
    expense_owner:'PERSONAL',due_day:28,amount:100,account_id:'ACC002',start_date:date,icon_key:'home'});
  assert.equal(call('getDashboard').real_cash,before);
  const id=recurring.recurring[0].recurring_id;
  assert.equal(recurring.recurring[0].icon_key,'home');
  assert.throws(()=>call('createRecurring',{recurring_name:'ไอคอนไม่ถูกต้อง',transaction_type:'EXPENSE',category_id:'CAT008',
    expense_owner:'PERSONAL',due_day:28,amount:10,account_id:'ACC002',start_date:date,icon_key:'unknown'}),/ไอคอน/);
  call('payRecurring',{recurring_id:id,amount:120,account_id:'ACC002',transaction_date:date});
  assert.equal(call('getDashboard').real_cash,before-120);
  assert.equal(call('getRecurringDue')[0].paid_this_month,true);
});
test('Recurring schedule remains visible when the due day precedes its start date',()=>{
  const before=call('getDashboard').real_cash;
  const created=call('createRecurring',{recurring_name:'ให้แม่',transaction_type:'EXPENSE',category_id:'CAT008',
    expense_owner:'PERSONAL',due_day:5,amount:2000,account_id:'ACC002',start_date:date});
  const item=created.recurring.find(row=>row.recurring_name==='ให้แม่');
  assert.ok(item);
  assert.equal(item.next_due,'2026-10-05');
  assert.equal(call('getDashboard').real_cash,before);
  assert.ok(call('getBootstrap').recurring.some(row=>row.recurring_id===item.recurring_id));
  call('deactivateRecurring',item.recurring_id);
  assert.ok(!call('getRecurringDue').some(row=>row.recurring_id===item.recurring_id));
  assert.equal(call('getDashboard').real_cash,before);
});
test('DRAFT from IMPORT has no balance effect until confirmed',()=>{
  const before=call('getDashboard').real_cash;
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT001',amount:25,source_type:'IMPORT',status:'ACTIVE'}));
  const draft=call('saveTransaction',{...base,transaction_type:'INCOME',category_id:'CAT001',amount:25,source_type:'IMPORT',status:'DRAFT',attachment_url:'https://example.test/slip',ai_status:'PENDING'});
  assert.equal(call('getDashboard').real_cash,before);
  call('confirmDraft',draft.id,{});
  assert.equal(call('getDashboard').real_cash,before+25);
  assert.equal(call('getTransaction',draft.id).source_type,'IMPORT');
});
test('Dashboard bootstrap reads each sheet once and sees later Sheet edits',()=>{
  Object.keys(readCounts).forEach(key=>delete readCounts[key]);
  const before=call('getBootstrap').dashboard.real_cash;
  assert.equal(readCounts['รายการเงิน'],2);
  assert.equal(readCounts['หมวดหมู่'],2);
  seed('รายการเงิน',{transaction_id:'TX-CACHE',user_id:'USR001',transaction_date:date,
    transaction_type:'INCOME',account_id:'ACC002',category_id:'CAT001',amount:7,status:'ACTIVE'});
  assert.equal(call('getBootstrap').dashboard.real_cash,before+7);
});
test('Filters, Sheet → WebApp recalculation and mobile UI structure',()=>{
  assert.ok(call('getTransactions',{month:'2026-09',type:'INCOME',query:'จากชีต'}).some(item=>item.transaction_id==='TX-OLD'));
  assert.ok(call('getTransactions',{month:'2026-10',date:'2026-09-28',type:'INCOME',query:'จากชีต'}).some(item=>item.transaction_id==='TX-OLD'));
  const before=call('getBootstrap').dashboard.real_cash;
  seed('รายการเงิน',{transaction_id:'TX-EXTERNAL',user_id:'USR001',transaction_date:date,transaction_type:'INCOME',account_id:'ACC002',category_id:'CAT001',amount:9,status:'ACTIVE'});
  assert.equal(call('getBootstrap').dashboard.real_cash,before+9);
  const html=fs.readFileSync('Index.html','utf8'), css=fs.readFileSync('CSS.html','utf8');
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/id="pageTransactions"/);
  assert.match(html,/id="pageRecurring"/);
  assert.match(html,/id="debtDueTotal"/);
  assert.match(html,/id="debtAdjustedBalance"/);
  assert.match(html,/id="debtDueTarget"/);
  assert.match(html,/id="filterDate"/);
  assert.doesNotMatch(html,/id="debtPlanRows"|เลือกประเภทรายการก่อน/);
  assert.match(html,/id="debtRenameName"/);
  assert.match(html,/value="SEasyCash"/);
  assert.match(html,/value="SPayLater"/);
  const script=fs.readFileSync('JavaScript.html','utf8');
  assert.match(script,/function debtIcon\(name\)/);
  assert.match(script,/data-action="rename"/);
  assert.match(css,/row-icon\.debt-shopee/);
  assert.match(css,/max-width:540px/);
  assert.match(css,/safe-area-inset-bottom/);
});
test('Category add, rename, hide, restore, history and protected rules',()=>{
  const created=call('createCategory',{category_name:'  ค่า เดินทาง  ',transaction_type:'EXPENSE'});
  const id=created.id;
  assert.equal(call('getCategories').find(c=>c.category_id===id).category_name,'ค่า เดินทาง');
  assert.throws(()=>call('createCategory',{category_name:'ค่า เดินทาง',transaction_type:'EXPENSE'}));
  const categories=call('getCategories');
  assert.equal(categories.find(c=>c.category_id==='CAT004').is_system,true);
  assert.equal(categories.find(c=>c.category_id==='CAT022').is_system,true);
  assert.equal(categories.find(c=>c.category_id==='CAT003').is_system,false);
  assert.equal(categories.find(c=>c.category_id==='CAT021').is_system,false);
  assert.throws(()=>call('renameCategory','CAT004','ชื่อใหม่'));
  assert.throws(()=>call('setCategoryActive','CAT022',false));
  call('renameCategory','CAT003','เบี้ยเลี้ยงพิเศษ');
  call('setCategoryActive','CAT021',false);
  call('renameCategory',id,'ค่าเดินทางประจำวัน');
  const tx=call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:id,
    expense_owner:'PERSONAL',amount:12});
  const recurring=call('createRecurring',{recurring_name:'เดินทาง',transaction_type:'EXPENSE',category_id:id,
    expense_owner:'PERSONAL',due_day:28,amount:12,account_id:'ACC002',start_date:date});
  assert.throws(()=>call('setCategoryActive',id,false),/รายการประจำ/);
  call('deactivateRecurring',recurring.recurring.find(r=>r.recurring_name==='เดินทาง').recurring_id);
  const before=call('getDashboard');
  call('setCategoryActive',id,false);
  assert.equal(call('getDashboard').real_cash,before.real_cash);
  assert.equal(call('getDashboard').personal_expense,before.personal_expense);
  assert.ok(!call('getBootstrap').categories.some(c=>c.category_id===id));
  assert.ok(call('getBootstrap').filterCategories.some(c=>c.category_id===id));
  assert.equal(call('getTransactions',{}).find(t=>t.transaction_id===tx.id).category_name,'ค่าเดินทางประจำวัน');
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:id,
    expense_owner:'PERSONAL',amount:1}),/หยุดใช้งาน/);
  call('updateTransaction',tx.id,{description:'แก้รายละเอียดเดิม'});
  call('setCategoryActive',id,true);
  assert.ok(call('getBootstrap').categories.some(c=>c.category_id===id));
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('CATEGORY')&&row.includes('DEACTIVATE')));
  const html=fs.readFileSync('Index.html','utf8');
  assert.match(html,/id="categoryDialog"/);
  assert.match(html,/openCategoryDialog\('filter'\)/);
  assert.match(html,/openCategoryDialog\('entry'\)/);
});
test('Expense category order changes without changing balances',()=>{
  const before=call('getDashboard');
  const original=call('getCategories').filter(c=>c.transaction_type==='EXPENSE'&&c.is_active&&!c.is_system).map(c=>c.category_id);
  const first=original[0],second=original[1];
  call('moveCategory',second,'UP','EXPENSE');
  const moved=call('getCategories').filter(c=>c.transaction_type==='EXPENSE'&&c.is_active&&!c.is_system).map(c=>c.category_id);
  assert.equal(moved[0],second);
  assert.equal(moved[1],first);
  assert.equal(call('getBootstrap').categories.filter(c=>c.transaction_type==='EXPENSE')[0].category_id,second);
  const last=moved.at(-1);
  call('moveCategory',last,'TOP','EXPENSE');
  assert.equal(call('getBootstrap').categories.filter(c=>c.transaction_type==='EXPENSE')[0].category_id,last);
  assert.equal(call('getCategories').filter(c=>c.transaction_type==='EXPENSE'&&c.is_active&&!c.is_system)[1].category_id,second);
  assert.equal(call('sortedCategories_', [{category_id:'A',sort_order:1},{category_id:'B',sort_order:0}])[0].category_id,'B');
  assert.equal(call('getDashboard').real_cash,before.real_cash);
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('sort_order')));
});
test('Separate company categories preserve balances, history and recurring payments',()=>{
  const personal=call('createCategory',{category_name:'ค่าน้ำมัน',transaction_type:'EXPENSE',category_group:'EXPENSE'});
  const office=call('createCategory',{category_name:'ค่าน้ำมัน',transaction_type:'EXPENSE',category_group:'OFFICE'});
  assert.equal(sheets['หมวดหมู่'].data[0].at(-1),'category_group');
  assert.equal(call('getCategories').find(c=>c.category_id===office.id).category_group,'OFFICE');
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'EXPENSE',expense_owner:'PERSONAL',category_id:office.id,amount:1}),/กลุ่ม/);
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'EXPENSE',expense_owner:'COMPANY',category_id:personal.id,amount:1}),/กลุ่ม/);
  const before=call('getDashboard');
  const tx=call('saveTransaction',{...base,transaction_type:'EXPENSE',expense_owner:'COMPANY',category_id:office.id,amount:25});
  assert.equal(call('getDashboard').real_cash,before.real_cash-25);
  assert.equal(call('getCompanySummary').remaining,before.company_receivable+25);
  call('updateCategory',office.id,{category_name:'ค่าน้ำมันบริษัท',category_group:'EXPENSE'});
  assert.equal(call('getDashboard').real_cash,before.real_cash-25);
  assert.equal(call('getTransactions',{}).find(item=>item.transaction_id===tx.id).category_name,'ค่าน้ำมันบริษัท');
  assert.doesNotThrow(()=>call('updateTransaction',tx.id,{description:'รายการเก่าหลังย้ายหมวด'}));
  assert.throws(()=>call('saveTransaction',{...base,transaction_type:'EXPENSE',expense_owner:'COMPANY',category_id:office.id,amount:1}),/กลุ่ม/);
  const recurring=call('createRecurring',{recurring_name:'ค่าน้ำมันประจำ',transaction_type:'EXPENSE',category_id:personal.id,
    expense_owner:'PERSONAL',due_day:28,amount:5,account_id:'ACC002',start_date:date});
  call('updateCategory',personal.id,{category_name:'ค่าน้ำมันเดิม',category_group:'OFFICE'});
  const recurringId=recurring.recurring.find(item=>item.recurring_name==='ค่าน้ำมันประจำ').recurring_id;
  call('payRecurring',{recurring_id:recurringId,amount:5,account_id:'ACC002',transaction_date:date});
  assert.equal(call('rows_','รายการเงิน').find(item=>item.recurring_id===recurringId).expense_owner,'PERSONAL');
  assert.ok(sheets['ประวัติการแก้ไข'].data.some(row=>row.includes('category_group')&&row.includes('OFFICE')));
  assert.equal(call('getBootstrap').categories.find(c=>c.category_id===personal.id).category_group,'OFFICE');
});
test('Transaction save Sheet read count',()=>{
  Object.keys(readCounts).forEach(key=>delete readCounts[key]);
  const before=call('getDashboard');
  Object.keys(readCounts).forEach(key=>delete readCounts[key]);
  const result=call('saveTransaction',{...base,transaction_type:'EXPENSE',category_id:'CAT008',expense_owner:'PERSONAL',amount:1});
  const reads=Object.values(readCounts).reduce((sum,count)=>sum+count,0);
  assert.ok(reads<=20,`บันทึกรายการอ่าน Sheet ${reads} ครั้ง`);
  assert.equal(result.dashboard.real_cash,before.real_cash-1);
  assert.equal(call('getTransaction',result.id).status,'ACTIVE');
  assert.ok(Array.isArray(result.latestTransactions)&&result.latestTransactions.length>0);
  assert.ok(result.company&&result.debts&&result.recurring);
  console.log('SAVE_SHEET_READS',reads,JSON.stringify(readCounts));
});
test('LINE drafts, authentication, duplicate events and explicit confirmation',()=>{
  context.ocrProperties.set('LINE_ALLOWED_USER_IDS','UOWNER');
  context.ocrProperties.set('LINE_BRIDGE_SECRET','bridge-test-secret');
  let eventNumber=0;
  const event=(text,userId='UOWNER')=>({type:'message',webhookEventId:`EVENT-${++eventNumber}`,
    source:{type:'user',userId},message:{type:'text',text}});
  const before=call('getDashboard');
  const expense=event('จ่าย | 12.50 | อาหาร/เครื่องดื่ม | กรุงไทย | ส่วนตัว | มื้อเที่ยง');
  const created=call('lineHandleEvent_',expense);
  assert.match(created.reply,/สร้างฉบับร่างแล้ว/);
  const id=created.reply.match(/TX-[A-Z0-9]{8}/)[0];
  assert.equal(call('getTransaction',id).status,'DRAFT');
  assert.equal(call('getDashboard').real_cash,before.real_cash);
  assert.equal(call('lineHandleEvent_',expense).reply.includes('ร่างเดิม'),true);
  assert.equal(call('rows_','รายการเงิน').filter(t=>t.line_event_id===expense.webhookEventId).length,1);
  assert.equal(call('lineHandleEvent_',event(`ยืนยัน ${id}`,'UOTHER')).ok,false);
  context.ocrProperties.set('LINE_ALLOWED_USER_IDS','UOWNER,UOTHER');
  assert.match(call('lineHandleEvent_',event(`ยืนยัน ${id}`,'UOTHER')).reply,/ไม่พบร่าง LINE ของคุณ/);
  assert.throws(()=>call('confirmDraft',id,{}),/ผ่าน LINE/);
  assert.match(call('lineHandleEvent_',event('ร่าง')).reply,new RegExp(id));
  assert.match(call('lineHandleEvent_',event(`ยืนยัน ${id}`)).reply,/ยืนยันและบันทึกยอดแล้ว/);
  assert.equal(call('getTransaction',id).status,'ACTIVE');
  assert.equal(call('getDashboard').real_cash,before.real_cash-12.5);
  assert.match(call('lineHandleEvent_',event(`ยืนยัน ${id}`)).reply,/ยืนยันไปแล้ว/);
  assert.equal(call('getDashboard').real_cash,before.real_cash-12.5);
  assert.equal(call('lineHandleEvent_',event('รับ | 1.234 | เงินเดือน | กรุงไทย | ผิด')).reply.includes('ทศนิยม'),true);
  assert.equal(call('lineHandleEvent_',event('จ่าย | 1 | อาหาร/เครื่องดื่ม | กรุงไทย | ไม่ทราบ | ผิด')).reply.includes('เจ้าของ'),true);
  const company=call('lineHandleEvent_',event('จ่าย | 25 | อาหาร/เครื่องดื่ม | กรุงไทย | บริษัท | งานลูกค้า'));
  const companyId=company.reply.match(/TX-[A-Z0-9]{8}/)[0];
  const due=call('getCompanySummary').remaining;
  call('lineHandleEvent_',event(`ยืนยัน ${companyId}`));
  assert.equal(call('getCompanySummary').remaining,due+25);
  const transfer=call('lineHandleEvent_',event('โอน | 3 | กรุงไทย | เงินสด | ถอนเงิน'));
  const transferId=transfer.reply.match(/TX-[A-Z0-9]{8}/)[0];
  const cash=call('getDashboard').real_cash;
  call('lineHandleEvent_',event(`ยืนยัน ${transferId}`));
  assert.equal(call('getDashboard').real_cash,cash);
  const refund=call('lineHandleEvent_',event('รับ | 5 | เงินคืนบริษัท | กรุงไทย | คืนบางส่วน'));
  const refundId=refund.reply.match(/TX-[A-Z0-9]{8}/)[0];
  assert.match(refund.reply,/จับคู่เงินคืน/);
  const refundsBefore=call('getCompanySummary').remaining;
  call('lineHandleEvent_',event(`ยืนยัน ${refundId}`));
  assert.equal(call('getCompanySummary').remaining,refundsBefore-5);
  assert.ok(call('rows_','ประวัติการแก้ไข').some(a=>a.record_id===id&&a.action==='CONFIRM'&&a.change_source==='LINE'));
  const firstClaimId=call('getReimbursementPreview',1)[0].claim_id;
  const firstRemaining=call('getCompanySummary').claims.find(c=>c.claim_id===firstClaimId).remaining_amount;
  const stale=call('lineHandleEvent_',event(`รับ | ${firstRemaining} | เงินคืนบริษัท | กรุงไทย | ร่างที่ยอดเปลี่ยน`));
  const staleId=stale.reply.match(/TX-[A-Z0-9]{8}/)[0];
  const newer=call('lineHandleEvent_',event('รับ | 1 | เงินคืนบริษัท | กรุงไทย | ยืนยันก่อน'));
  const newerId=newer.reply.match(/TX-[A-Z0-9]{8}/)[0];
  call('lineHandleEvent_',event(`ยืนยัน ${newerId}`));
  assert.match(call('lineHandleEvent_',event(`ยืนยัน ${staleId}`)).reply,/ยอดจับคู่เงินคืนเปลี่ยน/);
  assert.equal(call('getTransaction',staleId).status,'DRAFT');
  const payload=JSON.stringify(event('ช่วยเหลือ'));
  const timestamp=Date.now();
  const signature=crypto.createHmac('sha256','bridge-test-secret').update(`${timestamp}\n${payload}`).digest('base64');
  const request={postData:{contents:JSON.stringify({timestamp,payload,signature})}};
  assert.equal(JSON.parse(call('doPost',request).text).ok,true);
  request.postData.contents=JSON.stringify({timestamp,payload,signature:'bad'});
  assert.equal(JSON.parse(call('doPost',request).text).ok,false);
  request.postData.contents=JSON.stringify({timestamp:timestamp-600000,payload,
    signature:crypto.createHmac('sha256','bridge-test-secret').update(`${timestamp-600000}\n${payload}`).digest('base64')});
  assert.equal(JSON.parse(call('doPost',request).text).ok,false);
});
assert.equal(call('reconcileDatabase').ok,true);
async function testFrontendSaveNavigation() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={};
  const element=id=>elements[id] ||= {value:'',disabled:false,textContent:'',close(){},classList:{toggle(){},add(){},remove(){}}};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("BOOT={today:'2026-09-28',accounts:[],recurring:[]}",ui);
  const visited=[],notices=[];
  ui.formTransaction=()=>({amount:10,status:'ACTIVE'});
  ui.server=async()=>({dashboard:{},latestTransactions:[],debts:[],recurring:[]});
  ui.renderMutation=()=>{};
  ui.renderDebts=()=>{};
  ui.renderRecurring=()=>{};
  ui.closeEntryDialog=()=>{};
  ui.showPage=name=>visited.push(name);
  let refreshes=0;
  ui.refreshAll=async()=>{refreshes++;return true;};
  ui.notify=(icon,title)=>{notices.push({icon,title});return Promise.resolve();};
  ui.fail=error=>{throw error;};
  await ui.saveCurrentTransaction();
  await ui.submitDebtDialog();
  vm.runInContext("recurringMode='create'",ui);
  await ui.submitRecurringDialog();
  assert.deepEqual(visited,['Dashboard','Dashboard','Dashboard']);
  assert.equal(refreshes,0);
  assert.equal(notices.filter(item=>item.icon==='success').length,3);
  console.log('PASS Save forms return to Dashboard and notify success');
}
function testMutationSnapshotRendering() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const ui=vm.createContext({console,window:{},document:{getElementById:()=>({})},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext('BOOT={accounts:[],dashboard:{}}',ui);
  const rendered=[];
  ['renderDashboard','renderAccounts','renderLatest','renderCompany','renderDebts','renderRecurring']
    .forEach(name=>ui[name]=()=>rendered.push(name));
  const result={dashboard:{real_cash:42,balances:{}},latestTransactions:[],company:{remaining:3},debts:[],recurring:[]};
  ui.renderMutation(result);
  assert.deepEqual(rendered,['renderDashboard','renderAccounts','renderLatest','renderCompany','renderDebts','renderRecurring']);
  assert.equal(vm.runInContext('BOOT.dashboard.real_cash',ui),42);
  assert.equal(vm.runInContext('BOOT.company.remaining',ui),3);
  ui.renderMutation({recurring:[]});
  assert.equal(rendered.at(-1),'renderRecurring');
  console.log('PASS Mutation snapshot updates every affected view without another bootstrap');
}
function testFreshOnlyStartup() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={};
  const element=id=>elements[id] ||= {textContent:'',classList:{toggle(){},add(){},remove(){}}};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  ui.notify=()=>Promise.resolve();
  assert.equal(ui.requireFreshData(),false);
  vm.runInContext('dataReady=true',ui);
  assert.equal(ui.requireFreshData(),true);
  assert.doesNotMatch(source,/readCachedDashboard|renderCachedDashboard|cacheDashboard/);
  console.log('PASS Startup waits for fresh Sheet data without showing old cache');
}
function testCompanyProjectField() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const storage=new Map(),elements={};
  const element=id=>elements[id] ||= {value:'',checked:false,innerHTML:'',classList:{toggle(){},add(){},remove(){}}};
  const ui=vm.createContext({console,window:{localStorage:{
    getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)
  }},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("BOOT={categories:[{category_id:'CAT010',category_name:'น้ำมัน',transaction_type:'EXPENSE'}]}",ui);
  assert.equal(ui.recentProjects().length,0);
  element('owner').value='COMPANY';
  element('projectName').value='ติดตั้งเครื่อง คปภ.';
  element('category').value='CAT010';
  element('description').value='เติมน้ำมันรถ';
  assert.equal(element('owner').value,'COMPANY');
  assert.equal(ui.formTransaction().description,'ติดตั้งเครื่อง คปภ. | เติมน้ำมันรถ');
  ui.rememberProject(element('projectName').value);
  ui.fillRecentProjects();
  assert.equal(element('projectName').value,'');
  assert.match(element('recentProjects').innerHTML,/ติดตั้งเครื่อง คปภ\./);
  element('projectName').value='ติดตั้งเครื่อง คปภ.';
  element('description').value='เติมแก๊ส';
  assert.equal(ui.formTransaction().description,'ติดตั้งเครื่อง คปภ. | เติมแก๊ส');
  vm.runInContext("selectedTx={transaction_id:'TX-EDIT'}",ui);
  element('description').value='ติดตั้งเครื่อง คปภ. | เติมแก๊ส';
  assert.equal(ui.formTransaction().description,'ติดตั้งเครื่อง คปภ. | เติมแก๊ส');
  const html=fs.readFileSync('Index.html','utf8');
  assert.doesNotMatch(html,/applyProjectShortcut|project-shortcuts/);
  console.log('PASS Company project stays optional and category selection remains independent');
}
function testEntryAndTransactionViews() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={};
  const element=id=>elements[id] ||= {value:'',innerHTML:'',textContent:'',classList:{toggle(name,hidden){this[name]=hidden;},add(name){this[name]=true;}}};
  const entryButtons=['PERSONAL','COMPANY','INCOME','TRANSFER'].map(entryKind=>({dataset:{entryKind},classList:{toggle(){}},setAttribute(){}}));
  const viewButtons=['all','personal','company','income','transfer'].map(view=>({dataset:{view},setAttribute(){}}));
  const ui=vm.createContext({console,window:{},document:{getElementById:element,
    querySelectorAll:selector=>selector==='.type-switch button'?entryButtons:viewButtons},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("BOOT={categories:[{category_id:'CAT008',category_name:'อาหาร',transaction_type:'EXPENSE'},{category_id:'CAT001',category_name:'เงินเดือน',transaction_type:'INCOME'}]}",ui);
  ui.loadTransactions=()=>{};
  ui.selectType('EXPENSE','COMPANY');
  assert.equal(element('owner').value,'COMPANY');
  assert.equal(element('categoryLabel').textContent,'ประเภทรายจ่าย');
  assert.equal(element('projectShortcutField').classList.hidden,false);
  element('projectName').value='ติดตั้งเครื่อง คปภ.';
  element('description').value='เติมน้ำมัน';
  assert.equal(ui.formTransaction().description,'ติดตั้งเครื่อง คปภ. | เติมน้ำมัน');
  ui.selectType('EXPENSE','PERSONAL');
  assert.equal(element('projectShortcutField').classList.hidden,true);
  assert.equal(ui.formTransaction().description,'เติมน้ำมัน');
  ui.selectType('INCOME');
  assert.equal(element('projectShortcutField').classList.hidden,true);
  assert.equal(element('categoryLabel').textContent,'ประเภทรายรับ');
  ui.selectTransactionView('company');
  assert.equal(ui.currentFilters().type,'EXPENSE');
  assert.equal(ui.currentFilters().owner,'COMPANY');
  ui.selectTransactionView('income');
  assert.equal(ui.currentFilters().type,'INCOME');
  assert.equal(ui.currentFilters().owner,'');
  assert.match(element('filterCategory').innerHTML,/เงินเดือน/);
  assert.doesNotMatch(element('filterCategory').innerHTML,/อาหาร/);
  const html=fs.readFileSync('Index.html','utf8');
  assert.match(html,/data-view="personal"/);
  assert.match(html,/data-view="company"/);
  assert.match(html,/data-entry-kind="COMPANY"/);
  assert.match(html,/class="secondary category-manage-button category-add-button"[^>]*>\+<\/button>/);
  assert.match(html,/id="draftField" class="hidden"/);
  assert.match(html,/id="accountPickerDialog"/);
  assert.doesNotMatch(html,/เลือกประเภทรายการก่อน/);
  console.log('PASS Company-only projects and separate entry/list views');
}
function testFrontendCategoryGroupsAndCancel() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={};
  const element=id=>elements[id] ||= {value:'',innerHTML:'',textContent:'',disabled:false,open:false,
    classList:{toggle(){},add(){},remove(){}},close(){this.open=false;}};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("BOOT={categories:[{category_id:'P',category_name:'ส่วนตัว',transaction_type:'EXPENSE',category_group:'EXPENSE'},{category_id:'O',category_name:'บริษัท',transaction_type:'EXPENSE',category_group:'OFFICE'},{category_id:'B',category_name:'เดิม',transaction_type:'EXPENSE',category_group:'BOTH'}],filterCategories:[]}",ui);
  element('owner').value='PERSONAL';
  ui.fillCategories('EXPENSE');
  assert.match(element('category').innerHTML,/ส่วนตัว/);
  assert.doesNotMatch(element('category').innerHTML,/บริษัท/);
  vm.runInContext("BOOT.categories=[BOOT.categories[2],BOOT.categories[0],BOOT.categories[1]]",ui);
  ui.fillCategories('EXPENSE');
  assert.ok(element('category').innerHTML.indexOf('เดิม')<element('category').innerHTML.indexOf('ส่วนตัว'));
  element('owner').value='COMPANY';
  ui.fillCategories('EXPENSE');
  assert.match(element('category').innerHTML,/บริษัท/);
  assert.match(element('category').innerHTML,/เดิม/);
  assert.doesNotMatch(element('category').innerHTML,/ส่วนตัว/);
  element('recurringType').value='EXPENSE';element('recurringOwner').value='COMPANY';
  element('recurringOwner').parentElement={classList:{toggle(){}}};
  ui.fillRecurringCategories();
  assert.doesNotMatch(element('recurringCategory').innerHTML,/ส่วนตัว/);
  ui.renderRecurring([{recurring_id:'REC1',recurring_name:'ค่าเช่า',icon_key:'home',next_due:'2026-10-05',amount:100,paid_this_month:false}]);
  assert.match(element('recurringList').innerHTML,/#icon-home/);
  element('entryDialog').open=true;
  ui.notify=()=>{throw new Error('Cancellation must not display SweetAlert');};
  ui.cancelDialog('entryDialog');
  assert.equal(element('entryDialog').open,false);
  console.log('PASS Category groups in forms and quiet cancellation');
}
function testAccountViewToggle() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={};
  const element=id=>elements[id] ||= {innerHTML:'',textContent:'',title:'',disabled:true,attributes:{},hidden:false,
    setAttribute(name,value){this.attributes[name]=value;},
    classList:{toggle(name,hidden){if(name==='hidden') element(id).hidden=hidden;}}};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  const accounts=[
    {account_id:'ACC001',account_name:'เงินสด',account_type:'CASH',include_in_available:true},
    {account_id:'ACC002',account_name:'กรุงไทย',account_type:'BANK',include_in_available:true},
    {account_id:'ACC003',account_name:'กสิกร',account_type:'BANK',include_in_available:false}
  ];
  const balances={ACC001:10.10,ACC002:20.20,ACC003:30.30};
  ui.testAccounts=accounts;ui.testBalances=balances;
  vm.runInContext('BOOT={accounts:testAccounts,dashboard:{available_cash:30.30,real_cash:60.60,balances:testBalances}}',ui);
  ui.renderAccounts(accounts,balances);
  assert.match(element('accountList').innerHTML,/กรุงไทย/);
  assert.doesNotMatch(element('accountList').innerHTML,/กสิกร/);
  assert.equal(element('accountTotal').hidden,true);
  ui.toggleAccountView();
  assert.match(element('accountList').innerHTML,/กสิกร/);
  assert.equal(element('accountTotalValue').textContent,'฿60.60');
  assert.equal(element('accountViewToggle').attributes['aria-pressed'],'true');
  assert.equal(element('accountViewIcon').attributes.href,'#icon-eye-off');
  ui.renderAccounts(accounts,{ACC001:10.10,ACC002:20.20,ACC003:40.30});
  assert.equal(element('accountTotalValue').textContent,'฿70.60');
  ui.toggleAccountView();
  assert.doesNotMatch(element('accountList').innerHTML,/กสิกร/);
  assert.equal(element('accountTotal').hidden,true);
  assert.equal(vm.runInContext('BOOT.dashboard.available_cash',ui),30.30);
  console.log('PASS Account view toggle shows all account balances without changing available cash');
}
test('Monthly debt plans survive Sheet date conversion and other creditor edits',()=>{
  const originalToday=context.today_;
  try {
    context.today_=()=> '2026-10-03';
    const tiktok=call('createDebt',{debt_name:'TikTok ผ่อน regression',opening_balance:3000,due_day:5,start_date:date})
      .debts.find(item=>item.debt_name==='TikTok ผ่อน regression').debt_id;
    const line=call('createDebt',{debt_name:'LINE BK regression',opening_balance:2000,due_day:10,start_date:date})
      .debts.find(item=>item.debt_name==='LINE BK regression').debt_id;
    call('payDebt',{debt_id:tiktok,amount:200,account_id:'ACC002',transaction_date:'2026-10-02'});
    call('setDebtMonthlyDue',{debt_id:tiktok,due_month:'2026-10',amount:1000});
    const planSheet=sheets['แผนชำระหนี้'];
    const tiktokRow=planSheet.data.find(row=>row[1]===tiktok&&row[4]==='ACTIVE');
    tiktokRow[2]=new Date('2026-10-01T00:00:00+07:00');
    assert.equal(call('getBootstrap').debts.find(item=>item.debt_id===tiktok).due_amount,1000);
    const first=call('setDebtMonthlyDue',{debt_id:line,due_month:'2026-10',amount:500});
    assert.equal(first.debts.find(item=>item.debt_id===tiktok).due_amount,1000);
    const oldLinePlan=planSheet.data.find(row=>row[1]===line&&row[4]==='ACTIVE');
    oldLinePlan[2]=new Date('2026-10-01T00:00:00+07:00');
    const second=call('setDebtMonthlyDue',{debt_id:line,due_month:'2026-10',amount:700});
    assert.equal(oldLinePlan[4],'VOID');
    assert.equal(second.debts.find(item=>item.debt_id===tiktok).due_amount,1000);
    assert.equal(second.debts.find(item=>item.debt_id===line).due_amount,700);
    assert.equal(call('getBootstrap').debts.find(item=>item.debt_id===tiktok).due_amount,1000);
    assert.equal(call('getBootstrap').debts.find(item=>item.debt_id===line).due_amount,700);
  } finally { context.today_=originalToday; }
});
test('Project advances, existing income, allowances, transfers and funding integrity',()=>{
  const tx=(kind,project,amount,extra={})=>call('saveTransaction',{
    ...base,transaction_date:'2026-10-14',status:'ACTIVE',source_type:'WEB',
    transaction_type:['ADVANCE','MOVE'].includes(kind)?'INCOME':'EXPENSE',expense_owner:'COMPANY',
    company_kind:kind,project_name:project,amount,category_id:kind.endsWith('ALLOWANCE')?'CAT003':'',...extra
  });
  // Use an expense category that is valid for company costs.
  const expenseCategory=call('getCategories').find(c=>c.transaction_type==='EXPENSE'&&call('categoryFits_',c,'EXPENSE','COMPANY')&&c.is_active!==false);
  const before=call('getDashboard');
  const income=call('saveTransaction',{...base,transaction_date:'2026-10-14',transaction_type:'INCOME',category_id:'CAT001',amount:5000});
  const withIncome=call('getDashboard');
  call('reclassifyCompanyAdvance',income.id,'ทดสอบ A');
  assert.equal(call('getDashboard').real_cash,withIncome.real_cash);
  assert.equal(call('getDashboard').income,before.income);
  assert.throws(()=>call('reclassifyCompanyAdvance',income.id,'ทดสอบ A'),/รายรับทั่วไป/);
  const expense=tx('','ทดสอบ A',1200,{category_id:expenseCategory.category_id});
  const claim=call('getCompanySummary').claims.find(c=>c.transaction_id===expense.id);
  assert.equal(claim.advance_used,1200);assert.equal(claim.remaining_amount,0);
  const cash=call('getDashboard').real_cash;
  const self=tx('SELF_ALLOWANCE','ทดสอบ A',500,{category_id:expenseCategory.category_id,recipient:'ตัวเอง'});
  assert.equal(call('getDashboard').real_cash,cash);
  assert.equal(call('getDashboard').income,before.income+500);
  tx('OTHER_ALLOWANCE','ทดสอบ A',300,{category_id:expenseCategory.category_id,recipient:'ช่างสมชาย'});
  assert.equal(call('getDashboard').real_cash,cash-300);
  assert.throws(()=>tx('OTHER_ALLOWANCE','ทดสอบ A',100,{category_id:expenseCategory.category_id}),/ผู้รับ/);
  assert.throws(()=>tx('SELF_ALLOWANCE','ทดสอบ A',4000,{category_id:expenseCategory.category_id}),/เพียงพอ/);
  assert.throws(()=>tx('MOVE','ทดสอบ A',100,{to_project:'ทดสอบ B'}),/ต้นทางจบ/);
  const move=tx('MOVE','ทดสอบ A',1000,{to_project:'ทดสอบ B',project_finished:true});
  assert.equal(call('getDashboard').real_cash,cash-300);
  let projects=call('getCompanySummary').projects;
  assert.equal(projects.find(p=>p.project_name==='ทดสอบ A').remaining,2000);
  assert.equal(projects.find(p=>p.project_name==='ทดสอบ B').remaining,1000);
  const b=tx('','ทดสอบ B',1300,{category_id:expenseCategory.category_id});
  assert.equal(call('getCompanySummary').claims.find(c=>c.transaction_id===b.id).remaining_amount,300);
  const bClaim=call('getCompanySummary').claims.find(c=>c.transaction_id===b.id);
  call('saveTransaction',{...base,transaction_date:'2026-10-14',transaction_type:'INCOME',category_id:'CAT004',amount:300,allocations:[{claim_id:bClaim.claim_id,amount:300}]});
  assert.throws(()=>tx('ADVANCE','ทดสอบ B',300,{transaction_date:'2026-10-13'}),/จับคู่/);
  assert.throws(()=>call('voidTransaction',income.id,'ทดสอบ'),/เพียงพอ|เงินล่วงหน้า/);
  const beforeReturn=call('getDashboard');
  tx('RETURN','ทดสอบ A',500);
  assert.equal(call('getDashboard').real_cash,beforeReturn.real_cash-500);
  assert.equal(call('getDashboard').personal_expense,beforeReturn.personal_expense);
  assert.equal(call('getDashboard').company_expense,beforeReturn.company_expense);
  assert.equal(call('getDashboard').net_position,beforeReturn.net_position);
  assert.equal(call('getCompanySummary').projects.find(p=>p.project_name==='ทดสอบ A').remaining,1500);
  assert.throws(()=>tx('RETURN','ทดสอบ A',1600),/ไม่พอ/);
  call('voidTransaction',self.id,'ยกเลิกเบี้ยเลี้ยง');
  assert.equal(call('getDashboard').income,before.income);
  assert.equal(call('getCompanySummary').projects.find(p=>p.project_name==='ทดสอบ A').remaining,2000);
  const draft=tx('ADVANCE','ร่าง',700,{status:'DRAFT'});
  assert.equal(call('getCompanySummary').projects.some(p=>p.project_name==='ร่าง'),false);
  call('confirmDraft',draft.id,{});
  assert.equal(call('getCompanySummary').projects.find(p=>p.project_name==='ร่าง').remaining,700);
});

test('Company pool receives surplus once and expenses require explicit funding consent',()=>{
  const snapshot=Object.fromEntries(Object.entries(sheets).map(([name,s])=>[name,s.data.map(r=>r.slice())]));
  try {
    Object.values(sheets).forEach(s=>{s.data=s.data.slice(0,2);});
    seed('บัญชี',{account_id:'ACC002',user_id:'USR001',account_name:'กรุงไทย',opening_balance:0,is_active:true});
    seed('หมวดหมู่',{category_id:'EXP',category_name:'อุปกรณ์',transaction_type:'EXPENSE',is_active:true});
    seed('หมวดหมู่',{category_id:'REF',category_name:'เงินคืนบริษัท',transaction_type:'INCOME',is_active:true});
    const expense=(amount,extra={})=>({...base,transaction_date:'2026-10-01',transaction_type:'EXPENSE',category_id:'EXP',expense_owner:'COMPANY',amount,...extra});
    call('saveTransaction',expense(600,{company_funding:'PERSONAL'}));
    call('saveTransaction',expense(200.25,{company_funding:'PERSONAL'}));
    const review=call('getCompanyReceiptPreview',1000);
    assert.equal(review.refund_amount,800.25);assert.equal(review.pool_amount,199.75);
    const receipt={...base,transaction_date:'2026-10-02',transaction_type:'INCOME',category_id:'REF',amount:1000,company_surplus_to_pool:true};
    const before=call('getDashboard');
    assert.throws(()=>call('saveTransaction',{...receipt,company_surplus_confirmed:true,company_expected_refund:800,company_expected_pool:200}),/เปลี่ยน/);
    assert.throws(()=>call('saveTransaction',receipt),/ยืนยัน/);
    assert.equal(call('getDashboard').real_cash,before.real_cash);
    const paid=call('saveTransaction',{...receipt,company_surplus_confirmed:true,company_expected_refund:800.25,company_expected_pool:199.75});
    assert.equal(call('getDashboard').real_cash,before.real_cash+1000);
    assert.equal(call('getDashboard').income,0);
    assert.equal(call('getCompanySummary').remaining,0);
    assert.equal(call('getCompanySummary').pool.remaining,199.75);
    assert.equal(call('getTransaction',paid.id).company_pool_amount,199.75);
    const poolExpense=expense(250,{transaction_date:'2026-10-03',company_funding:'POOL'});
    const preview=call('getCompanyFundingPreview',poolExpense);
    assert.equal(preview.funded_amount,199.75);assert.equal(preview.personal_amount,50.25);
    assert.throws(()=>call('saveTransaction',poolExpense),/ขาด 50.25/);
    assert.equal(call('getCompanySummary').pool.remaining,199.75);
    const cost=call('saveTransaction',{...poolExpense,company_shortfall_confirmed:true,company_expected_personal:50.25});
    assert.equal(call('getCompanySummary').pool.remaining,0);
    assert.equal(call('getCompanySummary').remaining,50.25);
    assert.equal(call('getTransaction',cost.id).company_funded_amount,199.75);
    assert.throws(()=>call('voidTransaction',paid.id,'คืนรายการ'),/ไม่เพียงพอ/);
    // Receiving more funds later does not erase the personal portion already approved.
    call('saveTransaction',{...base,transaction_date:'2026-10-04',transaction_type:'INCOME',company_kind:'ADVANCE',company_funding:'POOL',amount:100});
    assert.equal(call('getCompanySummary').remaining,50.25);
    call('saveTransaction',expense(20,{transaction_date:'2026-10-05',company_funding:'PERSONAL'}));
    assert.equal(call('getCompanySummary').pool.remaining,100);
    assert.equal(call('getCompanySummary').remaining,70.25);
    const rejected=expense(150,{transaction_date:'2026-10-05',company_funding:'POOL',company_shortfall_confirmed:true,company_expected_personal:49});
    assert.throws(()=>call('saveTransaction',rejected),/เปลี่ยน/);
    assert.equal(call('getCompanySummary').pool.remaining,100);
    call('saveTransaction',{...base,transaction_date:'2026-10-06',transaction_type:'INCOME',company_kind:'ADVANCE',company_funding:'PROJECT',project_name:'งานทดสอบ',amount:80});
    call('saveTransaction',expense(30,{transaction_date:'2026-10-06',company_funding:'PROJECT',project_name:'งานทดสอบ'}));
    assert.equal(call('getCompanySummary').pool.remaining,100);
    assert.equal(call('getCompanySummary').projects.find(p=>p.project_name==='งานทดสอบ').remaining,50);
    const centsReceipt={...receipt,transaction_date:'2026-10-07',amount:70.50,company_surplus_confirmed:true,company_expected_refund:70.25,company_expected_pool:.25};
    call('saveTransaction',centsReceipt);
    assert.equal(call('getCompanySummary').pool.remaining,100.25);
    assert.equal(call('getCompanySummary').remaining,0);
    const allPool=call('getCompanyReceiptPreview',10);
    assert.equal(allPool.refund_amount,0);assert.equal(allPool.pool_amount,10);
    call('saveTransaction',{...receipt,transaction_date:'2026-10-08',amount:10,company_surplus_confirmed:true,company_expected_refund:0,company_expected_pool:10});
    assert.equal(call('getCompanySummary').pool.remaining,110.25);
    // Moving/returning money changes only the chosen wallet; no mixed receipt duplicates cash.
    const cash=call('getDashboard').real_cash;
    const move=call('saveTransaction',{...base,transaction_date:'2026-10-09',transaction_type:'INCOME',company_kind:'MOVE',company_funding:'POOL',to_project:'งานทดสอบ',amount:10});
    assert.equal(call('getDashboard').real_cash,cash);
    assert.equal(call('getCompanySummary').pool.remaining,100.25);
    call('voidTransaction',move.id,'ทดสอบ');
    assert.equal(call('getCompanySummary').pool.remaining,110.25);
    assert.throws(()=>call('saveTransaction',{...base,transaction_date:'2026-10-09',transaction_type:'INCOME',company_kind:'MOVE',company_funding:'POOL',to_project:'กองกลางบริษัท',amount:1}),/ต่างกัน/);
    const ownCash=call('getDashboard').real_cash;
    const own=call('saveTransaction',expense(20,{transaction_date:'2026-10-10',company_kind:'SELF_ALLOWANCE',company_funding:'POOL'}));
    assert.equal(call('getDashboard').income,20);assert.equal(call('getDashboard').real_cash,ownCash);
    assert.equal(call('getCompanySummary').pool.remaining,90.25);
    call('voidTransaction',own.id,'ทดสอบ');
    assert.equal(call('getCompanySummary').pool.remaining,110.25);
    const poolBeforeReturn=call('getDashboard');
    call('saveTransaction',expense(.25,{transaction_date:'2026-10-11',company_kind:'RETURN',company_funding:'POOL'}));
    assert.equal(call('getCompanySummary').pool.remaining,110);
    assert.equal(call('getDashboard').real_cash,poolBeforeReturn.real_cash-.25);
    assert.equal(call('getDashboard').personal_expense,poolBeforeReturn.personal_expense);
    const draft=call('saveTransaction',{...base,transaction_date:'2026-10-12',transaction_type:'INCOME',company_kind:'ADVANCE',company_funding:'POOL',amount:5,status:'DRAFT'});
    assert.equal(call('getCompanySummary').pool.remaining,110);
    call('confirmDraft',draft.id,{});
    assert.equal(call('getCompanySummary').pool.remaining,115);
  } finally {
    Object.keys(sheets).forEach(name=>{if(snapshot[name]) sheets[name].data=snapshot[name];else delete sheets[name];});
  }
});

test('Selected company receipts leave unchecked claims open and support partial returns',()=>{
  const snapshot=Object.fromEntries(Object.entries(sheets).map(([name,s])=>[name,s.data.map(r=>r.slice())]));
  try {
    Object.values(sheets).forEach(s=>{s.data=s.data.slice(0,2);});
    seed('บัญชี',{account_id:'ACC002',user_id:'USR001',account_name:'บัญชีทดสอบ',opening_balance:0,is_active:true});
    seed('หมวดหมู่',{category_id:'EXP',category_name:'อุปกรณ์',transaction_type:'EXPENSE',is_active:true});
    seed('หมวดหมู่',{category_id:'REF',category_name:'เงินคืนบริษัท',transaction_type:'INCOME',is_active:true});
    [125,300.55,200].forEach(amount=>call('saveTransaction',{...base,transaction_date:'2026-10-01',transaction_type:'EXPENSE',category_id:'EXP',expense_owner:'COMPANY',company_funding:'PERSONAL',amount}));
    const claims=call('getCompanySummary').claims,ids=claims.map(c=>c.claim_id);
    const items=[{claim_id:ids[1],amount:300.55},{claim_id:ids[2],amount:75}];
    const unselected=call('getCompanyReceiptPreview',800,'',[]);
    assert.equal(unselected.claims.length,3);assert.equal(unselected.refund_amount,0);assert.equal(unselected.pool_amount,800);
    const review=call('getCompanyReceiptPreview',800,'',items);
    assert.equal(review.refund_amount,375.55);assert.equal(review.pool_amount,424.45);
    assert.throws(()=>call('getCompanyReceiptPreview',300,'',items),/เกินเงินที่ได้รับ/);
    assert.throws(()=>call('getCompanyReceiptPreview',800,'',[items[0],items[0]]),/ไม่ถูกต้อง/);
    assert.throws(()=>call('getCompanyReceiptPreview',800,'',[{claim_id:ids[0],amount:126}]),/เกินยอดค้าง/);
    assert.throws(()=>call('getCompanyReceiptPreview',800,'',[{claim_id:'unknown',amount:1}]),/ไม่ถูกต้อง/);
    [-1,0,1.001].forEach(amount=>assert.throws(()=>call('getCompanyReceiptPreview',800,'',[{claim_id:ids[0],amount}])));
    const receipt={...base,transaction_date:'2026-10-02',transaction_type:'INCOME',category_id:'REF',amount:800,company_surplus_to_pool:true,
      allocations:items,company_surplus_confirmed:true,company_expected_refund:375.55,company_expected_pool:424.45};
    const before=call('getDashboard'),paid=call('saveTransaction',receipt),summary=call('getCompanySummary');
    assert.equal(summary.claims.find(c=>c.claim_id===ids[0]).remaining_amount,125);
    assert.equal(summary.claims.find(c=>c.claim_id===ids[1]).status,'CLOSED');
    assert.equal(summary.claims.find(c=>c.claim_id===ids[2]).remaining_amount,125);
    assert.equal(summary.claims.find(c=>c.claim_id===ids[2]).status,'PARTIAL');
    assert.equal(summary.remaining,250);assert.equal(summary.pool.remaining,424.45);
    assert.equal(Math.round(call('getDashboard').real_cash*100),Math.round(before.real_cash*100)+80000);assert.equal(call('getDashboard').income,before.income);
    const edit=call('getCompanyReceiptPreview',800,paid.id,items);
    assert.equal(edit.refund_amount,375.55);assert.equal(edit.existing_allocations.length,2);assert.equal(edit.claims.length,3);
    // A stale selection cannot pay an already-closed claim, and no failed save creates a transaction.
    const rowsBefore=sheets['รายการเงิน'].getLastRow();
    assert.throws(()=>call('saveTransaction',receipt),/เกินยอดค้าง/);
    assert.equal(sheets['รายการเงิน'].getLastRow(),rowsBefore);
    call('voidTransaction',paid.id,'ยกเลิกข้อมูลทดสอบ');
    assert.equal(call('getCompanySummary').remaining,625.55);assert.equal(call('getCompanySummary').pool.remaining,0);
    const poolOnly=call('saveTransaction',{...receipt,allocations:[],company_expected_refund:0,company_expected_pool:800});
    assert.equal(call('getCompanySummary').remaining,625.55);assert.equal(call('getCompanySummary').pool.remaining,800);
    call('voidTransaction',poolOnly.id,'ยกเลิกข้อมูลทดสอบ');
    const exact=call('saveTransaction',{...receipt,amount:75,allocations:[{claim_id:ids[2],amount:75}],company_expected_refund:75,company_expected_pool:0});
    assert.equal(call('getCompanySummary').remaining,550.55);assert.equal(call('getCompanySummary').pool.remaining,0);
    call('updateTransaction',exact.id,{amount:50,company_surplus_to_pool:true,allocations:[{claim_id:ids[2],amount:50}],company_expected_refund:50,company_expected_pool:0});
    assert.equal(call('getCompanySummary').remaining,575.55);
  } finally {
    Object.keys(sheets).forEach(name=>{if(snapshot[name]) sheets[name].data=snapshot[name];else delete sheets[name];});
  }
});

test('Dialog scroll lock retains background position through nested dialogs',()=>{
  const source=fs.readFileSync('JavaScript.html','utf8');
  const start=source.indexOf('function installDialogScrollLock()');
  const end=source.indexOf("document.addEventListener('click'",start);
  let openCount=0,callback;
  const classes=new Set(),style={position:'',top:'',left:'',width:''},scrollCalls=[];
  const ui=vm.createContext({document:{body:{style},querySelector:()=>openCount?{}:null,
    documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}},
    window:{scrollX:0,scrollY:240,scrollTo:(x,y)=>scrollCalls.push([x,y])},
    MutationObserver:class{constructor(fn){callback=fn;}observe(){}}});
  vm.runInContext(source.slice(start,end),ui);ui.installDialogScrollLock();
  assert.equal(style.position,'');
  openCount=1;callback();assert.equal(style.position,'fixed');assert.equal(style.top,'-240px');
  ui.window.scrollY=0;openCount=2;callback();assert.equal(style.top,'-240px');
  openCount=1;callback();assert.equal(style.position,'fixed');assert.equal(scrollCalls.length,0);
  openCount=0;callback();assert.equal(style.position,'');assert.equal(classes.size,0);
  assert.deepEqual(scrollCalls,[[0,240]]);
});

async function testRefundFormRecovery() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={},inputs=[],checks=[];
  const element=id=>elements[id] ||= {value:'',checked:false,disabled:false,innerHTML:'',textContent:'',classList:{toggle(){},add(){},remove(){}},querySelectorAll:selector=>selector==='input[data-refund-claim]'?checks:inputs};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("selectedType='INCOME';BOOT={categories:[{category_id:'REFUND',category_name:'เงินคืนบริษัท'}],company:{remaining:100,claims:[{claim_id:'LEGACY',expense_date:'2026-10-01',description:'ไม่มีโปรเจกต์'}]}}",ui);
  element('category').value='REFUND';element('amount').value='100';
  ui.toggleRefundField();assert.match(element('refundBalanceHint').textContent,/100\.00/);
  let finish;
  ui.server=()=>new Promise(resolve=>{finish=resolve;});
  const pending=ui.previewRefund();
  element('amount').value='50';ui.clearRefundPreview();
  finish({refund_amount:100,pool_amount:0,remaining:100,allocations:[{claim_id:'LEGACY',amount:100}]});await pending;
  assert.equal(element('refundMatches').innerHTML,'');
  assert.equal(element('refundPreviewButton').disabled,false);
  ui.server=async()=>{throw new Error('ยอดเงินคืน 150.00 บาท เกินยอดที่บริษัทค้างคืน 100.00 บาท');};
  element('amount').value='150';await ui.previewRefund();
  assert.match(element('refundFeedback').textContent,/150\.00.*100\.00/);
  assert.equal(element('refundMatches').innerHTML,'');
  assert.equal(element('refundPreviewButton').disabled,false);
  element('amount').value='100';
  ui.server=async(name,amount,id,selected)=>{
    assert.equal(selected.length,0);
    return {refund_amount:0,pool_amount:100,remaining:100,allocations:[],claims:[{claim_id:'LEGACY',remaining_amount:100,expense_date:'2026-10-01',description:'ข้อมูลล่าสุด'}]};
  };await ui.previewRefund();
  assert.match(element('refundMatches').innerHTML,/รายการทั่วไป · ไม่มีโปรเจกต์/);
  assert.match(element('refundMatches').innerHTML,/ข้อมูลล่าสุด/);
  assert.doesNotMatch(element('refundMatches').innerHTML,/ checked/);
  inputs.push({dataset:{claim:'LEGACY'},value:'100'},{dataset:{claim:'SKIP'},value:'0'});
  checks.push({dataset:{refundClaim:'LEGACY'},checked:false},{dataset:{refundClaim:'SKIP'},checked:false});
  ui.updateRefundSelection();assert.equal(inputs[0].disabled,true);assert.equal(ui.formTransaction().allocations.length,0);
  checks[0].checked=true;ui.updateRefundSelection();assert.equal(inputs[0].disabled,false);
  const tx=ui.formTransaction();
  assert.equal(tx.project_name,'');assert.equal(tx.allocations.length,1);assert.equal(tx.allocations[0].amount,100);
  inputs[0].value='30.25';ui.updateRefundSelection();assert.equal(ui.formTransaction().allocations[0].amount,30.25);
  assert.match(element('refundFeedback').textContent,/30\.25.*69\.75.*69\.75/);
  inputs[0].value='101';assert.throws(()=>ui.formTransaction(),/เกินยอดค้าง/);
  inputs[0].value='0';assert.throws(()=>ui.formTransaction(),/มากกว่า 0/);
  inputs[0].value='1.001';assert.throws(()=>ui.formTransaction(),/ทศนิยม/);
  inputs[0].value='80';element('amount').value='60';
  vm.runInContext('refundAmountAtPreview=60',ui);assert.throws(()=>ui.formTransaction(),/เกินเงินที่ได้รับ/);
  element('amount').value='50';ui.clearRefundPreview();
  assert.equal(ui.formTransaction().allocations,undefined);
  console.log('PASS Refund form shows legacy claims, persistent errors and discards stale previews');
}

async function testCompanyConsentUI() {
  const source=fs.readFileSync('JavaScript.html','utf8');
  const body=source.slice(source.indexOf('<script>')+8,source.indexOf("document.addEventListener('click'"));
  const elements={},element=id=>elements[id] ||= {value:'',disabled:false,textContent:'',classList:{toggle(){},add(){},remove(){}}};
  const ui=vm.createContext({console,window:{},document:{getElementById:element},setTimeout,clearTimeout});
  vm.runInContext(body,ui);
  vm.runInContext("selectedType='INCOME';BOOT={categories:[{category_id:'REF',category_name:'เงินคืนบริษัท'}]}",ui);
  element('category').value='REF';
  let writes=0,posted,confirm=false;
  const receipt={amount:100,status:'ACTIVE',transaction_type:'INCOME',category_id:'REF',company_surplus_to_pool:true,allocations:[{claim_id:'chosen',amount:60}]};
  ui.formTransaction=()=>({...receipt});
  ui.server=async(name,...args)=>{
    if(name==='getCompanyReceiptPreview') {assert.equal(args[2][0].claim_id,'chosen');return {refund_amount:60,pool_amount:40};}
    if(name==='getCompanyFundingPreview') return {funded_amount:10,personal_amount:20};
    if(name==='saveTransaction') {writes++;posted=args[0];return {};}
    throw new Error('Unexpected server call '+name);
  };
  ui.sweet=async()=>({isConfirmed:confirm});
  ui.renderMutation=()=>{};ui.closeEntryDialog=()=>{};ui.showPage=()=>{};ui.notify=()=>{};ui.rememberProject=()=>{};
  ui.fail=error=>{throw error;};
  await ui.saveCurrentTransaction();assert.equal(writes,0);assert.equal(element('saveButton').disabled,false);
  confirm=true;await ui.saveCurrentTransaction();assert.equal(writes,1);assert.equal(posted.company_expected_pool,40);assert.equal(posted.company_surplus_confirmed,true);
  let previews=0;ui.previewRefund=async()=>{previews++;};
  ui.formTransaction=()=>({...receipt,allocations:undefined});await ui.saveCurrentTransaction();assert.equal(previews,1);assert.equal(writes,1);
  vm.runInContext("selectedType='EXPENSE'",ui);element('owner').value='COMPANY';
  ui.formTransaction=()=>({amount:30,status:'ACTIVE',transaction_type:'EXPENSE',expense_owner:'COMPANY',company_funding:'POOL'});
  confirm=false;await ui.saveCurrentTransaction();assert.equal(writes,1);
  confirm=true;await ui.saveCurrentTransaction();assert.equal(writes,2);assert.equal(posted.company_shortfall_confirmed,true);assert.equal(posted.company_expected_personal,20);
  console.log('PASS Surplus and personal shortfall confirmation can be cancelled without writing');
}

testFrontendSaveNavigation().then(testRefundFormRecovery).then(testCompanyConsentUI).then(()=>{
  testMutationSnapshotRendering();
  testFreshOnlyStartup();
  testCompanyProjectField();
  testEntryAndTransactionViews();
  testFrontendCategoryGroupsAndCancel();
  testAccountViewToggle();
  console.log('All finance regression tests passed');
}).catch(error=>{
  console.error(error);process.exitCode=1;
});
