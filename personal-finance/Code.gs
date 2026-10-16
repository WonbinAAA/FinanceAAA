const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty("FINANCE_SPREADSHEET_ID") || "YOUR_SPREADSHEET_ID";
const TZ = "Asia/Bangkok";
const APP_FAVICON = "https://wonbinaaa.github.io/FinanceAAA/personal-finance-portrait-icon.png";
const USER_ID = "USR001";
const DATA_ROW = 3;
const SH = {
  USERS:"ผู้ใช้งาน", ACCOUNTS:"บัญชี", TX:"รายการเงิน", CAT:"หมวดหมู่",
  DEBTS:"หนี้สิน", DEBT_TX:"รายการหนี้", DEBT_PLAN:"แผนชำระหนี้", CLAIMS:"เงินสำรองบริษัท",
  RECUR:"รายการประจำ", SETTINGS:"ตั้งค่าระบบ", AUDIT:"ประวัติการแก้ไข", MATCH:"จับคู่เงินคืนบริษัท", PROJECTS:"โปรเจกต์บริษัท"
};

let spreadsheetCache_=null;
let readCache_=null;
let headerCache_=null;
function ss_() { return spreadsheetCache_||(spreadsheetCache_=SpreadsheetApp.openById(SPREADSHEET_ID)); }
function sh_(name) { const s=ss_().getSheetByName(name); if(!s) throw new Error("ไม่พบ Sheet: "+name); return s; }
function headers_(name) {
  if(headerCache_&&headerCache_.has(name)) return headerCache_.get(name);
  const s=sh_(name),headers=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String);
  if(headerCache_) headerCache_.set(name,headers);
  return headers;
}
function cell_(v,key) {
  if(v instanceof Date) {
    if(key==="due_month") return Utilities.formatDate(v,TZ,"yyyy-MM-dd").slice(0,7);
    return Utilities.formatDate(v,TZ,/(^|_)(date|day)$/.test(key)?"yyyy-MM-dd":"yyyy-MM-dd'T'HH:mm:ss");
  }
  return v==null?"":v;
}
function rows_(name) {
  if(readCache_&&readCache_.has(name)) return readCache_.get(name);
  const s=sh_(name), last=s.getLastRow();
  if(last<DATA_ROW) { if(readCache_) readCache_.set(name,[]); return []; }
  const h=headers_(name), v=s.getRange(DATA_ROW,1,last-DATA_ROW+1,h.length).getValues();
  const result=v.map((r,i)=>({r,row:DATA_ROW+i})).filter(x=>x.r.some(v=>v!==""&&v!==null))
    .map(x=>Object.assign({_row:x.row},Object.fromEntries(h.map((k,i)=>[k,cell_(x.r[i],k)]))));
  if(readCache_) readCache_.set(name,result);
  return result;
}
function withReadCache_(fn) {
  const previousRows=readCache_,previousHeaders=headerCache_;
  readCache_=new Map();headerCache_=new Map();
  try { return fn(); } finally { readCache_=previousRows;headerCache_=previousHeaders; }
}
function id_(p) { return p+"-"+Utilities.getUuid().slice(0,8).toUpperCase(); }
function today_() { return Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd"); }
function now_() { return Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd'T'HH:mm:ss"); }
function isoDate_(v) {
  const value=String(v||today_()).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("วันที่ไม่ถูกต้อง");
  const d=new Date(value+"T12:00:00+07:00");
  if(isNaN(d.getTime())||Utilities.formatDate(d,TZ,"yyyy-MM-dd")!==value) throw new Error("วันที่ไม่ถูกต้อง");
  return value;
}
function appendObj_(name,obj) {
  const s=sh_(name), h=headers_(name); s.appendRow(h.map(k=>obj[k] ?? ""));
  if(readCache_) readCache_.delete(name);
}
function writeObj_(name,row,obj) {
  const h=headers_(name); sh_(name).getRange(row,1,1,h.length).setValues([h.map(k=>obj[k]??"")]);
  if(readCache_) readCache_.delete(name);
}
function cents_(n) { return Math.round(Number(n||0)*100); }
function active_(v) { return String(v).toUpperCase()!=="FALSE"&&String(v)!=="0"; }
function accountAvailable_(account) {
  if(account.include_in_available===""||account.include_in_available==null)
    return ["เงินสด","กรุงไทย"].includes(String(account.account_name).trim());
  return active_(account.include_in_available);
}
function publicRows_(v) { return v.map(({_row,...x})=>x); }
function withLock_(fn) {
  const l=LockService.getScriptLock();l.waitLock(10000);
  try{return withReadCache_(fn);}finally{l.releaseLock();}
}
function ensureColumn_(name,key,label) {
  if(headers_(name).includes(key)) return;
  const s=sh_(name), c=s.getLastColumn()+1; s.getRange(1,c).setValue(key); s.getRange(2,c).setValue(label);
  if(headerCache_) headerCache_.delete(name);
  if(readCache_) readCache_.delete(name);
}
function matchSheet_(create) {
  let s=ss_().getSheetByName(SH.MATCH);
  if(!s&&create) {
    s=ss_().insertSheet(SH.MATCH);
    s.getRange(1,1,1,7).setValues([["match_id","reimbursement_transaction_id","claim_id","amount","status","created_at","updated_at"]]);
    s.getRange(2,1,1,7).setValues([["รหัสการจับคู่","รหัสรายการเงินคืน","รหัสเงินสำรอง","จำนวนที่จับคู่","สถานะ","สร้างเมื่อ","แก้ไขเมื่อ"]]);
    s.setFrozenRows(2);
  }
  return s;
}
function matches_() { return matchSheet_(false)?rows_(SH.MATCH):[]; }
function audit_(recordType,recordId,action,fieldName,oldValue,newValue,reason,changeSource) {
  appendObj_(SH.AUDIT,{audit_id:id_("AUD"),user_id:"USR001",record_type:recordType,record_id:recordId,
    action,field_name:fieldName||"",old_value:oldValue??"",new_value:newValue??"",
    change_source:changeSource||"WEB",reason:reason||"",changed_at:now_()});
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  return HtmlService.createTemplateFromFile("Index").evaluate()
    .setTitle("รายรับ-รายจ่ายของฉัน")
    .setFaviconUrl(APP_FAVICON)
    .addMetaTag("viewport","width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function getConnectionStatus() {
  try {
    const book=ss_(), names=new Set(book.getSheets().map(sheet=>sheet.getName()));
    Object.keys(SH).filter(k=>!["MATCH","DEBT_PLAN","PROJECTS"].includes(k)).forEach(k=>{if(!names.has(SH[k])) throw new Error("ไม่พบ Sheet: "+SH[k]);});
    return {ok:true,spreadsheet_name:book.getName(),spreadsheet_id:book.getId(),time_zone:TZ};
  } catch(e) { return {ok:false,message:"เปิดฐานข้อมูลไม่ได้: "+e.message+" กรุณาตรวจสิทธิ์บัญชีที่ Deploy Web App และ Spreadsheet ID"}; }
}
function getBootstrap() {
  return withReadCache_(()=>{
    const connection=getConnectionStatus(); if(!connection.ok) throw new Error(connection.message);
    const allCategories=sortedCategories_(rows_(SH.CAT).map(publicCategory_));
    return {connection,dashboard:getDashboard(),accounts:publicRows_(rows_(SH.ACCOUNTS).filter(x=>active_(x.is_active))
      .map(a=>Object.assign({},a,{include_in_available:accountAvailable_(a)}))),
      categories:publicRows_(allCategories.filter(x=>active_(x.is_active))),filterCategories:publicRows_(allCategories),
      debts:getDebts(),recurring:getRecurringDue(),company:getCompanySummary(),latestTransactions:getLatestTransactions(8),today:today_()};
  });
}
function transactionMutationResult_(extra) {
  return Object.assign({ok:true,dashboard:getDashboard(),latestTransactions:getLatestTransactions(8),
    company:getCompanySummary(),debts:getDebts(),recurring:getRecurringDue()},extra||{});
}

function positive_(v) {
  const n=Number(v);
  if(!isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>0.000001) throw new Error("จำนวนเงินต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  return n;
}
function category_(id) { return rows_(SH.CAT).find(c=>String(c.category_id)===String(id)); }
function categoryGroup_(category) {
  const group=String(category.category_group||"").toUpperCase();
  return category.transaction_type==="INCOME"?"INCOME":(["EXPENSE","OFFICE","BOTH"].includes(group)?group:"BOTH");
}
function publicCategory_(category) { return Object.assign({},category,{category_group:categoryGroup_(category)}); }
function categoryOrder_(item) {
  const value=String(item.sort_order??"").trim(),order=Number(value);
  return value!==""&&Number.isFinite(order)?order:999999;
}
function sortedCategories_(items) { return items.sort((a,b)=>categoryOrder_(a)-categoryOrder_(b)||String(a.category_id).localeCompare(String(b.category_id))); }
function categoryFits_(category,type,owner) {
  if(category.transaction_type!==type) return false;
  if(type!=="EXPENSE") return true;
  const group=categoryGroup_(category);
  return group==="BOTH"||group===(owner==="COMPANY"?"OFFICE":"EXPENSE");
}
function systemCategory_(category) {
  return (category.transaction_type==="INCOME"&&category.category_name==="เงินคืนบริษัท")||
    (category.transaction_type==="EXPENSE"&&category.category_name==="ชำระหนี้");
}
function categoryName_(value) {
  const name=String(value||"").trim().replace(/\s+/g," ");
  if(!name||name.length>60) throw new Error("ชื่อหมวดหมู่ต้องมี 1–60 ตัวอักษร");
  if(/[\x00-\x1f\x7f]/.test(name)) throw new Error("ชื่อหมวดหมู่มีอักขระที่ไม่รองรับ");
  return name;
}
function uniqueCategoryName_(name,type,group,exceptId) {
  if(["เงินคืนบริษัท","ชำระหนี้"].includes(name)) throw new Error("ชื่อนี้สงวนไว้สำหรับหมวดหมู่ระบบ");
  if(rows_(SH.CAT).some(c=>c.transaction_type===type&&String(c.category_id)!==String(exceptId||"")&&
    (type==="INCOME"||group==="BOTH"||categoryGroup_(c)==="BOTH"||categoryGroup_(c)===group)&&
    String(c.category_name).trim().toLocaleLowerCase()===name.toLocaleLowerCase()))
    throw new Error("มีหมวดหมู่นี้อยู่แล้ว หากหยุดใช้ไว้ให้เปิดใช้งานอีกครั้ง");
}
function getCategories() {
  return publicRows_(sortedCategories_(rows_(SH.CAT).map(c=>Object.assign(publicCategory_(c),{is_system:systemCategory_(c)}))));
}
function moveCategory(id,direction,viewGroup) { return withLock_(()=>{
  if(!["UP","DOWN","TOP"].includes(direction)) throw new Error("ทิศทางไม่ถูกต้อง");
  const items=sortedCategories_(rows_(SH.CAT).slice()),index=items.findIndex(item=>String(item.category_id)===String(id));
  if(index<0) throw new Error("ไม่พบหมวดหมู่");
  if(!active_(items[index].is_active)||systemCategory_(items[index])) throw new Error("หมวดหมู่นี้จัดลำดับไม่ได้");
  const group=String(viewGroup||categoryGroup_(items[index]));
  if(!["INCOME","EXPENSE","OFFICE","BOTH"].includes(group)) throw new Error("กลุ่มหมวดหมู่ไม่ถูกต้อง");
  const visible=items.filter(item=>active_(item.is_active)&&!systemCategory_(item)&&
    (categoryGroup_(item)===group||
    (["EXPENSE","OFFICE"].includes(group)&&categoryGroup_(item)==="BOTH")));
  if(!visible.some(item=>String(item.category_id)===String(id))) throw new Error("หมวดหมู่ไม่อยู่ในกลุ่มนี้");
  const at=visible.findIndex(item=>String(item.category_id)===String(id));
  if(direction==="TOP") {
    if(at===0) return {ok:true,id,categories:getCategories()};
    const item=items[index],before=item.sort_order,next=categoryOrder_(visible[0])-1;
    item.sort_order=next;writeObj_(SH.CAT,item._row,item);
    audit_("CATEGORY",item.category_id,"UPDATE","sort_order",before,next,"ย้ายหมวดหมู่ขึ้นบนสุด");
    return {ok:true,id,categories:getCategories()};
  }
  const other=visible[at+(direction==="UP"?-1:1)];
  if(!other) return {ok:true,id,categories:getCategories()};
  const first=items[index],oldFirst=Number(first.sort_order),oldOther=Number(other.sort_order);
  if(!Number.isFinite(oldFirst)||!Number.isFinite(oldOther)||oldFirst===oldOther) throw new Error("ลำดับหมวดหมู่ใน Sheet ไม่ถูกต้อง");
  first.sort_order=oldOther;other.sort_order=oldFirst;
  writeObj_(SH.CAT,first._row,first);writeObj_(SH.CAT,other._row,other);
  audit_("CATEGORY",first.category_id,"UPDATE","sort_order",oldFirst,oldOther,"จัดลำดับหมวดหมู่");
  audit_("CATEGORY",other.category_id,"UPDATE","sort_order",oldOther,oldFirst,"จัดลำดับหมวดหมู่");
  return {ok:true,id,categories:getCategories()};
}); }
function setAccountAvailable(id,enabled) { return withLock_(()=>{
  const account=rows_(SH.ACCOUNTS).find(a=>String(a.account_id)===String(id));
  if(!account) throw new Error("ไม่พบบัญชี");
  const before=accountAvailable_(account),next=enabled===true;
  if(before!==next) {
    ensureColumn_(SH.ACCOUNTS,"include_in_available","รวมในเงินพร้อมใช้");
    account.include_in_available=next;writeObj_(SH.ACCOUNTS,account._row,account);
    audit_("ACCOUNT",account.account_id,"UPDATE","include_in_available",before,next,"เลือกบัญชีเงินพร้อมใช้");
  }
  return {ok:true,dashboard:getDashboard(),accounts:publicRows_(rows_(SH.ACCOUNTS).filter(a=>active_(a.is_active))
    .map(a=>Object.assign({},a,{include_in_available:accountAvailable_(a)})))};
}); }
function createCategory(input) { return withLock_(()=>{
  const type=String(input.transaction_type||"").toUpperCase(),name=categoryName_(input.category_name);
  if(!["INCOME","EXPENSE"].includes(type)) throw new Error("ประเภทหมวดหมู่ต้องเป็นรายรับหรือรายจ่าย");
  const group=type==="INCOME"?"INCOME":String(input.category_group||"EXPENSE").toUpperCase();
  if(type==="EXPENSE"&&!["EXPENSE","OFFICE","BOTH"].includes(group)) throw new Error("กลุ่มหมวดหมู่ไม่ถูกต้อง");
  uniqueCategoryName_(name,type,group);
  const order=rows_(SH.CAT).reduce((max,c)=>Math.max(max,Number(c.sort_order)||0),0)+1;
  ensureColumn_(SH.CAT,"category_group","กลุ่มหมวดหมู่");
  const item={category_id:id_("CAT"),category_name:name,transaction_type:type,is_active:true,sort_order:order,category_group:group};
  appendObj_(SH.CAT,item);audit_("CATEGORY",item.category_id,"CREATE","","",JSON.stringify(item),"");
  return {ok:true,id:item.category_id,categories:getCategories()};
}); }
function updateCategory(id,input) { return withLock_(()=>{
  const item=category_(id); if(!item) throw new Error("ไม่พบหมวดหมู่");
  if(systemCategory_(item)) throw new Error("หมวดหมู่ระบบไม่สามารถแก้ไขได้");
  const name=categoryName_(input.category_name);
  const group=item.transaction_type==="INCOME"?"INCOME":String(input.category_group||categoryGroup_(item)).toUpperCase();
  if(item.transaction_type==="EXPENSE"&&!["EXPENSE","OFFICE","BOTH"].includes(group)) throw new Error("กลุ่มหมวดหมู่ไม่ถูกต้อง");
  uniqueCategoryName_(name,item.transaction_type,group,id);
  if(group!==categoryGroup_(item)) {
    const before=categoryGroup_(item);
    ensureColumn_(SH.CAT,"category_group","กลุ่มหมวดหมู่");
    item.category_group=group;
    writeObj_(SH.CAT,item._row,item);
    audit_("CATEGORY",item.category_id,"UPDATE","category_group",before,group,"ย้ายกลุ่มหมวดหมู่");
  }
  if(name!==item.category_name) {
    const before=item.category_name;item.category_name=name;writeObj_(SH.CAT,item._row,item);
    audit_("CATEGORY",item.category_id,"UPDATE","category_name",before,name,"แก้ชื่อหมวดหมู่");
  }
  return {ok:true,id:item.category_id,categories:getCategories()};
}); }
function renameCategory(id,value) { return updateCategory(id,{category_name:value}); }
function setCategoryActive(id,enabled) { return withLock_(()=>{
  const item=category_(id); if(!item) throw new Error("ไม่พบหมวดหมู่");
  if(systemCategory_(item)) throw new Error("หมวดหมู่ระบบไม่สามารถปิดใช้งานได้");
  const next=enabled===true;
  if(!next&&rows_(SH.RECUR).some(r=>String(r.category_id)===String(id)&&active_(r.is_active)))
    throw new Error("หมวดนี้มีรายการประจำที่ใช้งานอยู่ กรุณาหยุดรายการประจำก่อน");
  const before=active_(item.is_active);
  if(before!==next) {
    item.is_active=next;writeObj_(SH.CAT,item._row,item);
    audit_("CATEGORY",item.category_id,next?"ACTIVATE":"DEACTIVATE","is_active",before,next,
      next?"เปิดใช้หมวดหมู่":"นำหมวดหมู่ออกจากตัวเลือก");
  }
  return {ok:true,id:item.category_id,categories:getCategories()};
}); }
function validateTx_(input,allowedInactiveCategoryId,allowedLegacyCategoryId,historicalTx) {
  const companyKind=String(input.company_kind||"");
  if(companyKind&&!['ADVANCE','RETURN','MOVE','SELF_ALLOWANCE','OTHER_ALLOWANCE','MIXED_RECEIPT'].includes(companyKind)) throw new Error('ประเภทเงินบริษัทไม่ถูกต้อง');
  const funding=String(input.company_funding||'');
  if(funding&&!['POOL','PROJECT','PERSONAL'].includes(funding)) throw new Error('แหล่งเงินบริษัทไม่ถูกต้อง');
  if(funding==='PERSONAL'&&['ADVANCE','RETURN','MOVE','SELF_ALLOWANCE'].includes(companyKind)) throw new Error('รายการนี้ต้องใช้เงินบริษัทจากกองกลางหรือโปรเจกต์');
  const project=String(input.project_name||'').trim().replace(/\s+/g,' ');
  if(project.length>80) throw new Error('ชื่อโปรเจกต์ยาวเกิน 80 ตัวอักษร');
  if(companyKind&&companyKind!=='MIXED_RECEIPT'&&funding!=='POOL'&&funding!=='PERSONAL'&&!project) throw new Error('กรุณาระบุโปรเจกต์');
  if(funding==='PROJECT'&&!project) throw new Error('กรุณาเลือกโปรเจกต์ที่จะหักเงิน');
  const type=String(input.transaction_type||"").toUpperCase(), amount=positive_(input.amount);
  if(!["INCOME","EXPENSE","TRANSFER"].includes(type)) throw new Error("ประเภทรายการไม่ถูกต้อง");
  const accounts=rows_(SH.ACCOUNTS).filter(a=>active_(a.is_active));
  if(!(companyKind==='MOVE'&&!input.account_id)&&!accounts.some(a=>a.account_id===input.account_id)) throw new Error("บัญชีไม่ถูกต้อง");
  if(type==="TRANSFER"&&(!accounts.some(a=>a.account_id===input.to_account_id)||input.to_account_id===input.account_id)) throw new Error("บัญชีปลายทางไม่ถูกต้อง");
  if(type==="EXPENSE"&&!["PERSONAL","COMPANY"].includes(input.expense_owner)) throw new Error("กรุณาเลือก ส่วนตัว/บริษัท");
  if(type!=="TRANSFER"&&!['ADVANCE','RETURN','MOVE'].includes(companyKind)) {
    const category=category_(input.category_id);
    if(category?.transaction_type!==type) throw new Error("หมวดหมู่ไม่ตรงกับประเภทรายการ");
    if(!categoryFits_(category,type,input.expense_owner)&&String(input.category_id)!==String(allowedLegacyCategoryId||""))
      throw new Error("หมวดหมู่นี้ไม่อยู่ในกลุ่มรายจ่ายที่เลือก");
    if(!active_(category.is_active)&&String(input.category_id)!==String(allowedInactiveCategoryId||""))
      throw new Error("หมวดหมู่นี้หยุดใช้งานแล้ว กรุณาเลือกหมวดใหม่");
  }
  const status=String(input.status||"ACTIVE").toUpperCase(), source=String(input.source_type||"WEB").toUpperCase();
  if(companyKind==='MIXED_RECEIPT'&&(type!=='INCOME'||category_(input.category_id)?.category_name!=='เงินคืนบริษัท')) throw new Error('เงินรับผสมต้องใช้หมวดเงินคืนบริษัท');
  if(!["ACTIVE","DRAFT"].includes(status)) throw new Error("สถานะรายการไม่ถูกต้อง");
  if(!["WEB","LINE","IMPORT"].includes(source)) throw new Error("แหล่งที่มาของรายการไม่ถูกต้อง");
  if(['ADVANCE','MOVE'].includes(companyKind)&&type!=='INCOME'||['RETURN','SELF_ALLOWANCE','OTHER_ALLOWANCE'].includes(companyKind)&&(type!=='EXPENSE'||input.expense_owner!=='COMPANY')) throw new Error('ประเภทเงินบริษัทไม่ตรงกับรายการ');
  const target=String(input.to_project||'').trim().replace(/\s+/g,' ');
  assertCompanyProjectsOpen_(project,companyKind==='MOVE'?target:'',historicalTx);
  if(companyKind==='MOVE'&&(!target||target===project||target.length>80)) throw new Error('กรุณาเลือกโปรเจกต์ปลายทางที่ต่างกัน');
  if(companyKind==='MOVE'&&funding==='POOL'&&target===COMPANY_POOL) throw new Error('กองเงินต้นทางและปลายทางต้องต่างกัน');
  if(companyKind==='MOVE'&&funding!=='POOL'&&input.project_finished!==true) throw new Error('กรุณายืนยันว่าโปรเจกต์ต้นทางจบแล้ว');
  const recipient=String(input.recipient||'').trim();
  if(recipient.length>80||companyKind==='OTHER_ALLOWANCE'&&!recipient) throw new Error('กรุณาระบุชื่อผู้รับไม่เกิน 80 ตัวอักษร');
  return {company_funding:funding,company_funded_amount:'',company_pool_amount:0,
    project_name:project,company_kind:companyKind,to_project:companyKind==='MOVE'?target:'',recipient,
    transaction_date:isoDate_(input.transaction_date),transaction_type:type,account_id:input.account_id,
    to_account_id:type==="TRANSFER"?input.to_account_id:"",category_id:type==="TRANSFER"?"":input.category_id,
    amount,expense_owner:type==="EXPENSE"?input.expense_owner:"",description:String(input.description||"").trim(),
    source_type:source,attachment_url:String(input.attachment_url||"").trim(),ai_status:String(input.ai_status||"NONE"),status};
}
function newTx_(fields) { const t=now_(); return Object.assign({transaction_id:id_("TX"),user_id:USER_ID,created_at:t,updated_at:t,void_reason:""},fields); }
function saveTransaction(input) { return withLock_(()=>{
  const tx=newTx_(validateTx_(input));
  const allocations=planCompanyTransaction_(tx,input,'');
  prepareCompanyTx_(tx);
  checkCompanyChange_(tx);
  if(tx.source_type!=="WEB"&&tx.status!=="DRAFT") throw new Error("รายการจาก LINE/IMPORT ต้องบันทึกเป็น DRAFT ก่อนยืนยัน");
  appendObj_(SH.TX,tx);
  if(tx.status==="ACTIVE"&&isCompanyExpense_(tx)) createClaim_(tx);
  if(allocations.length) addMatches_(tx.transaction_id,allocations);
  if(allocations.length||tx.project_name||tx.company_kind||tx.company_funding) updateClaimTotals_();
  audit_("TRANSACTION",tx.transaction_id,"CREATE","","",JSON.stringify(tx),"");
  return transactionMutationResult_({id:tx.transaction_id});
}); }

function createClaim_(tx) {
  if(rows_(SH.CLAIMS).some(c=>c.transaction_id===tx.transaction_id)) return;
  const claim={claim_id:id_("CLM"),user_id:tx.user_id,transaction_id:tx.transaction_id,
    expense_date:tx.transaction_date,description:tx.description,claim_amount:tx.amount,
    returned_amount:0,remaining_amount:tx.amount,status:"OPEN",created_at:now_(),updated_at:now_()};
  appendObj_(SH.CLAIMS,claim);
  audit_("COMPANY_CLAIM",claim.claim_id,"CREATE","","",JSON.stringify(claim),"");
}

function isCompanyExpense_(tx) {
  return tx.transaction_type==='EXPENSE'&&tx.expense_owner==='COMPANY'&&tx.company_kind!=='RETURN';
}
function prepareCompanyTx_(tx) {
  if(!tx.project_name&&!tx.company_kind&&!tx.recipient&&!tx.company_funding) return;
  ['project_name','company_kind','to_project','recipient','company_funding','company_funded_amount','company_pool_amount'].forEach(key=>ensureColumn_(SH.TX,key,key));
}
const COMPANY_POOL = 'กองกลางบริษัท';
function companyProjectName_(value) {
  const name=String(value||'').trim().replace(/\s+/g,' ');
  if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(String(value))||name===COMPANY_POOL) throw new Error('กรุณาระบุชื่อโปรเจกต์ 1–80 ตัวอักษร และไม่ใช้ชื่อกองกลางบริษัท');
  return name;
}
function companyProjectSheet_(create) {
  let s=ss_().getSheetByName(SH.PROJECTS);
  if(!s&&create) {
    s=ss_().insertSheet(SH.PROJECTS);
    s.getRange(1,1,1,6).setValues([['project_id','project_name','status','created_at','closed_at','close_transaction_id']]);
    s.getRange(2,1,1,6).setValues([['รหัสโปรเจกต์','ชื่อโปรเจกต์','สถานะ','สร้างเมื่อ','ปิดเมื่อ','รายการย้ายเข้ากองกลาง']]);
    s.setFrozenRows(2);
  }
  return s;
}
function companyProjectRecords_() { return companyProjectSheet_(false)?rows_(SH.PROJECTS):[]; }
function companyProjectCatalog_(ledger) {
  const entries=new Map();
  rows_(SH.TX).forEach(t=>{
    [t.project_name,t.company_kind==='MOVE'?t.to_project:''].forEach(value=>{
      const name=String(value||'').trim();
      if(name&&name!==COMPANY_POOL&&!entries.has(name)) entries.set(name,{project_name:name,status:'ACTIVE'});
    });
  });
  companyProjectRecords_().forEach(p=>entries.set(p.project_name,{project_id:p.project_id,project_name:p.project_name,status:p.status,closed_at:p.closed_at}));
  const balances=new Map((ledger||companyLedger_()).projects.map(p=>[p.project_name,p.remaining]));
  return [...entries.values()].map(p=>Object.assign({},p,{remaining:balances.get(p.project_name)||0}))
    .sort((a,b)=>(a.status==='CLOSED')-(b.status==='CLOSED')||a.project_name.localeCompare(b.project_name));
}
function assertCompanyProjectsOpen_(project,target,historicalTx) {
  const closed=new Set(companyProjectRecords_().filter(p=>p.status==='CLOSED').map(p=>p.project_name));
  if(project&&closed.has(project)&&project!==historicalTx?.project_name||target&&closed.has(target)&&target!==historicalTx?.to_project)
    throw new Error('โปรเจกต์นี้ปิดแล้ว กรุณาเลือกโปรเจกต์ที่ยังใช้งานอยู่');
}
function createCompanyProject(value) { return withLock_(()=>{
  const name=companyProjectName_(value),catalog=companyProjectCatalog_();
  if(catalog.some(p=>p.project_name.toLocaleLowerCase()===name.toLocaleLowerCase())) throw new Error('มีโปรเจกต์ชื่อนี้อยู่แล้ว รวมถึงรายการที่ปิดไปแล้ว');
  companyProjectSheet_(true);
  const project={project_id:id_('PRJ'),project_name:name,status:'ACTIVE',created_at:now_(),closed_at:'',close_transaction_id:''};
  appendObj_(SH.PROJECTS,project);
  audit_('COMPANY_PROJECT',project.project_id,'CREATE','','',JSON.stringify(project),'เพิ่มโปรเจกต์');
  return {ok:true,project_name:name,company:getCompanySummary()};
}); }
function companyProjectClosePreview_(value) {
  const name=companyProjectName_(value),project=companyProjectCatalog_().find(p=>p.project_name===name);
  if(!project) throw new Error('ไม่พบโปรเจกต์');
  if(project.status!=='CLOSED'&&rows_(SH.TX).some(t=>t.status==='ACTIVE'&&String(t.transaction_date)>today_()&&
    (t.project_name===name||t.company_kind==='MOVE'&&t.to_project===name))) throw new Error('โปรเจกต์นี้มีรายการลงวันที่ในอนาคต กรุณาตรวจวันที่ก่อนปิดโปรเจกต์');
  return {project_name:name,status:project.status,remaining:project.remaining};
}
function getCompanyProjectClosePreview(name) { return withReadCache_(()=>companyProjectClosePreview_(name)); }
function closeCompanyProject(value,expectedRemaining) { return withLock_(()=>{
  const preview=companyProjectClosePreview_(value),name=preview.project_name;
  if(preview.status==='CLOSED') return transactionMutationResult_({already_closed:true,moved_amount:0});
  if(expectedRemaining==null||!isFinite(Number(expectedRemaining))||Number(expectedRemaining)<0||cents_(expectedRemaining)!==cents_(preview.remaining))
    throw new Error('ยอดเงินโปรเจกต์เปลี่ยนแล้ว กรุณาตรวจและยืนยันปิดใหม่');
  let transfer=null;
  if(cents_(preview.remaining)>0) {
    transfer=newTx_(validateTx_({transaction_date:today_(),transaction_type:'INCOME',account_id:'',amount:preview.remaining,
      company_kind:'MOVE',company_funding:'PROJECT',project_name:name,to_project:COMPANY_POOL,project_finished:true,
      description:'ปิดโปรเจกต์ · '+name+' → '+COMPANY_POOL,status:'ACTIVE',source_type:'WEB'}));
    checkCompanyChange_(transfer);
  }
  companyProjectSheet_(true);
  let record=companyProjectRecords_().find(p=>p.project_name===name);
  if(!record) { record={project_id:id_('PRJ'),project_name:name,status:'ACTIVE',created_at:now_()};appendObj_(SH.PROJECTS,record);record=companyProjectRecords_().find(p=>p.project_name===name); }
  if(transfer) {
    prepareCompanyTx_(transfer);appendObj_(SH.TX,transfer);
    audit_('TRANSACTION',transfer.transaction_id,'CREATE','','',JSON.stringify(transfer),'ย้ายเงินเหลือเมื่อปิดโปรเจกต์');
  }
  record.status='CLOSED';record.closed_at=now_();record.close_transaction_id=transfer?.transaction_id||'';
  writeObj_(SH.PROJECTS,record._row,record);
  audit_('COMPANY_PROJECT',record.project_id,'CLOSE','status','ACTIVE','CLOSED','ย้ายเข้ากองกลาง '+preview.remaining.toFixed(2)+' บาท');
  return transactionMutationResult_({moved_amount:preview.remaining});
}); }
function companyWallet_(tx) {
  if(tx.company_funding==='PERSONAL') return '';
  if(tx.company_funding==='POOL') return COMPANY_POOL;
  return String(tx.project_name||'');
}
function companyCandidate_(tx) {
  const list=rows_(SH.TX),found=list.some(t=>t.transaction_id===tx.transaction_id);
  return found?list.map(t=>t.transaction_id===tx.transaction_id?tx:t):list.concat([tx]);
}
function getCompanyFundingPreview(input,id) {
  return withReadCache_(()=>{
    const old=id?rows_(SH.TX).find(t=>t.transaction_id===id):null;
    if(id&&!old) throw new Error('ไม่พบรายการเดิม');
    const tx=Object.assign({},old||{transaction_id:'PREVIEW'},validateTx_(Object.assign({},old||{},input,{status:'ACTIVE'}),old?.category_id,old?.category_id,old?.status==='ACTIVE'?old:null));
    const ledger=companyLedger_(companyCandidate_(tx)),funded=ledger.funding[tx.transaction_id]||0;
    return {funded_amount:funded/100,personal_amount:(cents_(tx.amount)-funded)/100,source:tx.company_funding||'PERSONAL'};
  });
}
function getCompanyReceiptPreview(amount,excludeId,selectedAllocations) {
  const run=()=>{
    amount=positive_(amount);
    const claims=companyClaims_(excludeId||'').filter(c=>cents_(c.remaining_amount)>0)
      .sort((a,b)=>String(a.expense_date).localeCompare(String(b.expense_date))||String(a.claim_id).localeCompare(String(b.claim_id)));
    const due=claims.reduce((s,c)=>s+cents_(c.remaining_amount),0);
    let refund,allocations;
    if(selectedAllocations!=null) {
      if(!Array.isArray(selectedAllocations)) throw new Error('รายการจับคู่เงินคืนไม่ถูกต้อง');
      refund=selectedAllocations.reduce((s,item)=>s+cents_(positive_(item.amount)),0);
      if(refund>cents_(amount)) throw new Error('ยอดที่เลือกคืนเกินเงินที่ได้รับจริง');
      allocations=validateAllocations_(refund/100,selectedAllocations,excludeId||'');
    } else {
      // Preserve the legacy API for LINE and older clients. The web form sends an explicit selection.
      refund=Math.min(cents_(amount),due);
      allocations=refund?fifoAllocations_(refund/100,excludeId||''):[];
    }
    return {refund_amount:refund/100,pool_amount:(cents_(amount)-refund)/100,remaining:due/100,
      allocations,claims:publicRows_(claims),existing_allocations:excludeId?matches_()
        .filter(m=>m.status==='ACTIVE'&&m.reimbursement_transaction_id===excludeId)
        .map(m=>({claim_id:m.claim_id,amount:Number(m.amount)})):[]};
  };
  return readCache_?run():withReadCache_(run);
}
function planCompanyTransaction_(tx,input,excludeRefundId) {
  if(isCompanyExpense_(tx)&&tx.company_funding&&tx.status==='ACTIVE') {
    const ledger=companyLedger_(companyCandidate_(tx)),funded=ledger.funding[tx.transaction_id]||0,short=cents_(tx.amount)-funded;
    if(input.company_expected_personal!=null&&cents_(input.company_expected_personal)!==short) throw new Error('ยอดแหล่งเงินเปลี่ยนแล้ว กรุณาตรวจและยืนยันใหม่');
    if(tx.company_funding!=='PERSONAL'&&short>0&&
      (input.company_shortfall_confirmed!==true||cents_(input.company_expected_personal)!==short))
      throw new Error('เงินบริษัทไม่พอ ขาด '+(short/100).toFixed(2)+' บาท กรุณาตรวจและยืนยันใช้เงินส่วนตัวส่วนที่ขาด');
    tx.company_funded_amount=funded/100;
  }
  if(!isCompanyRefund_(tx)) return [];
  if(input.company_surplus_to_pool===true||tx.company_kind==='MIXED_RECEIPT') {
    const split=getCompanyReceiptPreview(tx.amount,excludeRefundId,input.allocations);
    if(input.company_expected_refund!=null&&(cents_(input.company_expected_refund)!==cents_(split.refund_amount)||cents_(input.company_expected_pool)!==cents_(split.pool_amount))) throw new Error('ยอดค้างคืนเปลี่ยนแล้ว กรุณาตรวจการแบ่งเงินรับใหม่');
    if(split.pool_amount>0&&(input.company_surplus_confirmed!==true||
      cents_(input.company_expected_refund)!==cents_(split.refund_amount)||cents_(input.company_expected_pool)!==cents_(split.pool_amount)))
      throw new Error('กรุณาตรวจและยืนยันยอดคืน '+split.refund_amount.toFixed(2)+' บาท และส่วนเกินเข้ากองกลาง '+split.pool_amount.toFixed(2)+' บาท อีกครั้ง');
    tx.company_kind=split.pool_amount>0?'MIXED_RECEIPT':'';
    tx.company_pool_amount=split.pool_amount;
    if(tx.status!=='ACTIVE') return [];
    if(!split.refund_amount) {
      if(input.allocations?.length) throw new Error('ไม่มียอดค้างคืนสำหรับจับคู่');
      return [];
    }
    return validateAllocations_(split.refund_amount,input.allocations||split.allocations,excludeRefundId);
  }
  return tx.status==='ACTIVE'?validateAllocations_(tx.amount,input.allocations||fifoAllocations_(tx.amount,excludeRefundId),excludeRefundId):[];
}
// Replay project funding in transaction date and original row order. Legacy expenses stay unassigned.
function companyLedger_(transactions) {
  const txs=(transactions||rows_(SH.TX)).filter(t=>t.status==='ACTIVE');
  const wallets=Object.create(null),funding={},received=Object.create(null),spent=Object.create(null),movedOut=Object.create(null);
  const sorted=txs.map((t,i)=>({t,i})).sort((a,b)=>String(a.t.transaction_date).localeCompare(String(b.t.transaction_date))||a.i-b.i);
  for(const {t} of sorted) {
    const p=kindWallet(t),kind=t.company_kind||'',n=cents_(t.amount);
    if(!p) continue;
    wallets[p] = wallets[p] || 0; received[p] = received[p] || 0; spent[p] = spent[p] || 0;
    if(kind==='MIXED_RECEIPT') {const pool=cents_(t.company_pool_amount);wallets[p]+=pool;received[p]+=pool;}
    else if(kind==='ADVANCE') {wallets[p]+=n;received[p]+=n;}
    else if(kind==='MOVE') {
      if(wallets[p]<n) throw new Error('เงินล่วงหน้าไม่พอสำหรับย้ายจากโปรเจกต์ '+p);
      wallets[p]-=n; wallets[t.to_project]=(wallets[t.to_project]||0)+n;
      received[t.to_project]=(received[t.to_project]||0)+n;movedOut[p]=(movedOut[p]||0)+n;
    } else if(kind==='RETURN') {
      if(wallets[p]<n) throw new Error('เงินล่วงหน้าไม่พอสำหรับคืนบริษัทในโปรเจกต์ '+p);
      wallets[p]-=n;
    } else if(isCompanyExpense_(t)) {
      const fixed=t.company_funding&&t.company_funded_amount!==''&&t.company_funded_amount!=null;
      const used=fixed?cents_(t.company_funded_amount):Math.min(n,wallets[p]);
      if(used<0||used>n||used>wallets[p]) throw new Error('ยอดเงินบริษัทเปลี่ยนหรือไม่เพียงพอสำหรับรายการที่ยืนยันแล้ว กรุณาตรวจแหล่งเงินอีกครั้ง');
      if(kind==='SELF_ALLOWANCE'&&used<n) throw new Error('เบี้ยเลี้ยงให้ตัวเองต้องมีเงินล่วงหน้าเพียงพอ');
      wallets[p]-=used;funding[t.transaction_id]=used;spent[p]+=n;
    }
  }
  function kindWallet(t) {return t.company_kind==='MIXED_RECEIPT'?COMPANY_POOL:companyWallet_(t);}
  return {funding,remaining:Object.values(wallets).reduce((a,b)=>a+b,0)/100,
    pool:{remaining:(wallets[COMPANY_POOL]||0)/100,received:(received[COMPANY_POOL]||0)/100,spent:(spent[COMPANY_POOL]||0)/100,moved_out:(movedOut[COMPANY_POOL]||0)/100},
    projects:Object.keys(wallets).filter(p=>p!==COMPANY_POOL).sort().map(project_name=>({project_name,remaining:wallets[project_name]/100,received:(received[project_name]||0)/100,spent:(spent[project_name]||0)/100,moved_out:(movedOut[project_name]||0)/100}))};
}
function checkCompanyChange_(next,removeId,excludeRefundId) {
  const original=rows_(SH.TX),id=removeId||next?.transaction_id;
  const list=original.map(t=>t.transaction_id===id?next:t).filter(Boolean);
  if(next&&!original.some(t=>t.transaction_id===id)) list.push(next);
  const ledger=companyLedger_(list);
  const closed=new Set(companyProjectRecords_().filter(p=>p.status==='CLOSED').map(p=>p.project_name));
  if(ledger.projects.some(p=>closed.has(p.project_name)&&cents_(p.remaining)!==0)) throw new Error('การเปลี่ยนนี้ทำให้โปรเจกต์ที่ปิดแล้วมีเงินเหลือ กรุณาตรวจรายการย้ายเข้ากองกลางตอนปิดโปรเจกต์');
  const byId=Object.fromEntries(list.filter(t=>t.status==='ACTIVE').map(t=>[t.transaction_id,t]));
  const used={};
  matches_().filter(m=>m.status==='ACTIVE'&&m.reimbursement_transaction_id!==excludeRefundId&&byId[m.reimbursement_transaction_id]).forEach(m=>used[m.claim_id]=(used[m.claim_id]||0)+cents_(m.amount));
  rows_(SH.CLAIMS).forEach(c=>{
    const t=byId[c.transaction_id],net=t&&isCompanyExpense_(t)?cents_(t.amount)-(ledger.funding[t.transaction_id]||0):0;
    if((used[c.claim_id]||0)>net) throw new Error('การเปลี่ยนนี้กระทบเงินคืนที่จับคู่แล้ว กรุณาแก้หรือยกเลิกเงินคืนก่อน');
  });
}

// Existing income is edited in place; its bank balance is never added a second time.
function reclassifyCompanyAdvance(id,project,funding) {
  const tx=getTransaction(id);
  if(tx.status!=='ACTIVE'||tx.transaction_type!=='INCOME'||tx.company_kind||isCompanyRefund_(tx)) throw new Error('เลือกได้เฉพาะรายรับทั่วไปที่ยังใช้งานอยู่');
  return updateTransaction(id,{company_kind:'ADVANCE',project_name:project,company_funding:funding||'',_reclassifyAdvance:true,reason:'เปลี่ยนรายรับเดิมเป็นเงินบริษัทล่วงหน้า'});
}
function getCompanyAdvanceCandidates() {
  return publicRows_(rows_(SH.TX).filter(t=>t.status==='ACTIVE'&&t.transaction_type==='INCOME'&&!t.company_kind&&!isCompanyRefund_(t))
    .sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))));
}

