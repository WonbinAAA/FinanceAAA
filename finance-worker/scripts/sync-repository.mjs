// Copies an explicit public source allowlist, never private files or databases.
// Existing files must be identical or tracked and unchanged before replacement.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repository = path.resolve(root, '../.publish/FinanceAAA');
if (path.resolve(root) === path.join(repository, 'finance-worker')) throw new Error('Already in the repository; no sync needed');
const target = path.join(repository, 'finance-worker');
const allowed = ['package.json','package-lock.json','.gitignore','.dev.vars.example','wrangler.jsonc','README.md','MIGRATION.md','DEBT-REVIEW.md','GOOGLE-LOGIN-SETUP.md','DEPLOY-ACTIONS.md'];
async function walk(folder) {
  for (const item of await readdir(path.join(root, folder), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('No symlinks in publish sources');
    const relative = path.join(folder, item.name);
    if (item.isDirectory()) await walk(relative); else allowed.push(relative);
  }
}
for (const folder of ['src','public','migrations','scripts','test']) await walk(folder);
// Inspect every destination before writing any file.
const pending = [];
for (const relative of allowed) {
  const data = await readFile(path.join(root, relative));
  const destination = path.join(target, relative);
  let old;
  try { old = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old?.equals(data)) continue;
  if (old) {
    const status = execFileSync('git', ['status','--porcelain','--', 'finance-worker/' + relative.replaceAll('\\','/')], { cwd: repository, encoding: 'utf8' });
    if (status.trim()) throw new Error('Destination contains existing changes: ' + relative);
  }
  pending.push({ destination, data });
}
for (const item of pending) { await mkdir(path.dirname(item.destination), { recursive: true }); await writeFile(item.destination, item.data); }
console.log(`Synced ${pending.length} public source files to the existing repository; legacy website untouched.`);
