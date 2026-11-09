import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { baht, reportTitle } from './report-data.js';

const width = 595.28, height = 841.89, margin = 32;
const columns = [32, 95, 249, 357, 426, 495, width - margin];
const black = rgb(0.12, 0.12, 0.12), muted = rgb(0.31, 0.31, 0.31);
const border = rgb(0.76, 0.76, 0.76), band = rgb(0.94, 0.94, 0.94);
const words = new Intl.Segmenter('th', { granularity: 'word' });
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const lineHeight = 14;

export async function makeTransactionPdf(report, fontBytes) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const glyphs = new Set(font.getCharacterSet());
  const textWidth = (text, size) => font.widthOfTextAtSize(text, size);
  const printable = text => Array.from(String(text).replace(/\r\n?/g, '\n'), char => {
    if (char === '\n') return char;
    if (/\s/u.test(char)) return ' ';
    return glyphs.has(char.codePointAt(0)) ? char : '?';
  }).join('');
  let page, y;

  function wrap(text, available, size) {
    const lines = [];
    for (const paragraph of printable(text).split('\n')) {
      let current = '';
      for (const { segment } of words.segment(paragraph)) {
        if (current && textWidth(current + segment, size) > available) {
          lines.push(current.trimEnd());
          current = '';
        }
        if (textWidth(segment, size) <= available) current += current ? segment : segment.trimStart();
        else for (const { segment: letter } of graphemes.segment(segment)) {
          if (current && textWidth(current + letter, size) > available) {
            lines.push(current);
            current = '';
          }
          current += letter;
        }
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }

  function draw(text, x, at, size = 10, color = black) {
    if (text) page.drawText(text, { x, y: at, size, font, color });
  }
  function rule(at) {
    page.drawLine({ start: { x: margin, y: at }, end: { x: width - margin, y: at }, thickness: 0.5, color: border });
  }
  function right(text, edge, at, maxWidth, size = 10) {
    const fitted = Math.min(size, maxWidth / (textWidth(text, 1) || 1));
    draw(text, edge - textWidth(text, fitted), at, fitted);
  }
  function addPage() {
    page = doc.addPage([width, height]);
    draw(reportTitle, margin, height - 45, 20);
    draw(`ช่วงวันที่ ${report.period}`, margin, height - 65, 11, muted);
    y = height - 82;
    const selection = wrap(report.selection, width - margin * 2, 10);
    for (const line of selection.length > 4 ? [...selection.slice(0, 3), '...'] : selection) {
      draw(line, margin, y, 10, muted);
      y -= 13;
    }
    draw(`ออกรายงาน ${report.issued}  |  หน่วย บาท`, margin, y, 10, muted);
    y -= 12;
    page.drawRectangle({ x: margin, y: y - 25, width: width - margin * 2, height: 25, color: band });
    ['วันที่', 'รายการ', 'บัญชี', 'เงินเข้า', 'เงินออก', 'ยอดโอน'].forEach((heading, i) => {
      if (i >= 3) right(heading, columns[i + 1] - 6, y - 16, columns[i + 1] - columns[i] - 12);
      else draw(heading, columns[i] + 6, y - 16);
    });
    y -= 25;
    rule(y);
  }

  addPage();
  const bottom = 55;
  for (const row of report.rows) {
    const cells = [[row.dateLabel], wrap([row.name, row.status].filter(Boolean).join('\n'), columns[2] - columns[1] - 12, 10),
      wrap(row.account, columns[3] - columns[2] - 12, 10)];
    const count = Math.max(...cells.map(cell => cell.length));
    if (count * lineHeight + 12 > y - bottom && y < height - 175) addPage();
    for (let offset = 0; offset < count;) {
      if (y - bottom < lineHeight + 12) addPage();
      const take = Math.min(count - offset, Math.floor((y - bottom - 12) / lineHeight));
      cells.forEach((cell, i) => cell.slice(offset, offset + take).forEach((line, j) => {
        const size = i === 0 ? Math.min(10, (columns[1] - columns[0] - 12) / textWidth(line, 1)) : 10;
        draw(line, columns[i] + 6, y - 15 - j * lineHeight, size);
      }));
      if (offset === 0) [row.income, row.expense, row.transfer].forEach((value, i) => {
        if (value != null) right(baht(value), columns[i + 4] - 6, y - 15, columns[i + 4] - columns[i + 3] - 12);
      });
      y -= take * lineHeight + 12;
      rule(y);
      offset += take;
    }
  }

  if (y < 135) addPage();
  page.drawRectangle({ x: margin, y: y - 27, width: width - margin * 2, height: 27, color: band });
  draw(`รวม ${report.rows.length} รายการ`, margin + 6, y - 17, 11);
  [report.totals.income, report.totals.expense, report.totals.transfer].forEach((value, i) =>
    right(baht(value), columns[i + 4] - 6, y - 17, columns[i + 4] - columns[i + 3] - 12));
  draw('เงินเข้าสุทธิ', margin + 6, y - 47, 12);
  right(baht(report.totals.net), width - margin - 6, y - 47, 175, 12);
  draw('ยอดสุทธิ = เงินเข้า - เงินออก (แสดงยอดโอนแยก)', margin + 6, y - 65, 9, muted);

  const pages = doc.getPages();
  pages.forEach((sheet, index) => {
    page = sheet;
    rule(42);
    right(`หน้า ${index + 1} / ${pages.length}`, width - margin, 25, 130, 9);
  });
  doc.setTitle(reportTitle);
  return doc.save();
}
