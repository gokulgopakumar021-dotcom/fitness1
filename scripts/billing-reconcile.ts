// One reconciliation pass: re-fetches stale subscriptions from Razorpay (lost webhooks) and checks the INR 5 authorization refunds.
// Run manually or from a scheduler:  npx tsx scripts/billing-reconcile.ts   (needs the billing env vars; Test Mode keys only)
import 'dotenv/config';
import { loadBillingConfig } from '../src/server/billing/config';
import { createRazorpayGateway } from '../src/server/billing/gateway';
import { createBillingService } from '../src/server/billing/service';
import { createSupabaseBillingStore } from '../src/server/billing/store';

const config = loadBillingConfig();
if (!config.configured) {
  console.error('Billing is not configured:\n- ' + config.problems.join('\n- '));
  process.exit(1);
}
const svc = createBillingService({ config, store: createSupabaseBillingStore(config), gateway: createRazorpayGateway(config) });
console.log(JSON.stringify(await svc.reconcileBatch(100)));
