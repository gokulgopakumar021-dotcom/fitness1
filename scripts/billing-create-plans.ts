// Creates the two Razorpay plans (monthly, annual) in the account the key belongs to and prints their ids.
// Run once per mode:  RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... npx tsx scripts/billing-create-plans.ts
// Refuses live keys. Plans are treated as immutable, so this never edits an existing plan. Amounts come from billing config.
import Razorpay from 'razorpay';
import { loadBillingConfig } from '../src/server/billing/config';

const env = { ...process.env, RAZORPAY_PLAN_ID_MONTHLY: 'plan_placeholder0', RAZORPAY_PLAN_ID_ANNUAL: 'plan_placeholder1' };
const cfg = loadBillingConfig(env);
const keyId = process.env.RAZORPAY_KEY_ID ?? '';
if (!keyId.startsWith('rzp_test_') || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('Set RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET. Live keys are refused.');
  process.exit(1);
}
const rzp = new Razorpay({ key_id: keyId, key_secret: process.env.RAZORPAY_KEY_SECRET }) as unknown as { plans: { create(p: unknown): Promise<{ id: string }> } };
for (const key of ['monthly', 'annual'] as const) {
  const p = cfg.plans[key];
  const plan = await rzp.plans.create({ period: p.period, interval: p.interval, item: { name: `Iron Log AI ${key}`, amount: p.amountPaise, currency: 'INR' }, notes: { plan_key: key } });
  console.log(`RAZORPAY_PLAN_ID_${key.toUpperCase()}=${plan.id}`);
}
