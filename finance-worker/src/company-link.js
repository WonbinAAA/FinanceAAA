import {AppError} from './errors.js';
import {executeFinance} from './finance.js';
import {sha256} from './auth.js';
import {loadSnapshot,commitSnapshot,receipt} from './storage.js';
import {moneyCents} from './schema.js';

const SOURCE='company-expenses-ledger';
const fail=(message,code='COMPANY_LINK_REVIEW')=>{throw new AppError(message,409,code);};
const row=(snapshot,id)=>snapshot.tables['รายการเงิน'].rows.find(r=>r.transaction_id===id);
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
export const linkHash=value=>sha256(JSON.stringify(canonical(value)));
const amount=cents=>(cents/100).toFixed(2);
const active=entry=>!entry.deleted;
function owner(ownerId){if(ownerId!=='owner')throw new AppError('เชื่อมได้เฉพาะสมุดเจ้าของที่กำหนดไว้',403);}
export function cleanSource(value){
  if(!value||typeof value.id!=='string'||!value.id||value.id.length>100||!Number.isSafeInteger(value.revision)||value.revision<1
    ||!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!['income','expense'].includes(value.direction)
    ||!Number.isSafeInteger(value.amount_cents)||value.amount_cents<=0||typeof value.deleted!=='boolean')fail('ข้อมูลต้นทางสำหรับเชื่อมไม่ถูกต้อง');
  const date=new Date(value.date+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value.date)fail('วันที่ต้นทางไม่ถูกต้อง');
  for(const key of ['item_name','note','recipient'])if(typeof value[key]!=='string'||value[key].length>(key==='note'?2000:300))fail('รายละเอียดต้นทางไม่ถูกต้อง');
  return {id:value.id,revision:value.revision,date:value.date,direction:value.direction,amount_cents:value.amount_cents,
    item_name:value.item_name,note:value.note,recipient:value.recipient,deleted:value.deleted,finance:cleanConfig(value.finance)};
}
export function cleanConfig(value){
  if(!value||!['EXPENSE','OTHER_ALLOWANCE','SELF_ALLOWANCE','ADVANCE','REIMBURSEMENT'].includes(value.kind)
    ||!['','PERSONAL','POOL','PROJECT'].includes(value.funding))fail('กรุณาเลือกประเภทเงินและแหล่งเงิน');
  const text=key=>{if(typeof value[key]!=='string'||value[key].length>100)fail('ข้อมูลบัญชีหรือหมวดหมู่ไม่ถูกต้อง');return value[key];};
  const result={kind:value.kind,funding:value.funding,accountId:text('accountId'),categoryId:text('categoryId'),projectName:text('projectName')};
  if(!result.accountId)fail('กรุณาเลือกบัญชีเงินจริง');
  if(result.kind==='REIMBURSEMENT'){
    if(!Array.isArray(value.allocations)||value.allocations.length>200)fail('กรุณาเลือกรายการรับคืนด้วยตนเอง');
    result.allocations=value.allocations.map(a=>{if(typeof a.claim_id!=='string'||!a.claim_id||!Number.isSafeInteger(a.cents)||a.cents<=0)fail('ยอดจับคู่เงินคืนไม่ถูกต้อง');return {claim_id:a.claim_id,cents:a.cents};});
    if(new Set(result.allocations.map(a=>a.claim_id)).size!==result.allocations.length)fail('มีรายการรับคืนซ้ำ');
    result.surplusConfirmed=value.surplusConfirmed===true;
  }
  if(value.shortfallConfirmed===true){if(!Number.isSafeInteger(value.expectedPersonalCents)||value.expectedPersonalCents<0)fail('กรุณาตรวจส่วนที่ออกเงินแทน');result.shortfallConfirmed=true;result.expectedPersonalCents=value.expectedPersonalCents;}
  return result;
}
function inputFor(sources,config,target){
  const entries=sources.filter(active),sum=entries.reduce((n,e)=>n+e.amount_cents,0);
  if(!Number.isSafeInteger(sum)||sum<=0)fail('ยอดรวมต้นทางไม่ถูกต้อง');
  if(new Set(entries.map(e=>e.date)).size!==1||new Set(entries.map(e=>e.direction)).size!==1)fail('รายการที่เคยรวมยอดมีวันหรือทิศทางเงินต่างกัน ต้องตรวจแยกรายการก่อน');
  const c=cleanConfig(config),incoming=['ADVANCE','REIMBURSEMENT'].includes(c.kind);
  if(entries[0].direction!==(incoming?'income':'expense'))fail('ประเภทเงินไม่ตรงกับเงินรับหรือเงินจ่าย');
  const description=entries.map(e=>[e.item_name,e.note].filter(Boolean).join(' · ')).join('\n');
  const input={transaction_date:entries[0].date,transaction_type:incoming?'INCOME':'EXPENSE',amount:amount(sum),
    account_id:c.accountId,category_id:c.categoryId,expense_owner:incoming?'':'COMPANY',description,
    company_kind:['EXPENSE','REIMBURSEMENT'].includes(c.kind)?'':c.kind,company_funding:c.funding,project_name:c.projectName,
    recipient:entries.map(e=>e.recipient).filter(Boolean).join('/').slice(0,80),source_type:'WEB',status:'ACTIVE',reason:'ปรับจากเว็บค่าใช้จ่ายบริษัท'};
  if(c.kind==='REIMBURSEMENT'){
    const refund=c.allocations.reduce((n,a)=>n+a.cents,0);if(refund>sum)fail('ยอดรับคืนที่เลือกเกินเงินรับจริง');
    Object.assign(input,{allocations:c.allocations.map(a=>({claim_id:a.claim_id,amount:amount(a.cents)})),company_surplus_to_pool:true,
      company_surplus_confirmed:c.surplusConfirmed,company_expected_refund:amount(refund),company_expected_pool:amount(sum-refund)});
  }
  if(c.shortfallConfirmed)Object.assign(input,{company_shortfall_confirmed:true,company_expected_personal:amount(c.expectedPersonalCents)});
  // Historical categories may be inactive; the engine validates them against the old row on update.
  if(target?.attachment_url)input.attachment_url=target.attachment_url;
  return input;
}
async function control(db){return !!(await db.prepare('SELECT enabled FROM company_link_control WHERE singleton=1').first())?.enabled;}
export async function companyOptions(env,ownerId){
  owner(ownerId);const snapshot=await loadSnapshot(env.DB),bootstrap=executeFinance(snapshot,'getBootstrap').result;
  const sources=(await env.DB.prepare('SELECT id,payload_json FROM company_link_sources').all()).results;
  return {enabled:await control(env.DB),accounts:bootstrap.accounts,categories:bootstrap.categories,
    company:executeFinance(snapshot,'getCompanySummary').result,links:sources.map(s=>({id:s.id,finance:JSON.parse(s.payload_json).finance})),revision:snapshot.revision};
}
export async function previewCompany(env,ownerId,entry,strict=false){
  owner(ownerId);const source=cleanSource(entry),snapshot=await loadSnapshot(env.DB);
  const linked=await env.DB.prepare('SELECT g.* FROM company_link_sources s JOIN company_link_groups g ON g.id=s.group_id WHERE s.id=?').bind(source.id).first();
  if(linked){
    const members=(await env.DB.prepare('SELECT payload_json FROM company_link_sources WHERE group_id=?').bind(linked.id).all()).results.map(s=>JSON.parse(s.payload_json));
    const old=members.find(s=>s.id===source.id)?.finance;
    if(!source.finance.funding&&source.finance.kind!=='REIMBURSEMENT'&&(!old||old.funding!==''||old.kind!==source.finance.kind))fail('กรุณาเลือกแหล่งเงิน ไม่สามารถล้างแหล่งเงินที่ระบุไว้แล้ว');
    if(members.length>1&&JSON.stringify(source.finance)!==JSON.stringify(JSON.parse(linked.config_json)))fail('รายการนี้รวมจ่ายหลายคน เปลี่ยนบัญชีหรือแหล่งเงินแยกคนไม่ได้');
    const next=members.map(e=>e.id===source.id?source:e),target=row(snapshot,linked.transaction_id);
    if(await linkHash(target)!==linked.transaction_hash)fail('รายการเว็บการเงินเปลี่ยนแยกจากต้นทาง ต้องตรวจเทียบก่อน');
    if(!next.some(active)){if(strict&&target?.status==='ACTIVE')executeFinance(snapshot,'voidTransaction',[linked.transaction_id,'ยกเลิกจากบริษัท']);return {funding:null};}
    const input=inputFor(next,source.finance,target),targetId=target?.status==='ACTIVE'?linked.transaction_id:'';
    const funding=source.direction==='expense'?executeFinance(snapshot,'getCompanyFundingPreview',[input,targetId]).result:null;
    if(strict)executeFinance(snapshot,targetId?'updateTransaction':'saveTransaction',targetId?[targetId,input]:[input]);
    return {funding};
  }
  if(!source.finance.funding&&source.finance.kind!=='REIMBURSEMENT')fail('กรุณาเลือกแหล่งเงินสำหรับรายการใหม่');
  if(source.deleted)return {funding:null};
  const input=inputFor([source],source.finance),funding=source.direction==='expense'?executeFinance(snapshot,'getCompanyFundingPreview',[input,'']).result:null;
  if(strict)executeFinance(snapshot,'saveTransaction',[input]);
  return {funding};
}