function voidTransaction(transactionId,reason) { return withLock_(()=>{
  const tx=rows_(SH.TX).find(t=>String(t.transaction_id)===String(transactionId));
  if(!tx) throw new Error("ไม่พบรายการ");
  if(tx.status==="VOID") return {ok:true,dashboard:getDashboard()};
  checkCompanyChange_(Object.assign({},tx,{status:'VOID'}));
  const claim=companyClaims_().find(c=>c.transaction_id===transactionId);
  if(claim&&cents_(claim.returned_amount)>0) throw new Error("มีเงินคืนที่จับคู่แล้ว กรุณา VOID เงินคืนก่อน");
  const old=tx.status; tx.status="VOID"; tx.void_reason=String(reason||"ยกเลิกรายการ"); tx.updated_at=now_();
  writeObj_(SH.TX,tx._row,tx);
  if(isCompanyRefund_(tx)) voidMatches_(transactionId);
  rows_(SH.DEBT_TX).filter(d=>d.linked_transaction_id===transactionId&&d.status==="ACTIVE").forEach(d=>{
    d.status="VOID";d.updated_at=now_();writeObj_(SH.DEBT_TX,d._row,d);
    audit_("DEBT_TRANSACTION",d.debt_transaction_id,"VOID","status","ACTIVE","VOID",tx.void_reason);
  });
  updateClaimTotals_();
  audit_("TRANSACTION",transactionId,"VOID","status",old,"VOID",tx.void_reason);
  return transactionMutationResult_();
}); }

