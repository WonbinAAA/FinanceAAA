import { strToU8, zipSync } from 'fflate';
import { reportTitle } from './report-data.js';

const sheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const cellText = value => String(value ?? '')
  .replace(/_(?=x[\dA-Fa-f]{4}_)/g, '_x005F_')
  .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .slice(0, 32767)
  .replace(/[\uD800-\uDBFF]$/u, '')
  .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

const text = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`;
const number = (ref, value, style = 2, formula = '') => value == null ? '' :
  `<c r="${ref}" s="${style}">${formula ? `<f>${formula}</f>` : ''}<v>${value}</v></c>`;
const row = (index, cells, height = 21) => `<row r="${index}" ht="${height}" customHeight="1">${cells}</row>`;

const styles = `<styleSheet xmlns="${sheetNS}">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF202923"/><name val="Leelawadee UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF173E2B"/><name val="Leelawadee UI"/></font>
    <font><b/><sz val="16"/><color rgb="FF173E2B"/><name val="Leelawadee UI"/></font>
  </fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDDEDE2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF5EF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function makeTransactionXlsx(report) {
  const headers = ['วันที่ (ค.ศ.)', 'ประเภท', 'รายการ', 'บัญชี', 'เงินเข้า', 'เงินออก', 'ยอดโอน', 'สถานะ'];
  const data = report.rows.map((entry, i) => {
    const n = i + 6;
    const day = Date.parse(`${entry.date}T00:00:00Z`) / 86400000 + 25569;
    const lines = entry.name.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 36)), 0);
    return row(n, number(`A${n}`, day, 3) + text(`B${n}`, entry.type) + text(`C${n}`, entry.name) + text(`D${n}`, entry.account) +
      number(`E${n}`, entry.income == null ? null : entry.income / 100) + number(`F${n}`, entry.expense == null ? null : entry.expense / 100) +
      number(`G${n}`, entry.transfer == null ? null : entry.transfer / 100) + text(`H${n}`, entry.status), Math.min(409, Math.max(22, lines * 16 + 5)));
  }).join('');
  const last = 5 + report.rows.length, total = last + 1, net = last + 2;
  const totals = ['income', 'expense', 'transfer'].map((key, i) => {
    const column = 'EFG'[i];
    return number(`${column}${total}`, report.totals[key] / 100, 5, report.rows.length ? `ROUND(SUM(${column}6:${column}${last}),2)` : '0');
  }).join('');
  const sheet = `<worksheet xmlns="${sheetNS}">
    <dimension ref="A1:H${net}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>
    <sheetFormatPr defaultRowHeight="21"/><cols>${[14, 15, 44, 25, 15, 15, 15, 30].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
    <sheetData>${row(1, text('A1', reportTitle, 6), 28)}
      ${row(2, text('A2', `ช่วงวันที่ ${report.period}`))}
      ${row(3, text('A3', report.selection), 32)}
      ${row(4, text('A4', `ออกรายงาน ${report.issued}  |  หน่วย บาท`))}
      ${row(5, headers.map((label, i) => text(`${'ABCDEFGH'[i]}5`, label, 1)).join(''), 24)}
      ${data}${row(total, text(`A${total}`, `รวม ${report.rows.length} รายการ`, 4) + totals)}
      ${row(net, text(`A${net}`, 'เงินเข้าสุทธิ (เงินเข้า - เงินออก)', 4) + number(`E${net}`, report.totals.net / 100, 5, `ROUND(E${total}-F${total},2)`))}
    </sheetData><autoFilter ref="A5:H${last}"/>
    <mergeCells count="6"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/><mergeCell ref="A3:H3"/><mergeCell ref="A4:H4"/><mergeCell ref="A${total}:D${total}"/><mergeCell ref="A${net}:D${net}"/></mergeCells>
  </worksheet>`;
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${sheetNS}" xmlns:r="${officeRel}"><bookViews><workbookView/></bookViews><sheets><sheet name="ประวัติรายการ" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${officeRel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${officeRel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, body]) => [path, strToU8(xmlHeader + body)])));
}