export async function previewCompanyBatch(env,ownerId,values,strict=false){
  owner(ownerId);if(!Array.isArray(values)||!values.length||values.length>50)fail('รายการเบี้ยเลี้ยงไม่ถูกต้อง');
  let snapshot=await loadSnapshot(env.DB);const result=[],ids=new Set();
  for(const value of values){
    const source=cleanSource(value);
    if(ids.has(source.id)||source.deleted||source.direction!=='expense'||!['OTHER_ALLOWANCE','SELF_ALLOWANCE'].includes(source.finance.kind))fail('ประเภทรายการเบี้ยเลี้ยงไม่ถูกต้อง');
    ids.add(source.id);
    if(await env.DB.prepare('SELECT 1 FROM company_link_sources WHERE id=?').bind(source.id).first())fail('เบี้ยเลี้ยงชุดใหม่ใช้รหัสรายการเดิมไม่ได้');
    if(!source.finance.funding)fail('กรุณาเลือกแหล่งเงินเบี้ยเลี้ยง');
    const input=inputFor([source],source.finance),funding=executeFinance(snapshot,'getCompanyFundingPreview',[input,'']).result;
    if(!strict&&source.finance.funding!=='PERSONAL')Object.assign(input,{company_shortfall_confirmed:true,company_expected_personal:funding.personal_amount});
    snapshot=executeFinance(snapshot,'saveTransaction',[input]).snapshot;
    result.push({id:source.id,funding});
  }
  return {entries:result};
}

