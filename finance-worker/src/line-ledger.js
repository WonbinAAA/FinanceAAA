import { sha256 } from './auth.js';
import { isCompanyCategory } from './company-policy.js';
import { displayPersonalLedger } from './company-view.js';
import { AppError } from './errors.js';
import { createLegacyEngine } from './legacy-engine.js';
import { companyDirections, companyFunding, companyItemFields, isSelfAllowance } from './line-company.js';
import { moneyCents } from './schema.js';
import { commitSnapshot, loadSnapshot, receipt } from './storage.js';

const companyOrigin = 'https://company-expenses-ledger.sugrid-kumpa.workers.dev';
const active = row => !['FALSE', '0'].includes(String(row.active ?? row.is_active).toUpperCase());
const compare = text => String(text ?? '').normalize('NFKC').trim().toLowerCase();

export const baht = cents => (cents / 100).toLocaleString('th-TH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function decimalBaht(cents) {
  const digits = String(cents).padStart(3, '0');
  return digits.slice(0, -2) + '.' + digits.slice(-2);
}

export function parseAmount(value) {
  const amount = String(value ?? '').trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0xe50));
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.replaceAll(',', '').split('.');
  const cents = Number(whole + fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  try { return moneyCents(decimalBaht(cents)) === cents ? cents : null; }
  catch { return null; }
}

export function parseDate(value) {
  const date = String(value ?? '').trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0xe50));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const year = Number(date.slice(0, 4));
  const iso = year >= 2400 ? String(year - 543) + date.slice(4) : date;
  if (Number(iso.slice(0, 4)) < 1900 || Number(iso.slice(0, 4)) > 2200) return null;
  const parsed = new Date(iso + 'T12:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function choice(rows, value, idKey, nameKey, title) {
  const byId = rows.find(row => compare(row[idKey]) === compare(value));
  if (byId) return byId;
  const matches = rows.filter(row => compare(row[nameKey]) === compare(value));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new AppError(title + 'ชื่อนี้ซ้ำ กรุณาใช้รหัสที่เลือกจาก “ตัวเลือก” ค่ะ');
  throw new AppError('ไม่พบ' + title + 'นี้ กรุณาพิมพ์ “ตัวเลือก” เพื่อดูชื่อที่ใช้งานค่ะ');
}

function personalCategories(snapshot, type) {
  return snapshot.tables['หมวดหมู่'].rows.filter(category => active(category) && !isCompanyCategory(category)
    && (!type || category.transaction_type === type) && category.category_name !== 'ชำระหนี้');
}

function accounts(snapshot) {
  return snapshot.tables['บัญชี'].rows.filter(active);
}