function companyClaims_(excludeRefundId) {
  const funding=companyLedger_().funding;
  const active=Object.fromEntries(rows_(SH.TX).filter(t=>t.status==="ACTIVE").map(t=>[t.transaction_id,t]));
  const applied={};
  matches_().filter(m=>m.status==="ACTIVE"&&m.reimbursement_transaction_id!==excludeRefundId&&active[m.reimbursement_transaction_id])
    .forEach(m=>applied[m.claim_id]=(applied[m.claim_id]||0)+cents_(m.amount));
  return rows_(SH.CLAIMS).filter(c=>{
    const tx=active[c.transaction_id];return tx&&isCompanyExpense_(tx);
  }).map(c=>{
    const tx=active[c.transaction_id], advanced=funding[tx.transaction_id]||0,total=cents_(tx.amount)-advanced,returned=applied[c.claim_id]||0;
    return Object.assign({},c,{expense_date:tx.transaction_date,description:tx.description,claim_amount:total/100,
      advance_used:advanced/100,expense_amount:Number(tx.amount),project_name:tx.project_name||'',returned_amount:returned/100,remaining_amount:Math.max(0,total-returned)/100,
      status:returned>=total?"CLOSED":returned>0?"PARTIAL":"OPEN"});
  });
}
function getCompanySummary() {
  const claims=companyClaims_();
  const ledger=companyLedger_();
  return {pool:ledger.pool,projects:ledger.projects,project_catalog:companyProjectCatalog_(ledger),advance_remaining:ledger.remaining,claims:publicRows_(claims),total:claims.reduce((s,c)=>s+Number(c.claim_amount),0),
    returned:claims.reduce((s,c)=>s+Number(c.returned_amount),0),
    remaining:claims.reduce((s,c)=>s+Number(c.remaining_amount),0)};
}
function fifoAllocations_(amount,excludeRefundId) {
  let left=cents_(amount), result=[];
  companyClaims_(excludeRefundId).filter(c=>cents_(c.remaining_amount)>0)
    .sort((a,b)=>String(a.expense_date).localeCompare(String(b.expense_date))||String(a.claim_id).localeCompare(String(b.claim_id)))
    .forEach(c=>{const n=Math.min(left,cents_(c.remaining_amount));if(n>0){result.push({claim_id:c.claim_id,amount:n/100});left-=n;}});
  if(left>0) throw new Error("ยอดเงินคืน "+Number(amount).toFixed(2)+" บาท เกินยอดที่บริษัทค้างคืน "+((cents_(amount)-left)/100).toFixed(2)+" บาท กรุณาตรวจยอดที่ได้รับจริงและรายการค้างคืน");
  return result;
}
function getReimbursementPreview(amount,excludeRefundId) { return fifoAllocations_(positive_(amount),excludeRefundId||""); }
function validateAllocations_(amount,items,excludeRefundId) {
  const claims=Object.fromEntries(companyClaims_(excludeRefundId).map(c=>[c.claim_id,c]));
  const seen=new Set();let sum=0;
  items.forEach(item=>{
    if(seen.has(item.claim_id)||!claims[item.claim_id]) throw new Error("รายการจับคู่เงินคืนไม่ถูกต้อง");
    seen.add(item.claim_id);const n=positive_(item.amount);
    if(cents_(n)>cents_(claims[item.claim_id].remaining_amount)) throw new Error("เงินคืนเกินยอดค้างของรายการ "+item.claim_id);
    sum+=cents_(n);
  });
  if(sum!==cents_(amount)) throw new Error("ยอดจับคู่ต้องเท่ากับยอดเงินคืน");
  return items;
}
function addMatches_(txId,items) {
  matchSheet_(true);
  items.forEach(item=>{
    const match={match_id:id_("MAT"),reimbursement_transaction_id:txId,
      claim_id:item.claim_id,amount:item.amount,status:"ACTIVE",created_at:now_(),updated_at:now_()};
    appendObj_(SH.MATCH,match);
    audit_("COMPANY_MATCH",match.match_id,"CREATE","","",JSON.stringify(match),"");
  });
}
function voidMatches_(txId) {
  matches_().filter(m=>m.reimbursement_transaction_id===txId&&m.status==="ACTIVE").forEach(m=>{
    m.status="VOID";m.updated_at=now_();writeObj_(SH.MATCH,m._row,m);
    audit_("COMPANY_MATCH",m.match_id,"VOID","status","ACTIVE","VOID","รายการเงินคืนเปลี่ยน");
  });
}
function updateClaimTotals_() {
  const current=Object.fromEntries(companyClaims_().map(c=>[c.claim_id,c]));
  rows_(SH.CLAIMS).forEach(c=>{
    const next=current[c.claim_id];
    const old=JSON.stringify({claim_amount:c.claim_amount,returned_amount:c.returned_amount,remaining_amount:c.remaining_amount,status:c.status});
    if(next) Object.assign(c,{claim_amount:next.claim_amount,returned_amount:next.returned_amount,
      remaining_amount:next.remaining_amount,status:next.status,expense_date:next.expense_date,description:next.description,updated_at:now_()});
    else Object.assign(c,{status:"VOID",remaining_amount:0,updated_at:now_()});
    const updated=JSON.stringify({claim_amount:c.claim_amount,returned_amount:c.returned_amount,remaining_amount:c.remaining_amount,status:c.status});
    if(old!==updated){writeObj_(SH.CLAIMS,c._row,c);audit_("COMPANY_CLAIM",c.claim_id,"UPDATE","totals",old,updated,"");}
  });
}
function getTransaction(id) {
  const tx=rows_(SH.TX).find(t=>String(t.transaction_id)===String(id));
  if(!tx) throw new Error("ไม่พบรายการ");return publicRows_([tx])[0];
}
function updateTransaction(id,input) { return withLock_(()=>{
  const old=rows_(SH.TX).find(t=>String(t.transaction_id)===String(id));
  if(!old||old.status!=="ACTIVE") throw new Error("แก้ไขได้เฉพาะรายการ ACTIVE");
  if(input._reclassifyAdvance&&(old.transaction_type!=='INCOME'||old.company_kind||isCompanyRefund_(old))) throw new Error('รายรับนี้เปลี่ยนประเภทไปแล้ว กรุณาโหลดข้อมูลใหม่');
  if(rows_(SH.DEBT_TX).some(d=>d.linked_transaction_id===id&&d.status==="ACTIVE")) throw new Error("รายการชำระหนี้ให้ VOID แล้วบันทึกใหม่");
  const fields=validateTx_(Object.assign({},old,input,{status:"ACTIVE"}),old.category_id,
    old.expense_owner===(input.expense_owner||old.expense_owner)?old.category_id:"",old);
  const next=Object.assign({},old,fields,{updated_at:now_()});
  const oldRefund=isCompanyRefund_(old),newRefund=isCompanyRefund_(next);
  const allocations=planCompanyTransaction_(next,input,oldRefund?id:'');
  prepareCompanyTx_(next);
  const claim=companyClaims_().find(c=>c.transaction_id===id);
  const newCompany=isCompanyExpense_(next);
  if(claim&&cents_(claim.returned_amount)>0&&(!newCompany||cents_(next.amount)<cents_(claim.returned_amount)))
    throw new Error("มีเงินคืนที่จับคู่แล้ว กรุณาปรับเงินคืนก่อน");
  // Refund matching is replaced below; validate funding against every other refund first.
  checkCompanyChange_(next,null,oldRefund?id:'');
  if(oldRefund) voidMatches_(id);
  writeObj_(SH.TX,old._row,next);
  if(newCompany) createClaim_(next);
  if(newRefund) addMatches_(id,allocations);
  if(claim||newCompany||oldRefund||newRefund||next.project_name||next.company_kind||next.company_funding) updateClaimTotals_();
  Object.keys(fields).filter(k=>String(old[k]||"")!==String(next[k]||"")).forEach(k=>
    audit_("TRANSACTION",id,"UPDATE",k,old[k],next[k],input.reason||"แก้ไขรายการ"));
  return transactionMutationResult_();
}); }
function confirmDraft(id,input) { return withLock_(()=>{
  const old=rows_(SH.TX).find(t=>String(t.transaction_id)===String(id));
  if(!old||old.status!=="DRAFT") throw new Error("ไม่พบ DRAFT ที่รอยืนยัน");
  if(old.source_type==="LINE") throw new Error("รายการ LINE ต้องยืนยันผ่าน LINE โดยผู้ส่งเดิม");
  return confirmDraftCore_(old,input,"WEB");
}); }
function confirmDraftCore_(old,input,changeSource) {
  const id=old.transaction_id;
  const fields=validateTx_(Object.assign({},old,input,{status:"ACTIVE"}),old.category_id,
    old.expense_owner===(input.expense_owner||old.expense_owner)?old.category_id:"");
  const next=Object.assign({},old,fields,{updated_at:now_()});
  const allocations=planCompanyTransaction_(next,input,'');
  prepareCompanyTx_(next);
  checkCompanyChange_(next);
  writeObj_(SH.TX,old._row,next);
  if(isCompanyExpense_(next)) createClaim_(next);
  if(allocations.length) addMatches_(id,allocations);
  if(allocations.length||next.project_name||next.company_kind||next.company_funding) updateClaimTotals_();
  audit_("TRANSACTION",id,"CONFIRM","status","DRAFT","ACTIVE","ผู้ใช้ยืนยันรายการ",changeSource);
  return transactionMutationResult_();
}