export async function applyCompanyEvent(env,event){
  owner(event?.ownerId);if(event?.source!==SOURCE)fail('ต้นทางไม่ถูกต้อง');
  if(!await control(env.DB))fail('กำลังตรวจประวัติเดิม ยังไม่เปิดเชื่อมยอด');
  const source=cleanSource(event.entry),hash=await linkHash(source),requestId='company-'+source.id+'-'+source.revision;
  const saved=await receipt(env.DB,requestId,hash);if(saved)return saved;
  const before=await loadSnapshot(env.DB);
  const stored=await env.DB.prepare('SELECT * FROM company_link_sources WHERE id=?').bind(source.id).first();
  if(stored&&source.revision<=stored.revision){if(source.revision===stored.revision&&JSON.stringify(source)===stored.payload_json)return {ok:true,unchanged:true};fail('ลำดับข้อมูลต้นทางเก่ากว่ารายการที่เชื่อมแล้ว');}
  let group=stored?await env.DB.prepare('SELECT * FROM company_link_groups WHERE id=?').bind(stored.group_id).first():null;
  const previous=group?(await env.DB.prepare('SELECT payload_json FROM company_link_sources WHERE group_id=?').bind(group.id).all()).results.map(s=>JSON.parse(s.payload_json)):[];
  if(previous.length>1&&JSON.stringify(source.finance)!==group.config_json)fail('รายการนี้รวมจ่ายหลายคน ต้องคงบัญชีและแหล่งเงินร่วมกัน');
  if(!stored&&!source.finance.funding&&source.finance.kind!=='REIMBURSEMENT')fail('รายการใหม่ต้องระบุแหล่งเงิน');
  if(stored&&!source.finance.funding&&source.finance.kind!=='REIMBURSEMENT'){
    const old=JSON.parse(stored.payload_json).finance;
    if(old.funding!==''||old.kind!==source.finance.kind)fail('ไม่สามารถล้างแหล่งเงินที่ระบุไว้แล้ว');
  }
  const entries=stored?previous.map(e=>e.id===source.id?source:e):[source];
  const current=group?row(before,group.transaction_id):null;
  if(group&&(!current||await linkHash(current)!==group.transaction_hash))fail('รายการเว็บการเงินถูกแก้แยกจากต้นทาง กรุณาตรวจเทียบก่อนเชื่อมต่อ');
  let executed={snapshot:before,result:{}},transactionId=current?.transaction_id;
  if(!entries.some(active)){
    if(current?.status==='ACTIVE')executed=executeFinance(before,'voidTransaction',[transactionId,'ยกเลิกจากเว็บค่าใช้จ่ายบริษัท']);
  }else{
    const input=inputFor(entries,source.finance,current);
    if(current?.status==='ACTIVE')executed=executeFinance(before,'updateTransaction',[transactionId,input]);
    else {executed=executeFinance(before,'saveTransaction',[input]);transactionId=executed.result.id;}
  }
  // A new, already deleted record has never affected the bank ledger.
  if(!transactionId)return {ok:true,unchanged:true};
  const target=row(executed.snapshot,transactionId),groupId=group?.id||'company-'+source.id;
  const statements=[env.DB.prepare('INSERT INTO company_link_groups(id,transaction_id,transaction_hash,config_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET transaction_id=excluded.transaction_id,transaction_hash=excluded.transaction_hash,config_json=excluded.config_json')
    .bind(groupId,transactionId,await linkHash(target),JSON.stringify(source.finance)),
    env.DB.prepare('INSERT INTO company_link_sources(id,group_id,revision,payload_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json')
      .bind(source.id,groupId,source.revision,JSON.stringify(source))];
  return commitSnapshot(env.DB,before,executed.snapshot,requestId,hash,{ok:true,transactionId,revision:source.revision},statements);
}

