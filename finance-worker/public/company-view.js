let latestViewRequest=0;
async function openCompanySourceDetail(id){
 try{
  const items=await server('getDisplayTransactions',{source_id:id.slice('company:'.length)}),item=items.find(r=>r.transaction_id===id);
  if(!item)throw new Error('รายการนี้ถูกยกเลิกหรือไม่อยู่ในสมุดบริษัทแล้ว กรุณาโหลดรายการใหม่');
  const fields=[['วันที่',dateTH(item.transaction_date)],['รายการ',item.source_title],['จำนวนเงิน',money(item.amount)],['บัญชี',accountDisplayName(item.account_name)||'—'],['โครงการ',item.project_name||'—'],['รายละเอียด',item.description||'—'],['ผลต่อบัญชี',['SELF_ALLOWANCE','MOVE'].includes(item.company_kind)?'ไม่เคลื่อนเงินจริง':item.sync_pending?'รออัปเดตบัญชี':item.transaction_type==='INCOME'?'เงินเข้า':'เงินออก']];
  $('companySourceContent').innerHTML='<dl class="detail-grid">'+fields.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>';
  $('companySourceDialog').showModal();
 }catch(error){fail(error);}
}
