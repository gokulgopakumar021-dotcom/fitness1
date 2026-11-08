// One reconciliation pass: re-fetches stale subscriptions from Razorpay (lost webhooks, halted subscriptions fixed from Razorpay's
// emailed link) and checks the INR 5 authorization refunds. Run manually or from a scheduler (see docs/billing/STAGE5_NOTES.md):
//   npx tsx scripts/billing-reconcile.ts   (needs the billing env vars; Test Mode keys only)
// Exit codes, so a scheduler can alert without parsing output:  0 = clean,  1 = not configured / crashed,
//   2 = an alert needs a human (an INR 5 authorization not refunded, or one whose payment was never recorded),
//   3 = some subscriptions could not be checked this run (a Razorpay or database error); the next run retries.
// The output is counts only: no ids, no emails, no secrets.
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
try {
  const svc = createBillingService({ config, store: createSupabaseBillingStore(config), gateway: createRazorpayGateway(config) });
  const result = await svc.reconcileBatch(100);
  console.log(JSON.stringify(result));
  if (result.alerts > 0) process.exit(2);
  if (result.failed > 0) process.exit(3);
} catch {
  console.error('Reconciliation failed.'); // static text: a thrown error could carry request details
  process.exit(1);
}