// Called only through the internal service binding, after the owner reviews every old source ID.
// Source and target hashes are checked against current data before any date adjustment.
export async function installCompanyBaseline(env,ownerId,plan){
  owner(ownerId);if(await control(env.DB))fail('ตั้งค่าประวัติเดิมแล้ว ไม่อนุญาตให้นำเข้าซ้ำ');
  if(!plan||!Array.isArray(plan.groups)||!plan.groups.length||plan.groups.length>500)fail('แผนจับคู่ไม่ถูกต้อง');
  const before=await loadSnapshot(env.DB);if(plan.expectedRevision!==before.revision)fail('ข้อมูลเว็บการเงินเปลี่ยนแล้ว กรุณาตรวจแผนใหม่');
  let snapshot=before;const statements=[],ids=new Set(),targets=new Set(),pendingGroups=[];
  for(const item of plan.groups){
    if(!Array.isArray(item.entries)||!item.entries.length)fail('ขาดรายการต้นทาง');
    const entries=item.entries.map(cleanSource),target=row(snapshot,item.transactionId);
    if(!target||target.status!=='ACTIVE'||await linkHash(target)!==item.transactionHash||targets.has(item.transactionId))fail('รายการปลายทางเปลี่ยนแปลงหรือถูกจับคู่ซ้ำ');
    targets.add(item.transactionId);
    if(entries.some(e=>e.deleted||ids.has(e.id)||e.finance.accountId!==target.account_id)||new Set(entries.map(e=>e.id)).size!==entries.length)fail('รายการต้นทางซ้ำหรือบัญชีไม่ตรง');
    const refundCategory=snapshot.tables['หมวดหมู่'].rows.find(c=>c.category_id===target.category_id)?.category_name==='เงินคืนบริษัท';
    if(!(target.expense_owner==='COMPANY'||target.company_kind==='ADVANCE'||refundCategory))fail('จับคู่ได้เฉพาะรายการบริษัท');
    for(const e of entries)ids.add(e.id);
    if(entries.reduce((n,e)=>n+e.amount_cents,0)!==moneyCents(target.amount)
      ||entries.some(e=>e.direction!==target.transaction_type.toLowerCase())||new Set(entries.map(e=>e.date)).size!==1)fail('ยอดหรือทิศทางเงินในแผนจับคู่ไม่ตรง');
    const config=entries[0].finance;if(entries.some(e=>JSON.stringify(e.finance)!==JSON.stringify(config)))fail('แหล่งเงินของรายการที่รวมยอดไม่ตรง');
    const kind=target.company_kind==='MIXED_RECEIPT'?'REIMBURSEMENT':target.company_kind|| (target.transaction_type==='EXPENSE'?'EXPENSE':'REIMBURSEMENT');
    if(config.kind!==kind||config.categoryId!==target.category_id||config.projectName!==(target.project_name||'')||config.funding!==(target.company_funding||''))fail('ประเภทเงินในแผนต่างจากประวัติเดิม');
    if(kind==='REIMBURSEMENT'){
      const matched=snapshot.tables['จับคู่เงินคืนบริษัท'].rows.filter(m=>m.reimbursement_transaction_id===target.transaction_id&&m.status==='ACTIVE').map(m=>({claim_id:m.claim_id,cents:moneyCents(m.amount)}));
      const sorted=items=>JSON.stringify([...items].sort((a,b)=>a.claim_id.localeCompare(b.claim_id)));
      if(sorted(matched)!==sorted(config.allocations))fail('รายการจับคู่รับคืนต่างจากประวัติเดิม');
    }
    if(target.transaction_date!==entries[0].date){
      // Keep every original ID; the existing engine audits the explicit company-date correction.
      const input={transaction_date:entries[0].date,reason:'เจ้าของยืนยันให้ใช้วันที่เว็บบริษัทเป็นหลัก'};
      if(kind==='REIMBURSEMENT'){
        const rebuilt=inputFor(entries,config,target);Object.assign(input,{allocations:rebuilt.allocations,company_surplus_to_pool:true,
          company_surplus_confirmed:rebuilt.company_surplus_confirmed,company_expected_refund:rebuilt.company_expected_refund,company_expected_pool:rebuilt.company_expected_pool});
      }
      snapshot=executeFinance(snapshot,'updateTransaction',[target.transaction_id,input]).snapshot;
    }
    const groupId='company-'+entries[0].id;
    pendingGroups.push({groupId,transactionId:target.transaction_id,config});
    for(const e of entries)statements.push(env.DB.prepare('INSERT INTO company_link_sources(id,group_id,revision,payload_json) VALUES(?,?,?,?)').bind(e.id,groupId,e.revision,JSON.stringify(e)));
  }
  for(const g of pendingGroups)statements.unshift(env.DB.prepare('INSERT INTO company_link_groups(id,transaction_id,transaction_hash,config_json) VALUES(?,?,?,?)').bind(g.groupId,g.transactionId,await linkHash(row(snapshot,g.transactionId)),JSON.stringify(g.config)));
  statements.push(env.DB.prepare('UPDATE company_link_control SET enabled=1 WHERE singleton=1'));
  return commitSnapshot(env.DB,before,snapshot,'company-baseline-'+crypto.randomUUID(),await linkHash(plan),{ok:true,sources:ids.size,groups:targets.size},statements);
}

export async function protectCompanyWrites(db,method,args){
  if(['updateTransaction','voidTransaction','confirmDraft','reclassifyCompanyAdvance'].includes(method)){
    if(await db.prepare('SELECT 1 FROM company_link_groups WHERE transaction_id=?').bind(String(args?.[0]||'')).first())
      fail('รายการนี้เชื่อมจากเว็บค่าใช้จ่ายบริษัท กรุณาเพิ่ม แก้ไข หรือยกเลิกที่เว็บบริษัทค่ะ','COMPANY_SOURCE_REQUIRED');
  }
}
