// Manual CI/local API-token deployment, matching the company-expenses workflow.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateDeployTarget } from './deployment-plan.mjs';

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) throw new Error('Deployment step failed. Review the preceding command output.');
}
try {
  run('scripts/check-release.mjs', ['--deploy']);
  const config = JSON.parse(readFileSync('wrangler.deploy.json', 'utf8'));
  const plan = await validateDeployTarget(config, process.env);
  console.log(`Verified ${plan.worker} and ${plan.database}; financial imports are excluded.`);
  run('node_modules/wrangler/bin/wrangler.js', ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.deploy.json']);
  run('node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', 'wrangler.deploy.json']);
  console.log('Preview deployment finished. Runtime authentication must be configured before use.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