// LINE เข้าทาง webhook relay ที่ตรวจลายเซ็น LINE ก่อนเท่านั้น
function lineEqual_(a,b) {
  const left=String(a||""),right=String(b||"");
  let difference=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++) difference|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);
  return difference===0;
}
function lineBridgeRequest_(event) {
  if(!event||!event.postData||!event.postData.contents) throw new Error("ไม่มีข้อมูลคำขอ");
  const envelope=JSON.parse(event.postData.contents);
  const secret=PropertiesService.getScriptProperties().getProperty("LINE_BRIDGE_SECRET");
  if(!secret||!envelope||typeof envelope.payload!=="string"||typeof envelope.timestamp!=="number"||
     !Number.isSafeInteger(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000)
    throw new Error("คำขอ LINE ไม่ได้รับอนุญาต");
  const signature=Utilities.base64Encode(Utilities.computeHmacSha256Signature(
    envelope.timestamp+"\n"+envelope.payload,secret));
  if(!lineEqual_(signature,envelope.signature)) throw new Error("ลายเซ็นคำขอ LINE ไม่ถูกต้อง");
  return JSON.parse(envelope.payload);
}
function doPost(event) {
  let result;
  try { result=lineHandleEvent_(lineBridgeRequest_(event)); }
  catch(error) { result={ok:false,error:"คำขอ LINE ไม่ได้รับอนุญาต"}; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function lineAllowed_(userId) {
  const allowed=PropertiesService.getScriptProperties().getProperty("LINE_ALLOWED_USER_IDS")||"";
  return allowed.split(",").map(x=>x.trim()).some(x=>x&&lineEqual_(x,userId));
}
function lineFind_(name,items,idKey,nameKey) {
  const value=String(name||"").trim();
  const found=items.filter(item=>String(item[idKey])===value||String(item[nameKey]).trim()===value);
  if(found.length!==1) throw new Error(found.length?"ชื่อซ้ำ กรุณาใช้รหัสแทน: "+value:"ไม่พบรายการที่เปิดใช้: "+value);
  return found[0];
}
function lineAmount_(text) {
  const value=String(text||"").trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("จำนวนเงินต้องเป็นตัวเลขบวก ทศนิยมไม่เกิน 2 ตำแหน่ง");
  return positive_(value);
}
function lineParse_(text) {
  const parts=String(text||"").split("|").map(x=>x.trim());
  const command=parts[0];
  if(!["รับ","จ่าย","โอน"].includes(command)) throw new Error("ไม่รู้จักคำสั่ง พิมพ์ ช่วยเหลือ เพื่อดูรูปแบบ");
  if(parts.length!==(command==="จ่าย"?6:5)) throw new Error("จำนวนช่องไม่ถูกต้อง พิมพ์ ช่วยเหลือ เพื่อดูรูปแบบ");
  const amount=lineAmount_(parts[1]);
  const accounts=rows_(SH.ACCOUNTS).filter(a=>active_(a.is_active));
  const account=lineFind_(parts[command==="โอน"?2:3],accounts,"account_id","account_name");
  const type=command==="รับ"?"INCOME":command==="จ่าย"?"EXPENSE":"TRANSFER";
  const input={transaction_date:today_(),transaction_type:type,amount,account_id:account.account_id,
    description:parts[command==="จ่าย"?5:4],source_type:"LINE",status:"DRAFT"};
  if(type==="TRANSFER") {
    input.to_account_id=lineFind_(parts[3],accounts,"account_id","account_name").account_id;
  } else {
    if(type==="EXPENSE") {
      input.expense_owner=parts[4]==="บริษัท"?"COMPANY":parts[4]==="ส่วนตัว"?"PERSONAL":"";
      if(!input.expense_owner) throw new Error("เจ้าของรายจ่ายต้องเป็น ส่วนตัว หรือ บริษัท");
    }
    const categories=rows_(SH.CAT).filter(c=>active_(c.is_active)&&c.transaction_type===type&&
      categoryFits_(c,type,input.expense_owner));
    input.category_id=lineFind_(parts[2],categories,"category_id","category_name").category_id;
  }
  return input;
}
function lineSummary_(tx) {
  const account=rows_(SH.ACCOUNTS).find(a=>a.account_id===tx.account_id);
  const to=rows_(SH.ACCOUNTS).find(a=>a.account_id===tx.to_account_id);
  const category=rows_(SH.CAT).find(c=>c.category_id===tx.category_id);
  const type=tx.transaction_type==="INCOME"?"รายรับ":tx.transaction_type==="TRANSFER"?"โอน":"รายจ่าย";
  const owner=tx.expense_owner==="COMPANY"?"บริษัท":tx.expense_owner==="PERSONAL"?"ส่วนตัว":"";
  const lines=[tx.transaction_id+" · "+type+(owner?" ("+owner+")":""),tx.transaction_date+" · "+Number(tx.amount).toFixed(2)+" บาท",
    "บัญชี: "+(account?account.account_name:tx.account_id)+(to?" → "+to.account_name:""),
    category?"หมวด: "+category.category_name:"",tx.description?"รายละเอียด: "+tx.description:""];
  const allocations=tx.line_refund_allocations?JSON.parse(tx.line_refund_allocations):[];
  if(allocations.length) lines.push("จับคู่เงินคืน: "+allocations.map(x=>x.claim_id+" "+Number(x.amount).toFixed(2)).join(", "));
  return lines.filter(Boolean).join("\n");
}
function lineCreateDraft_(event,userId,text) { return withLock_(()=>{
  const eventId=String(event.webhookEventId||"");
  if(!eventId) throw new Error("LINE ไม่มีรหัสเหตุการณ์");
  const duplicate=rows_(SH.TX).find(t=>t.line_event_id===eventId);
  if(duplicate) return duplicate.status==="DRAFT"?"ร่างเดิม (LINE ส่งซ้ำ)\n"+lineSummary_(duplicate)+"\nยืนยันด้วย: ยืนยัน "+duplicate.transaction_id:
    "รายการ "+duplicate.transaction_id+" ดำเนินการแล้ว";
  const input=lineParse_(text),tx=newTx_(validateTx_(input));
  const allocations=isCompanyRefund_(tx)?fifoAllocations_(tx.amount):[];
  tx.line_refund_allocations=allocations.length?JSON.stringify(allocations):"";
  tx.line_user_id=userId;tx.line_event_id=eventId;
  ensureColumn_(SH.TX,"line_user_id","LINE user ID ผู้สร้างร่าง");
  ensureColumn_(SH.TX,"line_event_id","LINE webhook event ID");
  ensureColumn_(SH.TX,"line_refund_allocations","ข้อเสนอจับคู่เงินคืนเมื่อสร้างร่าง");
  appendObj_(SH.TX,tx);
  audit_("TRANSACTION",tx.transaction_id,"CREATE","","",JSON.stringify(tx),"สร้างร่างจาก LINE","LINE");
  return "สร้างฉบับร่างแล้ว (ยังไม่กระทบยอด)\n"+lineSummary_(tx)+"\nตรวจแล้วพิมพ์: ยืนยัน "+tx.transaction_id;
}); }
function lineConfirm_(id,userId) { return withLock_(()=>{
  const tx=rows_(SH.TX).find(t=>t.transaction_id===id&&t.source_type==="LINE"&&t.line_user_id===userId);
  if(!tx) throw new Error("ไม่พบร่าง LINE ของคุณตามรหัสนี้");
  if(tx.status==="ACTIVE") return "รายการ "+id+" ยืนยันไปแล้ว";
  if(tx.status!=="DRAFT") throw new Error("รายการนี้ไม่อยู่ในสถานะรอยืนยัน");
  const proposed=isCompanyRefund_(tx)?fifoAllocations_(tx.amount):[];
  const original=tx.line_refund_allocations||"";
  if(original!== (proposed.length?JSON.stringify(proposed):""))
    throw new Error("ยอดจับคู่เงินคืนเปลี่ยนแล้ว กรุณายกเลิกร่างและสร้างรายการใหม่");
  confirmDraftCore_(tx,{allocations:proposed},"LINE");
  return "ยืนยันและบันทึกยอดแล้ว\n"+lineSummary_(tx);
}); }
function lineDraftList_(userId) {
  const drafts=rows_(SH.TX).filter(t=>t.source_type==="LINE"&&t.line_user_id===userId&&t.status==="DRAFT").slice(-5).reverse();
  return drafts.length?"ร่าง LINE ที่รอยืนยัน\n"+drafts.map(t=>lineSummary_(t)).join("\n\n"):"ไม่มีร่าง LINE ที่รอยืนยัน";
}
function lineHandleEvent_(event) {
  const userId=event&&event.source&&event.source.userId;
  if(!userId||event.source.type!=="user"||!lineAllowed_(userId)) return {ok:false,error:"LINE user ไม่ได้รับอนุญาต"};
  if(event.type!=="message"||!event.message||event.message.type!=="text")
    return {ok:true,reply:"รองรับเฉพาะข้อความ พิมพ์ ช่วยเหลือ เพื่อดูคำสั่ง"};
  const text=String(event.message.text||"").trim();
  try {
    if(text==="ช่วยเหลือ") return {ok:true,reply:"รับ | จำนวน | หมวด | บัญชี | รายละเอียด\nจ่าย | จำนวน | หมวด | บัญชี | ส่วนตัว/บริษัท | รายละเอียด\nโอน | จำนวน | บัญชีต้นทาง | บัญชีปลายทาง | รายละเอียด\nร่าง\nยืนยัน TX-XXXXXXXX\nทุกรายการเป็นฉบับร่างก่อนยืนยัน"};
    if(text==="ร่าง") return {ok:true,reply:lineDraftList_(userId)};
    if(/^ยืนยัน\s+/u.test(text)) {
      const id=text.replace(/^ยืนยัน\s+/u,"").trim();
      if(!/^TX-[A-Z0-9]{8}$/.test(id)) throw new Error("รหัสรายการไม่ถูกต้อง");
      return {ok:true,reply:lineConfirm_(id,userId)};
    }
    return {ok:true,reply:lineCreateDraft_(event,userId,text)};
  } catch(error) { return {ok:true,reply:"ทำรายการไม่ได้: "+error.message}; }
}

function getDashboard() {
  const accounts=rows_(SH.ACCOUNTS), txs=rows_(SH.TX).filter(t=>String(t.status)==="ACTIVE");
  const paymentIds=new Set(rows_(SH.DEBT_TX).filter(d=>d.status==="ACTIVE"&&d.transaction_type==="PAYMENT").map(d=>String(d.linked_transaction_id)));
  const balanceCents={};
  accounts.forEach(a=>balanceCents[a.account_id]=cents_(a.opening_balance));
  const openingCents=Object.values(balanceCents).reduce((sum,value)=>sum+value,0);
  const availableIds=new Set(accounts.filter(accountAvailable_).map(a=>String(a.account_id)));
  const availableOpening=accounts.filter(a=>availableIds.has(String(a.account_id)))
    .reduce((sum,a)=>sum+cents_(a.opening_balance),0);
  let incomeCents=0,personalCents=0,companyCents=0,inflowCents=0,outflowCents=0;
  let availableInflow=0,availableOutflow=0;
  txs.forEach(t=>{ const amount=cents_(t.amount);
    if(t.company_kind==='MOVE') return;
    if(t.company_kind==='SELF_ALLOWANCE') {incomeCents+=amount;companyCents+=amount;return;}
    if(t.transaction_type==="INCOME") {
      balanceCents[t.account_id]=(balanceCents[t.account_id]||0)+amount;
      inflowCents+=amount;
      if(availableIds.has(String(t.account_id))) availableInflow+=amount;
      if(!isCompanyRefund_(t)&&t.company_kind!=='ADVANCE') incomeCents+=amount;
    }
    if(t.transaction_type==="EXPENSE") {
      balanceCents[t.account_id]=(balanceCents[t.account_id]||0)-amount;
      outflowCents+=amount;
      if(availableIds.has(String(t.account_id))) availableOutflow+=amount;
      if(t.expense_owner==="COMPANY") { if(t.company_kind!=='RETURN') companyCents+=amount; }
      else if(!paymentIds.has(String(t.transaction_id))) personalCents+=amount;
    }
    if(t.transaction_type==="TRANSFER") {
      balanceCents[t.account_id]=(balanceCents[t.account_id]||0)-amount;
      balanceCents[t.to_account_id]=(balanceCents[t.to_account_id]||0)+amount;
      if(availableIds.has(String(t.account_id))&&!availableIds.has(String(t.to_account_id))) availableOutflow+=amount;
      if(!availableIds.has(String(t.account_id))&&availableIds.has(String(t.to_account_id))) availableInflow+=amount;
    }
  });
  const totalCents=Object.values(balanceCents).reduce((sum,value)=>sum+value,0);
  const availableCents=[...availableIds].reduce((sum,id)=>sum+(balanceCents[id]||0),0);
  const balances=Object.fromEntries(Object.entries(balanceCents).map(([id,value])=>[id,value/100]));
  const companyDue=getCompanySummary().remaining;
  const debt=getDebts().reduce((s,d)=>s+d.balance,0);
  return {real_cash:totalCents/100,available_cash:availableCents/100,available_opening:availableOpening/100,
    available_inflow:availableInflow/100,available_outflow:availableOutflow/100,
    balances,income:incomeCents/100,personal_expense:personalCents/100,
    company_expense:companyCents/100,company_receivable:companyDue,debt_balance:debt,
    opening_total:openingCents/100,cash_inflow:inflowCents/100,cash_outflow:outflowCents/100,
    company_advance:companyLedger_().remaining,net_position:totalCents/100+companyDue-debt-companyLedger_().remaining};
}
function isCompanyRefund_(t) {
  const c=category_(t.category_id);
  return !!c && c.transaction_type==="INCOME" && String(c.category_name)==="เงินคืนบริษัท";
}

function reconcileDatabase() {
  const problems=[]; rows_(SH.TX).forEach((t,i)=>{
    if(!t.transaction_id) problems.push("รายการเงิน แถว "+(i+3)+" ไม่มี transaction_id");
    if(!(Number(t.amount)>0)) problems.push("รายการ "+t.transaction_id+" จำนวนเงินไม่ถูกต้อง");
    if(!["ACTIVE","VOID","DRAFT"].includes(String(t.status))) problems.push("รายการ "+t.transaction_id+" status ไม่ถูกต้อง");
  });
  return {ok:problems.length===0,problems,dashboard:getDashboard()};
}


function getTransactions(filters) {
  const f=filters||{};
  const accounts = rows_(SH.ACCOUNTS);
  const categories = rows_(SH.CAT);
  const am = Object.fromEntries(accounts.map(a => [String(a.account_id), a.account_name]));
  const cm = Object.fromEntries(categories.map(c => [String(c.category_id), c.category_name]));
  return publicRows_(rows_(SH.TX)
    .filter(t=>(f.date?String(t.transaction_date)===String(f.date):!f.month||String(t.transaction_date).slice(0,7)===f.month)&&(!f.type||t.transaction_type===f.type)&&
      (!f.owner||t.expense_owner===f.owner)&&(!f.account_id||t.account_id===f.account_id||t.to_account_id===f.account_id)&&
      (!f.category_id||t.category_id===f.category_id)&&(!f.query||String(t.description||"").toLocaleLowerCase().includes(String(f.query).toLocaleLowerCase())))
    .sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))||String(b.created_at).localeCompare(String(a.created_at)))
    .map(t=>({...t,account_name:am[String(t.account_id)]||t.account_id,
      to_account_name:am[String(t.to_account_id)]||"",category_name:cm[String(t.category_id)]||""})));
}
function getLatestTransactions(limit) { return getTransactions({}).slice(0,Math.min(50,Math.max(1,Number(limit)||8))); }

