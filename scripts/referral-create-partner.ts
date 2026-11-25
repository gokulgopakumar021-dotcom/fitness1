// Creates and manages creator (referral partner) codes through the existing admin SQL functions.
//   npx tsx scripts/referral-create-partner.ts create --name "Rahul Fitness" [--code RAHUL20 | --random] [--rate 20] [--user <app user uuid>] [--dry-run]
//   npx tsx scripts/referral-create-partner.ts list
//   npx tsx scripts/referral-create-partner.ts status --code RAHUL20 --to suspended|active|terminated
//   npx tsx scripts/referral-create-partner.ts rate --code RAHUL20 --rate 15
// Needs in .env (or the shell): SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, REFERRAL_ADMIN_USER_ID.
// REFERRAL_ADMIN_USER_ID must already be a row in public.app_admins; the database re-checks it on every call and audits it.
// Without --code the code is made from the creator's name: "Rahul Fitness" -> RAHULFITNESS (letters and digits only, max 20).
// If that code is taken, a number is added (RAHULFITNESS2, RAHULFITNESS3, ...). Add --random for a hard-to-guess random code instead.
// --rate is the creator's commission in percent (default 20). The customer's discount is the Razorpay offer, not this.
// Terminated is permanent. Codes can never be edited or deleted. Output has no keys or secrets.
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SITE = process.env.REFERRAL_LINK_BASE ?? 'https://www.ironlog-ai.com';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CODE_RE = /^[A-Z0-9]{4,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parse(argv: string[]) {
  const [command = '', ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags.set(key, 'true');
    else { flags.set(key, next); i++; }
  }
  return { command, flags };
}

function randomCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function codeFromName(name: string, suffix = ''): string {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return base.slice(0, 20 - suffix.length) + suffix;
}

function ratePercentToBps(raw: string | undefined): number {
  if (raw === undefined) return 2000;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) fail('--rate must be a percentage between 0 and 100.');
  return Math.round(pct * 100);
}

const { command, flags } = parse(process.argv.slice(2));
if (!['create', 'list', 'status', 'rate'].includes(command)) {
  fail('Usage: create --name "..." [--code X | --random] [--rate 20] [--user uuid] [--dry-run] | list | status --code X --to active|suspended|terminated | rate --code X --rate 15');
}

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const adminId = (process.env.REFERRAL_ADMIN_USER_ID ?? '').trim();
const dryRun = flags.get('dry-run') === 'true';

