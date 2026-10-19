// n8n Cloud entry point. Disabled until the owner configures both feature flags.
const SLIP_JOBS_SHEET_ = 'รับสลิป LINE';
function slipProperty_(key) { return PropertiesService.getScriptProperties().getProperty(key)||''; }
function slipJobs_() { return ss_().getSheetByName(SLIP_JOBS_SHEET_)?rows_(SLIP_JOBS_SHEET_):[]; }
function slipData_(job) { return JSON.parse(job.data_json||'{}'); }
function slipStore_(job,data) {
  if(!ss_().getSheetByName(SLIP_JOBS_SHEET_)) {
    const s=ss_().insertSheet(SLIP_JOBS_SHEET_);
    const headers=['job_id','line_user_id','message_id','image_hash','status','transaction_id','data_json','created_at','updated_at'];
    s.getRange(1,1,1,headers.length).setValues([headers]);s.getRange(2,1,1,headers.length).setValues([headers]);s.setFrozenRows(2);
  }
  job.data_json=JSON.stringify(data);job.updated_at=now_();
  if(job._row) writeObj_(SLIP_JOBS_SHEET_,job._row,job);
  else {appendObj_(SLIP_JOBS_SHEET_,job);job._row=sh_(SLIP_JOBS_SHEET_).getLastRow();}
}
function slipHash_(bytes) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)); }
function slipNotice_(job,message) { return {user_id:job.line_user_id,message}; }
function slipButton_(job,key,value,label) {
  return {type:'action',action:{type:'postback',label:String(label).slice(0,20),data:'SLIP:'+JSON.stringify({id:job.job_id,key,value})}};
}
function slipOptions_(data,key) {
  const tx=data.tx||{};
  if(key==='kind') return [['PERSONAL','รายจ่ายส่วนตัว'],['COMPANY','รายจ่ายบริษัท'],['INCOME','รายรับ'],['TRANSFER','โอนระหว่างบัญชี'],['ADVANCE','รับเงินบริษัทล่วงหน้า']];
  if(key==='account_id'||key==='to_account_id') return rows_(SH.ACCOUNTS).filter(a=>active_(a.is_active)&&
    (key!=='to_account_id'||a.account_id!==tx.account_id)).map(a=>[a.account_id,a.account_name]);
  if(key==='category_id') return rows_(SH.CAT).filter(c=>active_(c.is_active)&&c.category_name!=='ชำระหนี้'&&
    categoryFits_(c,tx.transaction_type,tx.expense_owner)).map(c=>[c.category_id,c.category_name]);
  if(key==='company_funding') return [['POOL','กองกลางบริษัท'],['PROJECT','เงินโปรเจกต์'],...(tx.company_kind==='ADVANCE'?[]:[['PERSONAL','ออกส่วนตัวก่อน']])];
  if(key==='project_name') return companyProjectCatalog_().filter(p=>p.status!=='CLOSED').map(p=>[p.project_name,p.project_name]);
  if(key==='receipt_confirmed') return [[true,'เป็นรายการที่จ่ายแล้ว']];
  if(key==='duplicate_confirmed') return [[true,'คนละรายการ บันทึกเพิ่ม'],['CANCEL','ใช่ ไม่บันทึกซ้ำ']];
  if(key==='company_expected_personal') return [[data.expected_personal,'ใช้ส่วนตัวส่วนที่ขาด']];
  if(key==='company_expected_pool') return [[data.expected_pool,'ส่วนที่เหลือเข้ากองกลาง']];
  if(key==='allocations') return [[[],'เข้ากองกลางทั้งหมด']];
  return [];
}
function slipQuestion_(job,data,key,text,page) {
  if(key==='allocations') {
    if(!data.claim_choices) data.claim_choices=companyClaims_().filter(c=>c.remaining_amount>0).map(c=>({claim_id:c.claim_id,description:c.description,remaining_amount:c.remaining_amount}));
    text='บริษัทคืนรายการไหนบ้างคะ?\n'+data.claim_choices.slice(0,25).map((c,i)=>(i+1)+'. '+String(c.description||'รายการบริษัท').slice(0,55)+' · '+Number(c.remaining_amount).toFixed(2)+' บาท').join('\n')+
      '\nตอบด้วยเลขรายการและยอด เช่น จับคู่=1:100.00,2:50.00 รายการที่ไม่เลือกจะยังค้างคืน หรือเลือกเก็บทั้งหมดเข้ากองกลางค่ะ';
  }
  data.question=key;slipStore_(job,data);
  const options=slipOptions_(data,key),start=Math.max(0,Number(page)||0);
  const items=options.slice(start,start+9).map(([value,label])=>slipButton_(job,key,value,label));
  if(start+9<options.length) items.push(slipButton_(job,'page',start+9,'ตัวเลือกถัดไป'));
  if(start) items.push(slipButton_(job,'page',0,'กลับหน้าแรก'));
  if(key!=='kind') items.push(slipButton_(job,'revise',['project_name','company_expected_personal'].includes(key)?'company_funding':key==='company_expected_pool'?'allocations':'kind','เปลี่ยนตัวเลือก'));
  items.push(slipButton_(job,'cancel','CANCEL','ยกเลิกสลิปนี้'));
  const message={type:'text',text:(job.job_id+'\n'+text+'\n'+(data.tx?.amount?'ยอด '+Number(data.tx.amount).toFixed(2)+' บาท · ':'')+
    (data.tx?.transaction_date||'')+'\nเลือกด้านล่าง หรือตอบ: สลิป '+job.job_id+' | '+({amount:'ยอด=100.00',transaction_date:'วันที่=2026-10-19',allocations:'จับคู่=1:100.00',description:'รายละเอียด=ข้อความ'}[key]||'ชื่อช่อง=ค่า')).slice(0,4900)};
  if(items.length) message.quickReply={items};
  return slipNotice_(job,message);
}
function slipAdvance_(job,data) {
  const committed=rows_(SH.TX).find(t=>t.slip_job_id===job.job_id);
  if(committed) return slipComplete_(job,data,committed);
  const tx=data.tx||(data.tx={});
  const ask=(key,text)=>slipQuestion_(job,data,key,text);
  if(!data.receipt_confirmed) return ask('receipt_confirmed','ภาพนี้ยังไม่ชัดว่าเป็นรายการที่จ่ายสำเร็จแล้ว กรุณาตรวจหลักฐานก่อนค่ะ');
  if(!tx.amount) return ask('amount','อ่านยอดไม่ชัด กรุณาระบุยอดเงินจริงค่ะ');
  if(!tx.transaction_date) return ask('transaction_date','อ่านวันที่ไม่ชัด กรุณาระบุวันที่ ค.ศ. YYYY-MM-DD ค่ะ');
  if(!data.kind) return ask('kind','สลิปนี้เป็นรายการแบบไหนคะ?');
  if(tx.account_id&&!slipOptions_(data,'account_id').some(([v])=>v===tx.account_id)) tx.account_id='';
  if(!tx.account_id) return ask('account_id',tx.transaction_type==='INCOME'?'เงินเข้าบัญชีไหนคะ?':'เงินออกจากบัญชีไหนคะ?');
  if(tx.to_account_id&&!slipOptions_(data,'to_account_id').some(([v])=>v===tx.to_account_id)) tx.to_account_id='';
  if(tx.transaction_type==='TRANSFER'&&!tx.to_account_id) return ask('to_account_id','เงินเข้าบัญชีปลายทางไหนคะ?');
  if(tx.category_id&&!slipOptions_(data,'category_id').some(([v])=>v===tx.category_id)) tx.category_id='';
  if(tx.transaction_type!=='TRANSFER'&&tx.company_kind!=='ADVANCE'&&!tx.category_id) return ask('category_id','เลือกหมวดของรายการนี้ค่ะ');
  if((tx.expense_owner==='COMPANY'||tx.company_kind==='ADVANCE')&&!tx.company_funding) return ask('company_funding','รายการนี้ใช้เงินจากกองไหนคะ?');
  if(tx.project_name&&!slipOptions_(data,'project_name').some(([v])=>v===tx.project_name)) tx.project_name='';
  if(tx.company_funding==='PROJECT'&&!tx.project_name) return ask('project_name','เลือกโปรเจกต์ที่ต้องการใช้ค่ะ หากไม่มี ให้เพิ่มโปรเจกต์ในเว็บก่อน');
  const normalized=validateTx_(Object.assign({},tx,{status:'ACTIVE',source_type:'LINE'}));
  const exact=rows_(SH.TX).find(t=>t.slip_image_hash===job.image_hash&&t.slip_job_id!==job.job_id);
  if(exact) {job.status='CANCELLED';slipStore_(job,data);return slipNotice_(job,{type:'text',text:'รูปนี้มีรายการ '+exact.transaction_id+' แล้วค่ะ ไม่บันทึกซ้ำ'});}
  const bankDuplicate=data.reference&&rows_(SH.TX).find(t=>t.slip_reference===data.reference&&t.transaction_date===tx.transaction_date&&cents_(t.amount)===cents_(tx.amount));
  if(bankDuplicate) {job.status='CANCELLED';slipStore_(job,data);return slipNotice_(job,{type:'text',text:'เลขอ้างอิงและยอดนี้มีรายการ '+bankDuplicate.transaction_id+' แล้วค่ะ ไม่บันทึกซ้ำ'});}
  const similar=rows_(SH.TX).filter(t=>t.status==='ACTIVE'&&t.account_id===tx.account_id&&t.transaction_date===tx.transaction_date&&cents_(t.amount)===cents_(tx.amount));
  const candidateIds=similar.map(t=>t.transaction_id).sort().join(',');
  if(similar.length&&(!data.duplicate_confirmed||data.duplicate_consent_ids!==candidateIds)) {
    data.duplicate_candidates=candidateIds;
    return ask('duplicate_confirmed','มีรายการวัน/บัญชี/ยอดเดียวกันในระบบแล้ว เป็นคนละรายการที่ต้องบันทึกเพิ่มหรือไม่คะ?');
  }
  const input=Object.assign({},tx,{status:'ACTIVE',source_type:'LINE'});
  if(isCompanyRefund_(normalized)) {
    if(!Array.isArray(data.allocations)) return ask('allocations','เลือกเฉพาะรายการที่บริษัทคืนให้ค่ะ');
    const split=getCompanyReceiptPreview(tx.amount,'',data.allocations);
    if(split.pool_amount>0&&cents_(data.pool_consent)!==cents_(split.pool_amount)) {
      data.expected_pool=split.pool_amount;return ask('company_expected_pool','คืนรายการที่เลือก '+split.refund_amount.toFixed(2)+' บาท ส่วนที่เหลือ '+split.pool_amount.toFixed(2)+' บาท ให้เก็บเข้ากองกลางใช่ไหมคะ?');
    }
    Object.assign(input,{allocations:data.allocations,company_surplus_to_pool:true,company_surplus_confirmed:true,
      company_expected_refund:split.refund_amount,company_expected_pool:split.pool_amount});
  }
  if(isCompanyExpense_(normalized)&&tx.company_funding&&tx.company_funding!=='PERSONAL') {
    const preview=getCompanyFundingPreview(input),short=preview.personal_amount;
    if(short>0&&cents_(data.personal_consent)!==cents_(short)) {
      data.expected_personal=short;return ask('company_expected_personal','เงินบริษัทใช้ได้ '+preview.funded_amount.toFixed(2)+' บาท ขาด '+short.toFixed(2)+' บาท ต้องการออกส่วนตัวเฉพาะส่วนขาดไหมคะ?');
    }
    Object.assign(input,{company_expected_personal:short,company_shortfall_confirmed:true});
  }
  if(slipProperty_('N8N_AUTOSAVE_ENABLED')!=='true') return ask('ready','ข้อมูลครบแล้ว แต่เจ้าของยังไม่ได้เปิดบันทึกอัตโนมัติค่ะ');
  const saved=newTx_(validateTx_(input)),allocations=planCompanyTransaction_(saved,input,'');
  checkCompanyChange_(saved);prepareCompanyTx_(saved);
  ['slip_job_id','slip_image_hash','slip_reference','line_user_id','line_event_id'].forEach(k=>ensureColumn_(SH.TX,k,k));
  Object.assign(saved,{slip_job_id:job.job_id,slip_image_hash:job.image_hash,slip_reference:data.reference||'',line_user_id:job.line_user_id,line_event_id:data.event_id||''});
  data.commit_allocations=allocations;slipStore_(job,data);
  appendObj_(SH.TX,saved);
  return slipComplete_(job,data,saved,allocations);
}
function slipComplete_(job,data,tx,allocations) {
  allocations=allocations||data.commit_allocations||[];
  if(tx.status==='VOID') {job.status='CANCELLED';slipStore_(job,data);return slipNotice_(job,{type:'text',text:'รายการเดิมถูกยกเลิกแล้ว กรุณาตรวจในเว็บก่อนบันทึกใหม่ค่ะ'});}
  if(job.status==='SAVED') return slipNotice_(job,{type:'text',text:'รายการนี้บันทึกแล้วค่ะ\n'+lineSummary_(tx)});
  if(isCompanyExpense_(tx)) createClaim_(tx);
  if(allocations?.length) {
    const applied=matches_().filter(m=>m.reimbursement_transaction_id===tx.transaction_id&&m.status==='ACTIVE');
    const missing=allocations.map(item=>{
      const paid=applied.filter(m=>m.claim_id===item.claim_id).reduce((sum,m)=>sum+cents_(m.amount),0);
      if(paid>cents_(item.amount)) throw new Error('ยอดจับคู่ของรายการนี้เปลี่ยนแล้ว กรุณาตรวจในเว็บ');
      return {claim_id:item.claim_id,amount:(cents_(item.amount)-paid)/100};
    }).filter(item=>item.amount>0);
    if(missing.length) addMatches_(tx.transaction_id,missing);
  }
  updateClaimTotals_();
  if(job.status!=='SAVED') audit_('TRANSACTION',tx.transaction_id,'AUTO_SAVE','','',JSON.stringify(tx),'อ่านสลิปจาก LINE ผ่าน n8n','LINE');
  job.status='SAVED';job.transaction_id=tx.transaction_id;data.question='';slipStore_(job,data);
  return slipNotice_(job,{type:'text',text:'บันทึกแล้วค่ะ\n'+lineSummary_(tx)+(tx.company_funding?'\nแหล่งเงิน: '+({POOL:'กองกลางบริษัท',PROJECT:tx.project_name,PERSONAL:'เงินส่วนตัว'}[tx.company_funding]):'')});
}
function slipAssign_(job,data,key,value,defer) {
  const tx=data.tx||(data.tx={});
  if(key==='page') return slipQuestion_(job,data,data.question,'เลือกข้อมูลของรายการนี้ค่ะ',value);
  if(key==='cancel'||value==='CANCEL') {job.status='CANCELLED';slipStore_(job,data);return slipNotice_(job,{type:'text',text:'ยกเลิกสลิปนี้แล้วค่ะ ยังไม่ได้บันทึกเงิน'});}
  const choices=slipOptions_(data,key);
  if(key!=='allocations'&&choices.length&&!choices.some(([v])=>JSON.stringify(v)===JSON.stringify(value))) throw new Error('ตัวเลือกเปลี่ยนแล้ว กรุณาเลือกใหม่');
  if(key==='kind') {
    data.kind=value;data.tx={amount:tx.amount,transaction_date:tx.transaction_date,description:tx.description};
    Object.assign(data.tx,{transaction_type:['INCOME','ADVANCE'].includes(value)?'INCOME':value==='TRANSFER'?'TRANSFER':'EXPENSE',
      expense_owner:value==='COMPANY'?'COMPANY':value==='PERSONAL'?'PERSONAL':'',company_kind:value==='ADVANCE'?'ADVANCE':''});
  } else if(key==='amount') {tx.amount=lineAmount_(value);data.personal_consent=null;data.pool_consent=null;data.duplicate_confirmed=false;}
  else if(key==='transaction_date') {if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('วันที่ต้องเป็น YYYY-MM-DD');tx.transaction_date=isoDate_(value);data.duplicate_confirmed=false;}
  else if(['account_id','to_account_id','category_id','company_funding','project_name'].includes(key)) {
    tx[key]=value;data.duplicate_confirmed=false;data.personal_consent=null;data.pool_consent=null;
    if(key==='company_funding'&&value!=='PROJECT') tx.project_name='';
  } else if(key==='allocations') {if(!Array.isArray(value)) throw new Error('รูปแบบการจับคู่ไม่ถูกต้อง');data.allocations=value;data.pool_consent=null;}
  else if(key==='receipt_confirmed') data.receipt_confirmed=value===true;
  else if(key==='duplicate_confirmed') {data.duplicate_confirmed=value===true;data.duplicate_consent_ids=data.duplicate_candidates;}
  else if(key==='company_expected_personal') data.personal_consent=Number(value);
  else if(key==='company_expected_pool') data.pool_consent=Number(value);
  else if(key==='description') tx.description=String(value).trim().slice(0,250);
  else throw new Error('ชื่อช่องไม่ถูกต้อง');
  if(defer) return null;
  slipStore_(job,data);return slipAdvance_(job,data);
}
function slipAnswer_(event) { return withLock_(()=>slipAnswerCore_(event)); }
function slipAnswerCore_(event) {
  const user=event.source.userId,text=String(event.message?.text||'').trim();
  let id,key,value;
  if(event.type==='postback'&&String(event.postback?.data||'').startsWith('SLIP:')) {
    const answer=JSON.parse(event.postback.data.slice(5));id=answer.id;key=answer.key;value=answer.value;
  } else {
    const match=text.match(/^สลิป\s+(SLIP-[A-Z0-9]+)(?:\s*\|\s*(.+))?$/u);
    if(!match) return null;
    id=match[1];const entry=String(match[2]||'').match(/^([^=]+)=(.*)$/u);
    if(entry) {
      key=({'ยอด':'amount','วันที่':'transaction_date','รายละเอียด':'description','จับคู่':'allocations','ยกเลิก':'cancel'})[entry[1].trim()];value=entry[2].trim();
    }
  }
  const job=slipJobs_().find(j=>j.job_id===id&&j.line_user_id===user);
  if(!job) throw new Error('ไม่พบสลิปของคุณตามรหัสนี้');
  const data=slipData_(job);
  if(job.status==='SAVED') return slipComplete_(job,data,rows_(SH.TX).find(t=>t.transaction_id===job.transaction_id));
  if(job.status==='CANCELLED') return slipNotice_(job,{type:'text',text:'สลิปนี้ยกเลิกแล้วค่ะ'});
  if(key==='cancel') return slipAssign_(job,data,key,value);
  if(job.status!=='WAITING') return slipNotice_(job,{type:'text',text:'สลิปนี้ยังอ่านไม่เสร็จ กรุณารอสักครู่หรือส่งรูปใหม่เพื่อลองอีกครั้งค่ะ'});
  if(!key) return slipAdvance_(job,data);
  if(key==='revise'&&['kind','company_funding','allocations'].includes(value)) return slipQuestion_(job,data,value,'เลือกข้อมูลใหม่ได้ค่ะ');
  if(key==='allocations'&&typeof value==='string') value=value.split(',').map(part=>{
    const [selector,amount]=part.trim().split(':');
    const claim_id=/^\d+$/.test(selector)?data.claim_choices?.[Number(selector)-1]?.claim_id:selector;
    if(!claim_id) throw new Error('เลขรายการที่เลือกไม่ถูกต้อง');
    return {claim_id,amount:lineAmount_(amount)};
  });
  if(event.type==='postback'&&key!=='page'&&key!==data.question) return slipAdvance_(job,data);
  return slipAssign_(job,data,key,value);
}
function slipImage_(event) {
  const messageId=String(event.message.id||'');
  if(!/^\d{1,64}$/.test(messageId)) throw new Error('รหัสรูปไม่ถูกต้อง');
  const existing=withReadCache_(()=>slipJobs_().find(j=>j.message_id===messageId));
  if(existing&&['SAVED','WAITING','CANCELLED'].includes(existing.status)) return {notice:slipAnswer_({source:event.source,type:'message',message:{text:'สลิป '+existing.job_id}})};
  if(existing&&slipData_(existing).lease_until>Date.now()) return {};
  const response=UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/'+messageId+'/content',{
    headers:{Authorization:'Bearer '+slipProperty_('LINE_CHANNEL_ACCESS_TOKEN')},muteHttpExceptions:true});
  if(response.getResponseCode()!==200) throw new Error('ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ กรุณาส่งรูปใหม่');
  const blob=response.getBlob(),bytes=blob.getBytes(),mime=blob.getContentType().split(';')[0];
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||!bytes.length||bytes.length>5*1024*1024) throw new Error('กรุณาส่ง JPG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB');
  const hash=slipHash_(bytes);
  return withLock_(()=>{
    const all=slipJobs_();
    const repeated=all.find(j=>j.image_hash===hash&&j.line_user_id===event.source.userId&&['SAVED','WAITING'].includes(j.status));
    if(repeated) return {notice:slipAnswerCore_({source:event.source,type:'message',message:{text:'สลิป '+repeated.job_id}})};
    if(all.some(j=>j.image_hash===hash&&j.status==='READING'&&slipData_(j).lease_until>Date.now())) return {};
    const job=all.find(j=>j.message_id===messageId)||{job_id:id_('SLIP'),line_user_id:event.source.userId,message_id:messageId,created_at:now_()};
    if(job.status==='READING'&&slipData_(job).lease_until>Date.now()) return {};
    const data={nonce:Utilities.getUuid(),lease_until:Date.now()+300000,event_id:String(event.webhookEventId||''),tx:{}};
    job.status='READING';job.image_hash=hash;slipStore_(job,data);
    return {job:{job_id:job.job_id,nonce:data.nonce,image_url:'data:'+mime+';base64,'+Utilities.base64Encode(bytes)},
      notice:slipNotice_(job,{type:'text',text:'รับสลิป '+job.job_id+' แล้วค่ะ กำลังอ่านข้อมูล ถ้าข้อมูลไม่ครบจะถามให้เลือกต่อค่ะ'})};
  });
}
function slipExtract_(response) {
  if(response?.status!=='completed'||!Array.isArray(response.output)) throw new Error('AI อ่านรูปไม่สำเร็จ');
  const content=response.output.flatMap(o=>o.content||[]);
  if(content.some(c=>c.type==='refusal')) throw new Error('AI ไม่สามารถอ่านรูปนี้ได้');
  const parts=content.filter(c=>c.type==='output_text');
  if(parts.length!==1||parts[0].text.length>12000) throw new Error('รูปแบบผลอ่านไม่ถูกต้อง');
  const result=JSON.parse(parts[0].text);
  if(typeof result.is_receipt!=='boolean'||typeof result.multiple_transactions!=='boolean'||result.currency!=='THB') throw new Error('ไม่ใช่สลิปเงินบาทที่อ่านได้');
  if(!result.is_receipt||result.multiple_transactions) throw new Error('กรุณาส่งหลักฐานหนึ่งรายการต่อภาพ');
  return result;
}
function slipFinish_(input) { return withLock_(()=>{
  const job=slipJobs_().find(j=>j.job_id===input.job_id);
  if(!job) throw new Error('ไม่พบงานอ่านสลิป');
  const data=slipData_(job);
  if(!lineEqual_(data.nonce,input.nonce)) throw new Error('งานอ่านสลิปหมดอายุ');
  if(job.status==='SAVED') return slipComplete_(job,data,rows_(SH.TX).find(t=>t.transaction_id===job.transaction_id));
  if(job.status!=='READING') return slipNotice_(job,{type:'text',text:'สลิปนี้ดำเนินการไปแล้วค่ะ'});
  let evidence;
  try { evidence=slipExtract_(input.ai_response); }
  catch(error) {job.status='ERROR';data.lease_until=0;slipStore_(job,data);return slipNotice_(job,{type:'text',text:'ยังไม่บันทึกค่ะ '+error.message+' กรุณาตรวจรูปแล้วส่งอีกครั้ง'});}
  data.receipt_confirmed=evidence.payment_status==='COMPLETED';
  let description=String(evidence.payee||'รายการจากสลิป LINE').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,250);
  if(/^[=+@-]/.test(description)) description="'"+description;
  data.tx={description};
  if(Number(evidence.amount_confidence)>=.95&&Number(evidence.amount_confidence)<=1&&evidence.amount!=null) {try{data.tx.amount=positive_(evidence.amount);}catch(_){}}
  if(Number(evidence.fee_amount)>0) data.tx.amount=null;
  if(Number(evidence.date_confidence)>=.95&&Number(evidence.date_confidence)<=1&&/^\d{4}-\d{2}-\d{2}$/.test(String(evidence.transaction_date))) {try{data.tx.transaction_date=isoDate_(evidence.transaction_date);}catch(_){}}
  data.reference=typeof evidence.bank_reference==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/.test(evidence.bank_reference)?evidence.bank_reference:'';
  if(data.reference) {
    const duplicate=rows_(SH.TX).find(t=>t.slip_reference===data.reference&&t.transaction_date===data.tx.transaction_date&&cents_(t.amount)===cents_(data.tx.amount));
    if(duplicate) {job.status='CANCELLED';slipStore_(job,data);return slipNotice_(job,{type:'text',text:'พบเลขอ้างอิงและยอดเดียวกับ '+duplicate.transaction_id+' แล้วค่ะ ไม่บันทึกซ้ำ'});}
  }
  job.status='WAITING';slipStore_(job,data);return slipAdvance_(job,data);
}); }
function slipSend_(notice,replyToken) {
  const message=typeof notice.message==='string'?{type:'text',text:notice.message}:notice.message;
  const response=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/'+(replyToken?'reply':'push'),{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+slipProperty_('LINE_CHANNEL_ACCESS_TOKEN')},
    payload:JSON.stringify(Object.assign({messages:[message]},replyToken?{replyToken}:{to:notice.user_id})),muteHttpExceptions:true});
  if(response.getResponseCode()<200||response.getResponseCode()>=300) throw new Error('ส่งข้อความ LINE ไม่สำเร็จ');
}
function slipErrorMessage_(event,error) {
  let id='';
  try { id=event.type==='postback'?JSON.parse(event.postback.data.slice(5)).id:String(event.message?.text||'').match(/SLIP-[A-Z0-9]+/)?.[0]||''; } catch(_) {}
  const committed=id?withReadCache_(()=>rows_(SH.TX).find(t=>t.slip_job_id===id&&t.line_user_id===event.source.userId)):null;
  return committed?'พบรายการ '+committed.transaction_id+' ในระบบแล้วค่ะ กรุณาส่ง “สลิป '+id+'” เพื่อตรวจผลก่อนลงซ้ำ':'ยังไม่บันทึกค่ะ '+String(error.message).slice(0,1000);
}
function n8nSlipDispatch_(input) {
  const key=slipProperty_('N8N_AUTOMATION_KEY');
  if(key.length<32||typeof input.automation_key!=='string'||!lineEqual_(key,input.automation_key)) throw new Error('ไม่ได้รับอนุญาต');
  if(input.n8n_action==='status') return {ok:true,enabled:slipProperty_('N8N_LINE_ENABLED')==='true',auto_save:slipProperty_('N8N_AUTOSAVE_ENABLED')==='true'};
  if(slipProperty_('N8N_LINE_ENABLED')!=='true') throw new Error('ระบบอ่านสลิปยังไม่เปิด');
  if(!slipProperty_('LINE_CHANNEL_SECRET')||!slipProperty_('LINE_CHANNEL_ACCESS_TOKEN')||!slipProperty_('LINE_ALLOWED_USER_IDS')) throw new Error('ยังตั้งค่า LINE ไม่ครบ');
  let notices=[],jobs=[];
  if(input.n8n_action==='prepare') {
    if(typeof input.raw_body!=='string'||input.raw_body.length>200000) throw new Error('รูปแบบ webhook ไม่ถูกต้อง');
    const signature=Utilities.base64Encode(Utilities.computeHmacSha256Signature(input.raw_body,slipProperty_('LINE_CHANNEL_SECRET')));
    if(!lineEqual_(signature,input.line_signature)) throw new Error('ลายเซ็น LINE ไม่ถูกต้อง');
    const body=JSON.parse(input.raw_body);
    if(!Array.isArray(body.events)||body.events.length>25) throw new Error('รูปแบบเหตุการณ์ไม่ถูกต้อง');
    for(const event of body.events) {
      if(event.source?.type!=='user'||!lineAllowed_(event.source.userId)) continue;
      try {
        let notice=null;
        if(event.type==='message'&&event.message?.type==='image') {const next=slipImage_(event);if(next.job) jobs.push(next.job);notice=next.notice;}
        else if(event.type==='postback'||event.type==='message'&&event.message?.type==='text') {
          notice=slipAnswer_(event);
          if(!notice&&event.type==='message') notice={user_id:event.source.userId,message:lineHandleEvent_(event).reply};
        }
        if(notice) notices.push({notice,replyToken:event.replyToken});
      } catch(error) {notices.push({notice:{user_id:event.source.userId,message:{type:'text',text:slipErrorMessage_(event,error)}},replyToken:event.replyToken});}
    }
  } else if(input.n8n_action==='finish') notices.push({notice:slipFinish_(input)});
  else throw new Error('คำสั่งอัตโนมัติไม่ถูกต้อง');
  let failed=0;
  notices.forEach(n=>{try{slipSend_(n.notice,n.replyToken);}catch(_){failed++;}});
  return {ok:true,jobs,notifications_failed:failed};
}