function debtBalance_(debt,items) {
  const delta=items.filter(t=>t.debt_id===debt.debt_id&&t.status==="ACTIVE")
    .reduce((s,t)=>s+(["INCREASE","ADJUST_UP"].includes(t.transaction_type)?cents_(t.amount):
      ["PAYMENT","ADJUST_DOWN"].includes(t.transaction_type)?-cents_(t.amount):0),0);
  return Math.max(0,cents_(debt.opening_balance)+delta)/100;
}
function debtPlanSheet_(create) {
  let sheet=ss_().getSheetByName(SH.DEBT_PLAN);
  if(!sheet&&create) {
    sheet=ss_().insertSheet(SH.DEBT_PLAN);
    sheet.getRange(1,1,1,8).setValues([["plan_id","debt_id","due_month","amount","status","created_at","updated_at","paid_at_setting"]]);
    sheet.getRange(2,1,1,8).setValues([["รหัสแผน","รหัสหนี้","เดือนที่ต้องจ่าย","ยอดที่ยังต้องจ่าย","สถานะ","สร้างเมื่อ","แก้ไขเมื่อ","ยอดที่จ่ายแล้วตอนตั้งค่า"]]);
    sheet.setFrozenRows(2);
  }
  return sheet;
}
function debtPlanRows_() { return debtPlanSheet_(false)?rows_(SH.DEBT_PLAN):[]; }
function monthDueDate_(month,day) {
  const year=Number(month.slice(0,4)),number=Number(month.slice(5,7));
  const last=new Date(Date.UTC(year,number,0)).getUTCDate();
  return month+"-"+String(Math.min(Math.max(1,Number(day)||1),last)).padStart(2,"0");
}
function getDebts() {
  const items=rows_(SH.DEBT_TX),plans=debtPlanRows_().filter(p=>p.status==="ACTIVE"),month=today_().slice(0,7);
  return publicRows_(rows_(SH.DEBTS).filter(d=>d.status!=="VOID").map(d=>{
    const balance=debtBalance_(d,items);
    const debtPlans=plans.filter(p=>p.debt_id===d.debt_id)
      .sort((a,b)=>String(a.due_month).localeCompare(String(b.due_month))||a._row-b._row);
    const latestPlans=[...new Map(debtPlans.map(p=>[String(p.due_month).slice(0,7),p])).values()];
    const payments=items.filter(t=>t.debt_id===d.debt_id&&t.status==="ACTIVE"&&t.transaction_type==="PAYMENT");
    const monthPayments=payments.filter(t=>String(t.transaction_date).slice(0,7)===month);
    const paidThisMonth=monthPayments.reduce((sum,t)=>sum+cents_(t.amount),0);
    const monthly=latestPlans.find(p=>String(p.due_month).slice(0,7)===month);
    const target=Math.max(0,cents_(monthly?monthly.amount:d.due_amount));
    const paidAtSetting=monthly ? (monthly.paid_at_setting!==""&&monthly.paid_at_setting!=null
      ? cents_(monthly.paid_at_setting)
      : monthPayments.filter(t=>String(t.created_at||"")<=String(monthly.created_at||""))
        .reduce((sum,t)=>sum+cents_(t.amount),0)) : 0;
    const dueCents=Math.min(cents_(balance),Math.max(0,target+paidAtSetting-paidThisMonth));
    return Object.assign({},d,{balance,due_date:monthDueDate_(month,d.due_day),due_amount:dueCents/100,
      monthly_target:target/100,default_due_amount:Number(d.due_amount)||0,
      monthly_dues:latestPlans.map(p=>({due_month:String(p.due_month).slice(0,7),amount:Number(p.amount)})),
      paid_this_month:paidThisMonth/100,needs_due:balance>0&&target===0});
  }));
}
function setDebtMonthlyDue(input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>String(d.debt_id)===String(input.debt_id)&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const month=String(input.due_month||today_().slice(0,7)),amount=Number(input.amount);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("เดือนไม่ถูกต้อง");
  if(!isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>0.000001) throw new Error("ยอดที่ต้องจ่ายไม่ถูกต้อง");
  const debtItems=rows_(SH.DEBT_TX);
  if(cents_(amount)>cents_(debtBalance_(debt,debtItems))) throw new Error("ยอดที่ต้องจ่ายเกินหนี้คงเหลือ");
  const paidAtSetting=debtItems.filter(t=>t.debt_id===debt.debt_id&&t.status==="ACTIVE"&&
    t.transaction_type==="PAYMENT"&&String(t.transaction_date).slice(0,7)===month)
    .reduce((sum,t)=>sum+cents_(t.amount),0)/100;
  debtPlanSheet_(true);
  ensureColumn_(SH.DEBT_PLAN,"paid_at_setting","ยอดที่จ่ายแล้วตอนตั้งค่า");
  debtPlanRows_().filter(p=>p.debt_id===debt.debt_id&&String(p.due_month).slice(0,7)===month&&p.status==="ACTIVE").forEach(p=>{
    p.status="VOID";p.updated_at=now_();writeObj_(SH.DEBT_PLAN,p._row,p);
    audit_("DEBT_PLAN",p.plan_id,"VOID","status","ACTIVE","VOID","เปลี่ยนยอดที่ต้องจ่ายรายเดือน");
  });
  const item={plan_id:id_("DPL"),debt_id:debt.debt_id,due_month:month,amount,status:"ACTIVE",created_at:now_(),updated_at:now_(),paid_at_setting:paidAtSetting};
  appendObj_(SH.DEBT_PLAN,item);audit_("DEBT_PLAN",item.plan_id,"CREATE","","",JSON.stringify(item),"กำหนดยอดจ่ายรายเดือน");
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function adjustDebtBalance(input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>String(d.debt_id)===String(input.debt_id)&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const target=Number(input.balance),before=debtBalance_(debt,rows_(SH.DEBT_TX));
  if(!isFinite(target)||target<0||Math.abs(target*100-Math.round(target*100))>0.000001) throw new Error("ยอดหนี้ใหม่ไม่ถูกต้อง");
  const delta=cents_(target)-cents_(before);
  if(delta) {
    const reason=String(input.reason||"").trim();if(!reason) throw new Error("กรุณาระบุเหตุผลการปรับยอด");
    const item={debt_transaction_id:id_("DTX"),debt_id:debt.debt_id,transaction_date:isoDate_(input.transaction_date),
      transaction_type:delta>0?"ADJUST_UP":"ADJUST_DOWN",amount:Math.abs(delta)/100,account_id:"",linked_transaction_id:"",
      description:reason,status:"ACTIVE",created_at:now_(),updated_at:now_()};
    appendObj_(SH.DEBT_TX,item);audit_("DEBT",debt.debt_id,"ADJUST","balance",before,target,reason);
  }
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function saveDebtPlan(debtId,input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>String(d.debt_id)===String(debtId)&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const submitted=input&&input.installments;
  if(!Array.isArray(submitted)||submitted.length<1||submitted.length>36) throw new Error("กำหนดแผนได้ 1–36 เดือน");
  const month=today_().slice(0,7),seen=new Set();
  const installments=submitted.map(row=>{
    const dueMonth=String(row.due_month||""),amount=Number(row.amount);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(dueMonth)||dueMonth<month||seen.has(dueMonth)) throw new Error("เดือนในแผนไม่ถูกต้องหรือซ้ำกัน");
    if(!isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>0.000001) throw new Error("ยอดแผนต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง");
    seen.add(dueMonth);return {due_month:dueMonth,amount};
  }).sort((a,b)=>a.due_month.localeCompare(b.due_month));
  const total=installments.reduce((sum,item)=>sum+cents_(item.amount),0);
  if(!total) throw new Error("กรุณากำหนดยอดอย่างน้อยหนึ่งเดือน");
  const debtItems=rows_(SH.DEBT_TX),retained=debtPlanRows_().filter(p=>p.debt_id===debtId&&p.status==="ACTIVE"&&String(p.due_month).slice(0,7)<month);
  const firstMonth=[...retained.map(p=>String(p.due_month).slice(0,7)),installments[0].due_month].sort()[0];
  const paidSince=debtItems.filter(t=>t.debt_id===debtId&&t.status==="ACTIVE"&&t.transaction_type==="PAYMENT"&&
    String(t.transaction_date).slice(0,7)>=firstMonth&&String(t.transaction_date).slice(0,7)<=month).reduce((sum,t)=>sum+cents_(t.amount),0);
  const pastPlanned=retained.reduce((sum,p)=>sum+cents_(p.amount),0);
  if(total>cents_(debtBalance_(debt,debtItems))-pastPlanned+paidSince) throw new Error("ยอดรวมแผนเกินหนี้คงเหลือ");
  debtPlanSheet_(true);
  ensureColumn_(SH.DEBT_PLAN,"paid_at_setting","ยอดที่จ่ายแล้วตอนตั้งค่า");
  debtPlanRows_().filter(p=>p.debt_id===debtId&&p.status==="ACTIVE"&&String(p.due_month).slice(0,7)>=month).forEach(p=>{
    p.status="VOID";p.updated_at=now_();writeObj_(SH.DEBT_PLAN,p._row,p);
    audit_("DEBT_PLAN",p.plan_id,"VOID","status","ACTIVE","VOID","ปรับแผนชำระหนี้");
  });
  installments.forEach(item=>{
    const paidAtSetting=debtItems.filter(t=>t.debt_id===debtId&&t.status==="ACTIVE"&&t.transaction_type==="PAYMENT"&&
      String(t.transaction_date).slice(0,7)===item.due_month).reduce((sum,t)=>sum+cents_(t.amount),0)/100;
    const plan={plan_id:id_("DPL"),debt_id:debtId,due_month:item.due_month,amount:item.amount,status:"ACTIVE",created_at:now_(),updated_at:now_(),paid_at_setting:paidAtSetting};
    appendObj_(SH.DEBT_PLAN,plan);audit_("DEBT_PLAN",plan.plan_id,"CREATE","","",JSON.stringify(plan),"");
  });
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function createDebt(input) { return withLock_(()=>{
  const name=String(input.debt_name||"").trim(), opening=Number(input.opening_balance||0),day=Number(input.due_day);
  const dueAmount=Number(input.due_amount||0),interest=Number(input.total_interest||0);
  if(!name) throw new Error("กรุณาระบุชื่อเจ้าหนี้");
  if(!isFinite(opening)||opening<0||Math.abs(opening*100-Math.round(opening*100))>0.000001) throw new Error("ยอดหนี้เริ่มต้นไม่ถูกต้อง");
  if(!Number.isInteger(day)||day<1||day>31) throw new Error("วันครบกำหนดต้องอยู่ระหว่าง 1–31");
  if(!isFinite(dueAmount)||dueAmount<0||cents_(dueAmount)>cents_(opening)||Math.abs(dueAmount*100-Math.round(dueAmount*100))>0.000001)
    throw new Error("ยอดจ่ายเดือนนี้ต้องไม่เกินหนี้เริ่มต้น");
  if(!isFinite(interest)||interest<0||Math.abs(interest*100-Math.round(interest*100))>0.000001) throw new Error("ดอกเบี้ยรวมไม่ถูกต้อง");
  ensureColumn_(SH.DEBTS,"due_amount","จำนวนที่ต้องจ่ายรอบนี้");
  const debt={debt_id:id_("DEB"),user_id:USER_ID,debt_name:name,debt_type:String(input.debt_type||"OTHER"),
    opening_balance:opening,start_date:isoDate_(input.start_date),due_day:day,total_interest:interest,
    status:"ACTIVE",note:String(input.note||""),due_amount:0};
  appendObj_(SH.DEBTS,debt);audit_("DEBT",debt.debt_id,"CREATE","","",JSON.stringify(debt),"");
  if(dueAmount>0) {
    debtPlanSheet_(true);
    ensureColumn_(SH.DEBT_PLAN,"paid_at_setting","ยอดที่จ่ายแล้วตอนตั้งค่า");
    const plan={plan_id:id_("DPL"),debt_id:debt.debt_id,due_month:today_().slice(0,7),amount:dueAmount,
      status:"ACTIVE",created_at:now_(),updated_at:now_(),paid_at_setting:0};
    appendObj_(SH.DEBT_PLAN,plan);
    audit_("DEBT_PLAN",plan.plan_id,"CREATE","","",JSON.stringify(plan),"ยอดจ่ายเดือนที่เพิ่มหนี้");
  }
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function renameDebt(input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>String(d.debt_id)===String(input.debt_id)&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const name=String(input.debt_name||"").trim();
  if(!name||name.length>100) throw new Error("ชื่อเจ้าหนี้ต้องมี 1–100 ตัวอักษร");
  if(name!==debt.debt_name) {
    const old=debt.debt_name;
    debt.debt_name=name;writeObj_(SH.DEBTS,debt._row,debt);
    audit_("DEBT",debt.debt_id,"UPDATE","debt_name",old,name,"");
  }
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function increaseDebt(input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>d.debt_id===input.debt_id&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const item={debt_transaction_id:id_("DTX"),debt_id:debt.debt_id,transaction_date:isoDate_(input.transaction_date),
    transaction_type:"INCREASE",amount:positive_(input.amount),account_id:"",linked_transaction_id:"",
    description:String(input.description||""),status:"ACTIVE",created_at:now_(),updated_at:now_()};
  appendObj_(SH.DEBT_TX,item);audit_("DEBT_TRANSACTION",item.debt_transaction_id,"CREATE","","",JSON.stringify(item),"");
  return {ok:true,debts:getDebts(),dashboard:getDashboard()};
}); }
function debtPaymentCategory_() {
  const c=rows_(SH.CAT).find(x=>x.transaction_type==="EXPENSE"&&x.category_name==="ชำระหนี้");
  if(!c) throw new Error("ไม่พบหมวดหมู่ชำระหนี้");return c.category_id;
}
function payDebt(input) { return withLock_(()=>{
  const debt=rows_(SH.DEBTS).find(d=>d.debt_id===input.debt_id&&d.status!=="VOID");
  if(!debt) throw new Error("ไม่พบเจ้าหนี้");
  const amount=positive_(input.amount);
  if(cents_(amount)>cents_(debtBalance_(debt,rows_(SH.DEBT_TX)))) throw new Error("ยอดชำระเกินหนี้คงเหลือ");
  const fields=validateTx_({transaction_type:"EXPENSE",transaction_date:input.transaction_date,amount,
    account_id:input.account_id,category_id:debtPaymentCategory_(),expense_owner:"PERSONAL",
    description:"ชำระหนี้ "+debt.debt_name,source_type:"WEB",status:"ACTIVE"});
  const tx=newTx_(fields),item={debt_transaction_id:id_("DTX"),debt_id:debt.debt_id,
    transaction_date:tx.transaction_date,transaction_type:"PAYMENT",amount,account_id:tx.account_id,
    linked_transaction_id:tx.transaction_id,description:String(input.description||""),status:"ACTIVE",created_at:now_(),updated_at:now_()};
  appendObj_(SH.TX,tx);appendObj_(SH.DEBT_TX,item);
  audit_("TRANSACTION",tx.transaction_id,"CREATE","","",JSON.stringify(tx),"ชำระหนี้");
  audit_("DEBT_TRANSACTION",item.debt_transaction_id,"CREATE","","",JSON.stringify(item),"");
  return transactionMutationResult_({id:tx.transaction_id});
}); }

function recurringDueDate_(recurring,today) {
  const start=String(recurring.start_date||today).slice(0,10);
  const base=String(today.slice(0,7)>start.slice(0,7)?today:start).slice(0,7);
  const day=Math.max(1,Math.min(31,Number(recurring.due_day)||1));
  const dueFor=month=>{
    const year=Number(month.slice(0,4)),number=Number(month.slice(5,7));
    const last=new Date(Date.UTC(year,number,0)).getUTCDate();
    return month+"-"+String(Math.min(day,last)).padStart(2,"0");
  };
  let due=dueFor(base);
  if(due<start) {
    const next=new Date(Date.UTC(Number(base.slice(0,4)),Number(base.slice(5,7)),1));
    due=dueFor(next.toISOString().slice(0,7));
  }
  return due;
}
function getRecurringDue() {
  const today=today_(),month=today.slice(0,7),paid=rows_(SH.TX).filter(t=>t.status==="ACTIVE"&&t.recurring_id);
  return publicRows_(rows_(SH.RECUR).filter(r=>active_(r.is_active)).map(r=>{
    const due=recurringDueDate_(r,today);
    return Object.assign(r,{next_due:due,paid_this_month:paid.some(t=>t.recurring_id===r.recurring_id&&String(t.transaction_date).slice(0,7)===month)});
  }).filter(r=>!r.end_date||String(r.end_date)>=r.next_due)
    .sort((a,b)=>String(a.next_due).localeCompare(String(b.next_due))||String(a.recurring_name).localeCompare(String(b.recurring_name))));
}
function createRecurring(input) { return withLock_(()=>{
  const fields=validateTx_({transaction_type:input.transaction_type,transaction_date:input.start_date,
    amount:input.amount,account_id:input.account_id,category_id:input.category_id,expense_owner:input.expense_owner,status:"ACTIVE"});
  if(fields.transaction_type==="TRANSFER") throw new Error("รายการประจำยังไม่รองรับการโอนเงิน");
  const icon=String(input.icon_key||"repeat");
  if(!["repeat","wallet","home","cash","debt","company","shopping-bag","music"].includes(icon)) throw new Error("ไอคอนไม่ถูกต้อง");
  const day=Number(input.due_day);
  if(!Number.isInteger(day)||day<1||day>31) throw new Error("วันครบกำหนดต้องอยู่ระหว่าง 1–31");
  ensureColumn_(SH.RECUR,"icon_key","ไอคอนรายการประจำ");
  const item={recurring_id:id_("REC"),user_id:USER_ID,recurring_name:String(input.recurring_name||"").trim(),icon_key:icon,
    transaction_type:fields.transaction_type,amount:fields.amount,frequency:"MONTHLY",due_day:day,
    account_id:fields.account_id,category_id:fields.category_id,expense_owner:fields.expense_owner,
    start_date:fields.transaction_date,end_date:input.end_date?isoDate_(input.end_date):"",is_active:true,note:String(input.note||"")};
  if(!item.recurring_name) throw new Error("กรุณาระบุชื่อรายการประจำ");
  appendObj_(SH.RECUR,item);audit_("RECURRING",item.recurring_id,"CREATE","","",JSON.stringify(item),"");
  return {ok:true,recurring:getRecurringDue()};
}); }
function deactivateRecurring(id) { return withLock_(()=>{
  const item=rows_(SH.RECUR).find(r=>String(r.recurring_id)===String(id)&&active_(r.is_active));
  if(!item) throw new Error("ไม่พบรายการประจำที่ใช้งานอยู่");
  item.is_active=false;
  writeObj_(SH.RECUR,item._row,item);
  audit_("RECURRING",item.recurring_id,"DEACTIVATE","is_active",true,false,"หยุดรายการประจำ");
  return {ok:true,recurring:getRecurringDue()};
}); }
function payRecurring(input) { return withLock_(()=>{
  const item=rows_(SH.RECUR).find(r=>r.recurring_id===input.recurring_id&&active_(r.is_active));
  if(!item) throw new Error("ไม่พบรายการประจำ");
  ensureColumn_(SH.TX,"recurring_id","รหัสรายการประจำ");
  const fields=validateTx_({transaction_type:item.transaction_type,transaction_date:input.transaction_date,
    amount:input.amount,account_id:input.account_id,category_id:item.category_id,expense_owner:item.expense_owner,
    description:item.recurring_name,source_type:"WEB",status:"ACTIVE"},item.category_id,item.category_id);
  const tx=newTx_(Object.assign(fields,{recurring_id:item.recurring_id}));
  if(isCompanyRefund_(tx)) throw new Error("เงินคืนบริษัทต้องใช้หน้าบันทึกเงินคืน");
  appendObj_(SH.TX,tx);
  if(tx.transaction_type==="EXPENSE"&&tx.expense_owner==="COMPANY") createClaim_(tx);
  audit_("TRANSACTION",tx.transaction_id,"CREATE","","",JSON.stringify(tx),"จ่ายรายการประจำ");
  return transactionMutationResult_();
}); }
