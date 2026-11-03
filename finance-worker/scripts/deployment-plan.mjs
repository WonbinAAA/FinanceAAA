// Read-only resource checks used before a manual deployment. No credentials in output.
export async function validateDeployTarget(config, env, fetcher = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  if (!token || !/^[a-f0-9]{32}$/.test(account || '')) throw new Error('Set the Cloudflare API token and account ID for this deployment.');
  if (config.name !== 'finance-aaa-preview' || config.vars?.APP_ID !== 'finance-aaa-preview') throw new Error('Only the Finance preview Worker may be deployed by this script.');
  if (config.vars?.APP_ENV !== 'preview' || config.vars?.LOCAL_DEV_LOGIN === 'true') throw new Error('Public deployment requires the preview environment with local login disabled.');
  if (config.vars.AUTH_MODE !== 'public') throw new Error('This release requires the owner-approved public access mode.');
  const origin = new URL(config.vars.APP_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.origin !== config.vars.APP_ORIGIN || !origin.hostname.startsWith(config.name + '.') || !origin.hostname.endsWith('.workers.dev'))
    throw new Error('The origin must belong to the Finance preview Worker.');
  const binding = config.d1_databases?.find(item => item.binding === 'DB');
  if (binding?.database_name !== 'finance-aaa-preview' || !/^[0-9a-f-]{36}$/i.test(binding.database_id || '') || /^0{8}-/.test(binding.database_id))
    throw new Error('The Finance preview D1 database must be configured explicitly.');
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function read(endpoint, allowMissing = false) {
    const response = await fetcher(prefix + endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (allowMissing && response.status === 404) return null;
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error('Cloudflare resource verification failed. Check account and API token permissions.');
    return result.result;
  }
  const [database, worker] = await Promise.all([
    read(`/d1/database/${binding.database_id}`),
    read(`/workers/scripts/${config.name}/settings`, true),
  ]);
  if (database.uuid !== binding.database_id || database.name !== binding.database_name) throw new Error('The D1 ID does not identify the intended Finance preview database.');
  if (worker) {
    const marker = worker.bindings?.find(item => item.name === 'APP_ID');
    const db = worker.bindings?.find(item => item.name === 'DB' && item.type === 'd1');
    if (marker?.text !== config.vars.APP_ID || db?.id !== binding.database_id)
      throw new Error('A different Worker or database uses this name. Existing resources were preserved.');
  }
  return { worker: config.name, database: binding.database_name, origin: origin.origin, newWorker: worker === null };
}
