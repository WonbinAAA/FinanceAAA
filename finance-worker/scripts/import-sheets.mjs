// Offline validation only. Does not connect to Sheets, D1 or the network.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { emptySnapshot } from '../src/schema.js';
import { prepareImport } from '../src/migration.js';
const input = process.argv[2];
if (!input) { console.error('Usage: npm run import:check -- <private-export.json> [private-report.json]'); process.exit(1); }
const payload = JSON.parse(await readFile(path.resolve(input), 'utf8'));
const { snapshot, ...report } = await prepareImport(emptySnapshot(), payload);
const output = process.argv[3];
if (output) {
  const absolute = path.resolve(output);
  const parent = path.dirname(absolute);
  if (!/(?:^|[\\/])(?:private|reports|imports)(?:[\\/]|$)/i.test(absolute)) throw new Error('Save reports only under an ignored private/reports/imports directory');
  await mkdir(parent, { recursive: true });
  await writeFile(absolute, JSON.stringify(report, null, 2), { flag: 'wx' });
}
// Print no balances, identities, transaction descriptions or account IDs.
console.log(JSON.stringify({ ok: report.ok, added: report.added, skipped: report.skipped,
  conflicts: report.conflicts.length, comparison: report.comparison?.ok ?? 'missing', debt_status: report.reconciliation?.debt_review.status }));
if (!report.ok || !report.comparison?.ok) process.exitCode = 1;