async function companyApi(env, path, body, signal) {
  if (!env.COMPANY_LEDGER?.fetch) throw new AppError('ขณะนี้เชื่อมเว็บบริษัทไม่ได้ กรุณาลองอีกครั้งค่ะ', 503);
  let response, data;
  try {
    const request = new Request(companyOrigin + '/finance/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: companyOrigin, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    response = await env.COMPANY_LEDGER.fetch(request);
    data = await response.json();
  } catch {
    throw new AppError('ขณะนี้ติดต่อเว็บบริษัทไม่ได้ กรุณาลองอีกครั้งค่ะ', 503);
  }
  if (!response.ok) {
    if ([400, 409, 422].includes(response.status) && typeof data?.error === 'string')
      throw new AppError(data.error.slice(0, 240), response.status, 'COMPANY_REJECTED');
    throw new AppError('ขณะนี้เว็บบริษัทไม่พร้อม กรุณาลองอีกครั้งค่ะ', 503);
  }
  return data;
}

function countDailyAmounts(rows) {
  const totals = { income: 0, expense: 0 };
  for (const { direction, cents } of rows) {
    if (!Object.hasOwn(totals, direction) || !Number.isSafeInteger(cents) || cents < 0
      || !Number.isSafeInteger(totals[direction] + cents)) throw new Error('Invalid daily ledger amounts');
    totals[direction] += cents;
  }
  return totals;
}

async function personalDailyTotals(env, date) {
  const [snapshot, links] = await Promise.all([
    loadSnapshot(env.DB),
    env.DB.prepare('SELECT transaction_id FROM company_link_groups').all(),
  ]);
  const rows = snapshot.tables['รายการเงิน'].rows.filter(row => row.status === 'ACTIVE'
    && row.transaction_date === date && ['INCOME', 'EXPENSE'].includes(row.transaction_type));
  return countDailyAmounts(displayPersonalLedger(rows, links.results, snapshot.tables['หมวดหมู่'].rows)
    .map(row => ({ direction: row.transaction_type.toLowerCase(), cents: moneyCents(row.amount) })));
}

async function companyDailyTotals(env, date) {
  const query = new URLSearchParams({ format: 'pdf-data', from: date, to: date });
  const { rows } = await companyApi(env, 'export?' + query, undefined, AbortSignal.timeout(8000));
  return countDailyAmounts(rows.filter(row => row.date === date)
    .map(row => ({ direction: row.direction, cents: row.amount_cents })));
}

export async function readLineDailyTotals(env, date) {
  const [personal, company] = await Promise.allSettled([
    personalDailyTotals(env, date), companyDailyTotals(env, date),
  ]);
  return { personal: personal.value ?? null, company: company.value ?? null };
}

async function requireCompanyLink(env) {
  const options = await companyApi(env, 'finance/options');
  if (options?.enabled !== true) throw new AppError('เว็บบริษัทยังเชื่อมบัญชี Finance ไม่ได้ค่ะ', 503);
  return options;
}

async function companyDirectory(env) {
  const bootstrap = await companyApi(env, 'bootstrap');
  if (!Array.isArray(bootstrap?.refs)) throw new AppError('อ่านตัวเลือกของเว็บบริษัทไม่ได้ค่ะ', 503);
  return { refs: bootstrap.refs.filter(active), entries: Array.isArray(bootstrap.entries) ? bootstrap.entries : [] };
}

export async function companyRefs(env) {
  return (await companyDirectory(env)).refs;
}

function runPersonal(snapshot, body) {
  const engine = createLegacyEngine(snapshot);
  try {
    const id = engine.recordConfirmedLineTransaction(body);
    return { result: { id }, snapshot: engine.snapshot() };
  } catch (error) {
    throw new AppError(error.message);
  }
}

export async function prepareLineDraft(env, data, draftId) {
  const amount = decimalBaht(data.cents);
  const summary = {
    scope: data.scope, direction: data.direction, item: data.item, cents: data.cents, date: data.date, note: data.note,
  };
  if (data.scope === 'ส่วนตัว') {
    const snapshot = await loadSnapshot(env.DB);
    const account = choice(accounts(snapshot), data.account, 'account_id', 'account_name', 'บัญชี');
    const transactionType = data.direction === 'income' ? 'INCOME' : 'EXPENSE';
    const category = choice(personalCategories(snapshot, transactionType), data.item, 'category_id', 'category_name', 'หมวดหมู่');
    const body = {
      transaction_date: data.date, transaction_type: transactionType, amount, account_id: account.account_id,
      category_id: category.category_id, expense_owner: 'PERSONAL', description: data.note,
      ai_status: data.fromImage ? 'REVIEWED' : 'NONE',
    };
    runPersonal(snapshot, body);
    return { body, summary: { ...summary, account: account.account_name, item: category.category_name } };
  }

  const kind = data.direction === 'income' ? 'ADVANCE' : data.fundingKind;
  if (data.direction === 'expense' && !Object.hasOwn(companyFunding, kind)) throw new AppError('กรุณาเลือกประเภทเงินค่ะ');
  const configuration = await requireCompanyLink(env);
  const self = isSelfAllowance(data);
  const account = self ? null : choice(configuration.accounts || [], data.account, 'account_id', 'account_name', 'บัญชีเงินจริง');
  summary.account = account?.account_name || '';
  summary.fundingKind = kind;
  const body = {
    id: 'LINE-' + draftId, date: data.date, direction: data.direction, itemBase: data.item,
    amount, note: data.note, finance: { accountId: account?.account_id || '', kind },
  };
  const refs = data.project || data.vehicle || data.person || data.lodging ? await companyRefs(env) : [];
  const fields = companyItemFields(data, refs);
  for (const [key, label] of [['project', 'งาน / โครงการ'], ['vehicle', 'ทะเบียนรถ'], ['person', 'ผู้รับเบี้ยเลี้ยง']]) {
    if (!data[key]) continue;
    if (key !== 'project' && !fields[key]) throw new AppError('รายการนี้ไม่มีช่อง' + label + 'ในเว็บบริษัทค่ะ');
    const selected = choice(refs.filter(ref => ref.kind === key), data[key], 'id', 'name', label);
    body[key + 'Id'] = selected.id;
    summary[key] = selected.name;
  }
  if (data.lodging && !fields.lodging) throw new AppError('รายการนี้ไม่มีช่องชื่อที่พักในเว็บบริษัทค่ะ');
  if (fields.lodging) summary.lodging = data.lodging || '';
  if (data.lodging) body.lodgingName = data.lodging;
  const preview = await companyApi(env, 'finance/preview', body);
  const personalCents = preview?.entries?.find(entry => entry.id === body.id)?.personal_cents;
  if (!Number.isSafeInteger(personalCents) || personalCents < 0 || personalCents > data.cents)
    throw new AppError('เว็บบริษัทยังตรวจยอดรายการให้ไม่ได้ค่ะ', 503);
  if (data.direction === 'expense' && !self) {
    body.expectedPersonalCents = personalCents;
    summary.personalCents = personalCents;
  }
  return { body, summary };
}

export async function saveLineDraft(env, id, version, draft) {
  const requestId = 'LINE-' + id + '-V' + version;
  if (draft.summary.scope === 'บริษัท') {
    const status = await companyApi(env, 'mutation-status?mutationId=' + requestId);
    if (status?.found && status.result?.id === draft.body.id) {
      // The original save may have been interrupted after committing to the company ledger.
      const options = await companyApi(env, 'finance/options');
      return { id: status.result.id, pending: options?.pending > 0 };
    }
    const configuration = await requireCompanyLink(env);
    if (draft.body.finance.kind !== 'SELF_ALLOWANCE' && !configuration.accounts?.some(account => account.account_id === draft.body.finance.accountId
      && account.account_name === draft.summary.account))
      throw new AppError('บัญชีเปลี่ยนแล้ว กรุณาตรวจข้อมูลและส่งรายการใหม่ค่ะ', 409);
    if (draft.body.projectId || draft.body.vehicleId || draft.body.personId) {
      const refs = await companyRefs(env);
      for (const key of ['project', 'vehicle', 'person']) {
        const id = draft.body[key + 'Id'];
        if (id && !refs.some(ref => ref.kind === key && ref.id === id && ref.name === draft.summary[key]))
          throw new AppError('งาน / โครงการ ทะเบียนรถ หรือผู้รับเบี้ยเลี้ยงเปลี่ยนแล้วค่ะ กรุณาตรวจร่างอีกครั้ง', 409);
      }
    }
    const saved = await companyApi(env, 'entries', { ...draft.body, mutationId: requestId });
    if (saved?.id !== draft.body.id) throw new AppError('ยังตรวจผลการบันทึกไม่ได้ค่ะ ลองยืนยันร่างเดิมอีกครั้ง', 503);
    // A replayed response from the company app may omit the sync status.
    const options = saved.finance ?? await companyApi(env, 'finance/options');
    return { id: saved.id, pending: options?.pending > 0 };
  }

  const hash = await sha256(JSON.stringify(draft.body));
  const saved = await receipt(env.DB, requestId, hash);
  if (saved) return saved;
  const snapshot = await loadSnapshot(env.DB);
  const account = accounts(snapshot).find(row => row.account_id === draft.body.account_id);
  const category = personalCategories(snapshot, draft.body.transaction_type).find(row => row.category_id === draft.body.category_id);
  if (account?.account_name !== draft.summary.account || category?.category_name !== draft.summary.item)
    throw new AppError('บัญชีหรือหมวดหมู่เปลี่ยนแล้ว กรุณาตรวจข้อมูลและส่งรายการใหม่ค่ะ', 409);
  const executed = runPersonal(snapshot, draft.body);
  return commitSnapshot(env.DB, snapshot, executed.snapshot, requestId, hash, executed.result);
}

export async function listLineChoices(env, section) {
  if (['โครงการ', 'ทะเบียน'].includes(section)) {
    const kind = section === 'โครงการ' ? 'project' : 'vehicle';
    const refs = (await companyRefs(env)).filter(ref => ref.kind === kind);
    return refs.map(ref => ref.name + ' (' + ref.id + ')');
  }
  const snapshot = await loadSnapshot(env.DB);
  if (section === 'บัญชี') return accounts(snapshot).map(account => account.account_name + ' (' + account.account_id + ')');
  return personalCategories(snapshot, section === 'รับ' ? 'INCOME' : 'EXPENSE')
    .map(category => category.category_name + ' (' + category.category_id + ')');
}

export async function lineInputChoices(env) {
  const snapshot = await loadSnapshot(env.DB);
  const activeAccounts = accounts(snapshot);
  const accountOwners = new Set(activeAccounts.map(account => account.user_id));
  return {
    accounts: activeAccounts.map(account => ({ id: account.account_id, name: account.account_name })),
    categories: personalCategories(snapshot).sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map(category => ({
      id: category.category_id, name: category.category_name,
      direction: category.transaction_type === 'INCOME' ? 'income' : 'expense',
    })),
    owners: snapshot.tables['ผู้ใช้งาน'].rows.filter(user => active(user) && accountOwners.has(user.user_id))
      .map(user => user.display_name),
  };
}

export async function lineEditChoices(env, entry, field) {
  if (entry.scope === 'ส่วนตัว') {
    const { accounts, categories } = await lineInputChoices(env);
    return { options: field === 'account' ? accounts : categories.filter(category => category.direction === entry.direction) };
  }
  if (field === 'direction' || field === 'fundingKind') {
    const labels = field === 'direction' ? companyDirections : companyFunding;
    return { options: Object.entries(labels).map(([id, name]) => ({ id, name })) };
  }
  if (field === 'account') {
    const { accounts } = await requireCompanyLink(env);
    if (!Array.isArray(accounts)) throw new AppError('ยังอ่านบัญชีของเว็บบริษัทไม่ได้ค่ะ', 503);
    return { options: accounts.map(account => ({ id: account.account_id, name: account.account_name })) };
  }
  const { refs, entries } = await companyDirectory(env);
  if (field === 'note') {
    const notes = [...new Set(entries.filter(row => !row.deleted_at).map(row => row.note)
      .filter(note => typeof note === 'string' && note.trim() && note.length <= 2000))].slice(0, 12);
    return { refs, options: await Promise.all(notes.map(async note => ({
      id: await sha256(note), name: note.length > 120 ? [...note].slice(0, 117).join('') + '…' : note, value: note,
    }))) };
  }
  const options = refs.filter(ref => ref.kind === field && (field !== 'item' || ref.direction === entry.direction));
  return { options, refs };
}
