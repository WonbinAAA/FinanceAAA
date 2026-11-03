/** Read-only helper. Install manually in the OLD Apps Script project only when
 * ready to export. This file contains no spreadsheet ID or credentials.
 * Never log the returned payload or commit the downloaded JSON to GitHub.
 */
function exportFinanceForD1() {
  return withReadCache_(() => {
    const tables = {};
    Object.values(SH).forEach(name => {
      if (!ss_().getSheetByName(name)) return;
      tables[name] = { headers: headers_(name).slice(), rows: rows_(name).map(row => Object.assign({}, row)) };
    });
    const d = getDashboard(), c = getCompanySummary(), n = value => Math.round(Number(value || 0) * 100);
    return { format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok', exported_at: now_(), tables,
      expected: { balances_cents: Object.fromEntries(Object.entries(d.balances).map(([id,v]) => [id,n(v)])),
        cash_cents: n(d.real_cash), available_cents: n(d.available_cash), opening_cents: n(d.opening_total),
        inflow_cents: n(d.cash_inflow), outflow_cents: n(d.cash_outflow), company_receivable_cents: n(c.remaining),
        company_advance_cents: n(c.advance_remaining), company_pool_cents: n(c.pool.remaining),
        projects_cents: Object.fromEntries(c.projects.map(p => [p.project_name,n(p.remaining)])) } };
  });
}

function downloadFinanceForD1() {
  const payload = JSON.stringify(exportFinanceForD1()).replace(/</g, '\\u003c');
  const html = '<!doctype html><html lang="th"><meta charset="utf-8"><body><p>ไฟล์นี้มีข้อมูลส่วนตัว เก็บไว้ในเครื่องและห้ามใส่ GitHub</p>' +
    '<button id="download">ดาวน์โหลดสำเนา JSON</button><script>document.getElementById("download").onclick=function(){' +
    'const data=' + payload + ';const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));' +
    'const a=document.createElement("a");a.href=url;a.download="finance-sheets-export.json";a.click();URL.revokeObjectURL(url);};</script></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(180), 'ส่งออกสำหรับ D1');
}
