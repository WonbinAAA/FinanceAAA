// A request-local compatibility adapter. It never calls Google or writes remotely.
export function createBook(snapshot) {
  const tables = structuredClone(snapshot.tables);
  class Range {
    constructor(sheet, row, col, height = 1, width = 1) { Object.assign(this, { sheet, row, col, height, width }); }
    getValues() { return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width },
      (_, c) => this.sheet.data[this.row + r - 1]?.[this.col + c - 1] ?? '')); }
    setValues(values) { values.forEach((line, r) => line.forEach((value, c) => this.setAt(r, c, value))); return this; }
    setValue(value) { this.setAt(0, 0, value); return this; }
    setAt(r, c, value) { const index = this.row + r - 1; this.sheet.data[index] ||= []; this.sheet.data[index][this.col + c - 1] = value; }
  }
  class Sheet {
    constructor(name, table) {
      this.name = name;
      this.data = [[...table.headers], table.headers.map(() => '')];
      table.rows.forEach(row => { this.data[row._row - 1] = table.headers.map(key => row[key] ?? ''); });
    }
    getName() { return this.name; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return this.data[0].length; }
    getRange(...args) { return new Range(this, ...args); }
    appendRow(values) { this.data.push([...values]); }
    setFrozenRows() {}
  }
  const sheets = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, new Sheet(name, table)]));
  const book = {
    getSheetByName: name => sheets[name] || null,
    getSheets: () => Object.values(sheets),
    insertSheet: name => (sheets[name] = new Sheet(name, { headers: [], rows: [] })),
    getName: () => 'Finance D1',
    getId: () => 'D1',
  };
  return { book, snapshot() {
    return { revision: snapshot.revision, tables: Object.fromEntries(Object.entries(sheets).map(([name, sheet]) => {
      const headers = sheet.data[0];
      const rows = [];
      for (let i = 2; i < sheet.data.length; i++) {
        const data = sheet.data[i];
        if (data?.some(v => v !== '' && v != null)) rows.push({ _row: i + 1,
          ...Object.fromEntries(headers.map((key, col) => [key, data[col] ?? ''])) });
      }
      return [name, { headers: [...headers], rows }];
    })) };
  } };
}

export function formatDate(date, zone, format) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return format === 'yyyy-MM-dd' ? day : `${day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
