import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import{readFileSync}from'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fn=name=>source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))?.[0];
function setup(accounts){
 const fields=new Map();const get=id=>{if(!fields.has(id))fields.set(id,{value:'',classList:{add(){},remove(){},toggle(){}},close(){},showModal(){}});return fields.get(id);};
 const context={$:get,BOOT:{today:'2026-11-05',accounts},selectedTx:null,clearRefundPreview(){},fillProjectSelects(){},selectType(){},syncAccountPickerButtons(){},toggleRefundField(){}};
 vm.runInNewContext(fn('resetForm')+'\n'+fn('editCurrentTransaction'),context);return {context,get};
}
test('new entries default to the named Krungthai account while editing preserves the original account',()=>{
 const {context,get}=setup([{account_id:'CASH',account_name:'เงินสด'},{account_id:'KTB',account_name:'กรุงไทย'}]);get('account').value='CASH';context.resetForm();assert.equal(get('account').value,'KTB');
 context.selectedTx={transaction_id:'synthetic-old',status:'ACTIVE',transaction_type:'EXPENSE',expense_owner:'PERSONAL',account_id:'CASH',amount:10,transaction_date:'2026-11-01'};context.editCurrentTransaction();assert.equal(get('account').value,'CASH');assert.equal(get('amount').value,10);
});
test('a missing Krungthai account never assigns an unknown bank ID',()=>{
 const {context,get}=setup([{account_id:'CASH',account_name:'เงินสด'}]);get('account').value='CASH';context.resetForm();assert.equal(get('account').value,'CASH');
});
