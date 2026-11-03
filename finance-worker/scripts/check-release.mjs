import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
async function visit(folder) {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = path.posix.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Release sources must not contain symlinks');
    if (entry.isDirectory()) await visit(relative);
    else files.push(relative);
  }
}
for (const folder of ['src','public','migrations','scripts','test']) await visit(folder);
for (const name of files) {
  if (/\.(pdf|xlsx?|csv|sqlite|db|png|jpe?g)$/i.test(name)) throw new Error('Private/binary artifact in release sources');
  const content = await readFile(path.join(root, name), 'utf8');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bya29\.[A-Za-z0-9_-]{12,}|\bAIza[A-Za-z0-9_-]{25,}|\bgh[pousr]_[A-Za-z0-9]{20,}/.test(content))
    throw new Error('Potential credential detected; release stopped');
  if (name.startsWith('public/') && /google\.script\.run|<\?!=|SPREADSHEET_ID/.test(content)) throw new Error('Legacy server template in public assets');
}
if (process.argv.includes('--deploy')) {
  const databaseId = process.env.FINANCE_D1_DATABASE_ID;
  const appOrigin = process.env.FINANCE_APP_ORIGIN;
  if (!databaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)
    || /^0{8}-/.test(databaseId)) throw new Error('Set FINANCE_D1_DATABASE_ID for the separate preview database');
  const url = new URL(appOrigin || '');
  if (url.protocol !== 'https:' || url.origin !== appOrigin || !url.hostname.endsWith('.workers.dev'))
    throw new Error('Set FINANCE_APP_ORIGIN to the approved HTTPS workers.dev preview origin');
  const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
  config.vars = { APP_ENV: 'preview', APP_ORIGIN: appOrigin, DEBT_PAYMENTS_ENABLED: 'true' };
  config.d1_databases[0].database_id = databaseId;
  await writeFile(path.join(root, 'wrangler.deploy.json'), JSON.stringify(config, null, 2) + '\n');
}
console.log(`Release check passed: ${files.length} source files; no private imports or secrets included.`);
