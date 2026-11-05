import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function view(){const context=vm.createContext({Intl,Date});vm.runInContext(readFileSync(new URL('../public/ledger-view.js',import.meta.url),'utf8'),context);return context;}
test('category icons match food, drinks, travel and other meanings without changing transaction amounts',()=>{
 const v=view();
 for(const [label,kind]of [['ข้าวเช้า','food'],['ข้าวเย็น','food'],['ของกินเล่น','food'],['กาแฟ/คาเฟ่','drink'],['เดินทาง','transport'],['น้ำมัน','fuel'],['โทรศัพท์/อินเทอร์เน็ต','phone'],['สุขภาพ','health'],['ช้อปปิ้ง','shopping'],['ชำระหนี้','finance'],['บันเทิง','entertainment'],['ของขวัญ','gift'],['เบี้ยเลี้ยง','allowance']]){
  const row={category_name:label,transaction_type:'EXPENSE',amount:12.34};assert.equal(v.ledgerIconKind(row),kind,label);assert.equal(row.amount,12.34);
 }
 assert.equal(v.ledgerIconKind({category_name:'อาหาร',transaction_type:'TRANSFER'}),'transfer');
 assert.equal(v.ledgerIconKind({category_name:'ไม่ทราบหมวด',transaction_type:'EXPENSE'}),'other');
});
test('source titles and multiline company notes are shown without the old combined label or unsafe markup',()=>{
 const html=view().renderLedgerRow({transaction_id:'company:synthetic',source:'company-owner-ledger',source_title:'เบี้ยเลี้ยงบุคคลจำลอง',category_name:'เบี้ยเลี้ยง',company_kind:'OTHER_ALLOWANCE',recipient:'ชื่อเก่า',description:'ข้อความจากบริษัท\n<script>unsafe</script>',status:'ACTIVE',amount:200,transaction_type:'EXPENSE'});
 assert.match(html,/เบี้ยเลี้ยงบุคคลจำลอง/);assert.doesNotMatch(html,/เบี้ยเลี้ยง · ชื่อเก่า|<script>/);assert.match(html,/&lt;script&gt;/);
});
const tx=extra=>({transaction_id:'TX-SYNTHETIC',transaction_date:'2026-10-30',transaction_type:'EXPENSE',expense_owner:'COMPANY',amount:600,status:'ACTIVE',category_name:'เบี้ยเลี้ยง',account_name:'บัญชีจำลอง',description:'เบี้ยเลี้ยง 4 วัน\nไม่รวมวันหยุด',project_name:'โปรเจกต์จำลอง',...extra});
test('daily ledger keeps every original ID and status, orders days newest first, and never changes the records',()=>{
  const v=view(),items=[tx({transaction_id:'OLD',transaction_date:'2026-10-29',status:'VOID'}),tx({transaction_id:'NEW'}),tx({transaction_id:'DRAFT',status:'DRAFT'})];
  const before=JSON.stringify(items),html=v.renderLedgerDays(items);
  assert.ok(html.indexOf('30-ต.ค.-2569')<html.indexOf('29-ต.ค.-2569'));
  for(const id of ['OLD','NEW','DRAFT'])assert.equal(html.split('data-id="'+id+'"').length-1,1);
  assert.match(html,/ยกเลิกแล้ว/);assert.match(html,/ร่าง/);assert.match(html,/วันศุกร์/);assert.equal(JSON.stringify(items),before);
});
test('ledger safely escapes descriptions, recipients, project names and IDs without rendering user HTML',()=>{
  const html=view().renderLedgerRow(tx({transaction_id:'" onclick="alert(1)',company_kind:'OTHER_ALLOWANCE',recipient:'<img src=x onerror=alert(1)>',description:'<script>alert(1)</script>\n& details',project_name:'<svg onload=alert(1)>'}));
  assert.doesNotMatch(html,/<script|<img|<svg onload|data-id="" onclick=/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.match(html,/&quot; onclick=&quot;/);
});
test('ledger shows full multiline notes, separate projects, decimal amounts and cashless labels',()=>{
  const v=view(),html=v.renderLedgerRow(tx({description:'โปรเจกต์จำลอง | บรรทัดแรก\nบรรทัดสอง',amount:600.25}));
  assert.match(html,/บรรทัดแรก\nบรรทัดสอง/);assert.match(html,/โครงการ: โปรเจกต์จำลอง/);assert.match(html,/−600\.25/);assert.match(html,/>บาท</);
  const internal=v.renderLedgerRow(tx({company_kind:'SELF_ALLOWANCE',transaction_type:'INCOME',amount:300}));
  assert.match(internal,/ไม่เคลื่อนเงินจริง/);assert.doesNotMatch(internal,/\+300/);
});
test('daily cash net excludes VOID, DRAFT, transfers and cashless company reallocations',()=>{
  const v=view();
  for(const row of [tx({status:'VOID'}),tx({status:'DRAFT'}),tx({transaction_type:'TRANSFER'}),tx({company_kind:'MOVE'}),tx({transaction_type:'INCOME',company_kind:'SELF_ALLOWANCE'})])assert.equal(v.ledgerCashCents(row),0);
  assert.equal(v.ledgerCashCents(tx({transaction_type:'INCOME',company_kind:'ADVANCE',amount:1000})),100000);
  assert.equal(v.ledgerCashCents(tx({transaction_type:'INCOME',company_kind:'MIXED_RECEIPT',amount:200})),20000);
  assert.equal(v.ledgerCashCents(tx({company_kind:'RETURN',amount:50})),-5000);
  assert.equal(v.ledgerCashCents(tx({category_name:'ชำระหนี้',expense_owner:'PERSONAL',amount:300})),-30000);
});
test('daily net uses integer satang and zero has no negative sign',()=>{
  const v=view(),rows=[tx({amount:.1,transaction_type:'INCOME'}),tx({amount:.2,transaction_type:'INCOME'}),tx({amount:.3})];
  const html=v.renderLedgerDays(rows);
  assert.match(html,/data-cash-cents="0"/);assert.match(html,/<small>ยอดสุทธิ<\/small>0\.00/);assert.doesNotMatch(html,/ยอดสุทธิ<\/small>−0\.00/);
});
test('daily headings sum only displayed filtered rows and keep dates independent',()=>{
  const v=view(),rows=[tx({amount:600.25}),tx({amount:100.10,transaction_date:'2026-10-29',transaction_type:'INCOME'})];
  const html=v.renderLedgerDays(rows),before=JSON.stringify(rows);
  assert.match(html,/data-cash-cents="-60025"/);assert.match(html,/data-cash-cents="10010"/);
  assert.match(html,/<small>ยอดสุทธิ<\/small>−600\.25/);assert.match(html,/<small>ยอดสุทธิ<\/small>\+100\.10/);
  assert.match(v.renderLedgerDays(rows.slice(0,1)),/data-cash-cents="-60025"/);assert.equal(JSON.stringify(rows),before);
});