if (!url || !serviceKey) fail('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
if (!UUID_RE.test(adminId)) fail('Set REFERRAL_ADMIN_USER_ID to your auth user uuid (it must be in public.app_admins).');

if (!/^eyJ|^sb_secret_/.test(serviceKey)) fail('SUPABASE_SERVICE_ROLE_KEY does not look like a Supabase secret key (expected to start with eyJ or sb_secret_). Vercel hides sensitive values on pull; copy it from Supabase, Project Settings, API Keys.');
const projectHost = new URL(url).host; // shown so you can see which project this run targets
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findPartner(code: string): Promise<{ id: string; code: string; status: string }> {
  const { data, error } = await db.from('referral_partners').select('id, code, status').eq('code', code).maybeSingle();
  if (error) fail('Lookup failed.');
  if (!data) fail(`No partner with code ${code}.`);
  return data as { id: string; code: string; status: string };
}

if (command === 'create') {
  const name = (flags.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 80) fail('--name is required (1 to 80 characters).');
  const userId = flags.get('user');
  if (userId !== undefined && !UUID_RE.test(userId)) fail('--user must be a uuid.');
  const bps = ratePercentToBps(flags.get('rate'));
  const given = flags.get('code')?.trim().toUpperCase();
  if (given !== undefined && !CODE_RE.test(given)) fail('--code must be 4 to 20 characters, uppercase letters and digits only.');

  const random = flags.get('random') === 'true';
  if (given !== undefined && random) fail('Use either --code or --random, not both.');
  if (given === undefined && !random && codeFromName(name).length < 4) {
    fail('That name has fewer than 4 letters or digits, so no code can be made from it. Pass --code, or use --random.');
  }

  if (dryRun) {
    console.log(`DRY RUN against ${projectHost}: would create "${name}" code ${given ?? (flags.get('random') === 'true' ? '(random)' : codeFromName(name) || '(none: name too short)')} at ${bps / 100}% commission. Nothing was written.`);
    process.exit(0);
  }

  // Order of tries: your --code (once); a name-based code, then CODE2, CODE3, ...; or random codes with --random.
  const maxTries = given ? 1 : random ? 5 : 30;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const code = given ?? (random ? randomCode() : codeFromName(name, attempt === 0 ? '' : String(attempt + 1)));
    const { data, error } = await db.rpc('referral_admin_create_partner', {
      p_actor: adminId,
      p_user_id: userId ?? null,
      p_code: code,
      p_display_name: name,
      p_email_hash: null,
      p_commission_rate_bps: bps,
    });
    if (!error) {
      console.log(`Created on ${projectHost}`);
      console.log(`  partner id : ${String(data)}`);
      console.log(`  code       : ${code}`);
      console.log(`  name       : ${name}`);
      console.log(`  commission : ${bps / 100}%`);
      console.log(`  link       : ${SITE}/?ref=${code}`);
      process.exit(0);
    }
    if (error.code === '23505') {
      if (error.message.includes('user_id')) fail('That app user is already a creator.');
      if (given) fail(`Code ${code} is already taken.`);
      continue;
    }
    if (error.code === '42501') fail('REFERRAL_ADMIN_USER_ID is not an admin. Insert it into public.app_admins first.');
    fail(`Create failed (${error.code ?? 'no code'}): ${error.message}${error.message.toLowerCase().includes('api key') || String((error as { status?: number }).status) === '401' ? ' -- the SUPABASE_SERVICE_ROLE_KEY in .env was rejected by this project.' : ''}`);
  }
  fail('Could not find a free code after several tries. Pass --code, or run again.');
}

if (command === 'list') {
  const { data, error } = await db.from('referral_partners').select('code, display_name, status, commission_rate_bps, created_at').order('created_at');
  if (error) fail('List failed.');
  console.log(`Partners on ${projectHost}: ${data?.length ?? 0}`);
  for (const p of data ?? []) {
    console.log(`${p.code.padEnd(20)} ${p.status.padEnd(10)} ${String(p.commission_rate_bps / 100).padStart(5)}%  ${p.display_name}`);
  }
  process.exit(0);
}

if (command === 'status') {
  const code = (flags.get('code') ?? '').trim().toUpperCase();
  const to = flags.get('to') ?? '';
  if (!CODE_RE.test(code)) fail('--code is required.');
  if (!['active', 'suspended', 'terminated'].includes(to)) fail('--to must be active, suspended or terminated.');
  if (to === 'terminated' && flags.get('confirm') !== 'true') fail('Terminated is permanent and cannot be reactivated. Add --confirm to proceed.');
  const partner = await findPartner(code);
  if (dryRun) { console.log(`DRY RUN: would set ${code} from ${partner.status} to ${to}.`); process.exit(0); }
  const { error } = await db.rpc('referral_admin_set_partner_status', { p_actor: adminId, p_partner_id: partner.id, p_status: to });
  if (error) fail(`Status change failed (${error.code ?? 'error'}).`);
  console.log(`${code}: ${partner.status} -> ${to}`);
  process.exit(0);
}

if (command === 'rate') {
  const code = (flags.get('code') ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) fail('--code is required.');
  if (!flags.has('rate')) fail('--rate is required (percent).');
  const bps = ratePercentToBps(flags.get('rate'));
  const partner = await findPartner(code);
  if (dryRun) { console.log(`DRY RUN: would set ${code} commission to ${bps / 100}% (future earnings only).`); process.exit(0); }
  const { error } = await db.rpc('referral_admin_set_partner_rate', { p_actor: adminId, p_partner_id: partner.id, p_rate_bps: bps });
  if (error) fail(`Rate change failed (${error.code ?? 'error'}).`);
  console.log(`${code}: commission now ${bps / 100}% (future earnings only)`);
}
