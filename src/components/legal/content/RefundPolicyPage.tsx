import React from 'react';
import { LEGAL } from '../../../legal/legalConfig';
import { LegalPage, type LegalSectionDef } from '../LegalPage';
import { LegalLink, OL, P, ReviewNote, SupportEmail, UL } from '../LegalPrimitives';

/**
 * Limited-refund approach approved by the owner. Deliberately avoids: a blanket "non-refundable" rule, a guaranteed
 * refund, a guaranteed processing time, and any claim that the ₹5 verification debit is automatically refunded.
 */
export const refundSections: LegalSectionDef[] = [
  {
    id: 'overview',
    title: 'Our approach',
    body: (
      <>
        <P>
          We offer refunds where you were charged by mistake. We do not offer general change-of-mind refunds. This does not limit any right you
          have under applicable consumer law that cannot legally be excluded.
        </P>
        <UL>
          <li><strong>Refunds we will consider:</strong> duplicate payments, incorrect charges, and billing errors that we have verified.</li>
          <li><strong>Not offered as a general rule:</strong> refunds simply because you changed your mind or did not use the Service.</li>
        </UL>
        <P>
          Cancelling a subscription stops future renewals. It does not by itself refund a charge that has already been taken. See the{' '}
          <LegalLink href="/cancellation-policy">Cancellation Policy</LegalLink>.
        </P>
      </>
    )
  },
  {
    id: 'eligible',
    title: 'What we will review for a refund',
    body: (
      <UL>
        <li><strong>Duplicate payment:</strong> you were charged more than once for the same plan and period.</li>
        <li><strong>Incorrect charge:</strong> you were charged an amount or on a date that does not match what the app showed you before you authorised payment, or after your subscription was cancelled and had stopped.</li>
        <li><strong>Verified billing error:</strong> after investigating, we or Razorpay confirm that a payment was taken in error.</li>
      </UL>
    )
  },
  {
    id: 'how-to-request',
    title: 'How to ask for a refund',
    body: (
      <>
        <P>Email <SupportEmail /> with the subject “Refund request”. To investigate, please include:</P>
        <UL>
          <li>the email address of your account;</li>
          <li>the date and amount of the charge, and the plan (monthly or annual);</li>
          <li>the Razorpay payment ID or reference, or a screenshot of your bank or UPI statement line;</li>
          <li>what you believe went wrong (for example “charged twice on the same day”);</li>
          <li>any screenshot of the Billing screen (Settings, then Billing).</li>
        </UL>
        <P>Do not send your full card number, CVV, UPI PIN or password. We will never ask for them.</P>
      </>
    )
  },
  {
    id: 'review',
    title: 'How we review requests',
    body: (
      <>
        <OL>
          <li>We confirm the charge in our billing records and, where needed, with Razorpay.</li>
          <li>We may ask you for more information.</li>
          <li>We tell you our decision and the reason.</li>
          <li>If we approve a refund, we ask Razorpay to return it to the original payment method. After that, the time it takes to appear depends on Razorpay and your bank or UPI provider.</li>
        </OL>
        <P>
          We do not guarantee that a request will be approved, and we do not promise a fixed processing time. We will deal with requests as
          promptly as we reasonably can.
        </P>
      </>
    )
  },
  {
    id: 'verification-debit',
    title: 'The ₹5 card verification debit',
    body: (
      <>
        <P>
          When you authorise a subscription by card, Razorpay may make a small verification debit, shown in the app as ₹5. It is not part of
          the plan price. For UPI or e-mandate, the amount shown in Razorpay’s checkout applies.
        </P>
        <P>
          If you see a verification debit that you believe was not returned, or was taken more than once, contact us as described above and
          include the payment reference. We will review it like any other charge query.
        </P>
        <ReviewNote>
          The in-app text no longer promises that this debit is returned on its own (corrected in Stage 2D, Stage 4): it says Razorpay may make the
          debit and points here. Razorpay’s documentation says the ₹5 is returned for a future-start subscription, but that has NOT
          been verified in Razorpay Test Mode for this account, this service issues no refund itself, and no bank timing is documented. Verify
          the real behaviour for cards, UPI and e-mandate before launch. Only then decide whether this section and the in-app wording may
          say more.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'trial-and-deletion',
    title: 'Trials, renewals and account deletion',
    body: (
      <UL>
        <li>If you cancel during a trial before the first plan charge, no plan charge should be taken. Tell us if one is.</li>
        <li>A renewal that has been correctly charged under a plan you did not cancel in time is not an error, and is not refunded as a general rule.</li>
        <li>Deleting your account cancels your subscription. The app tells you that the current paid period is not refunded on deletion. Deleting your account does not remove your right to ask us to review a duplicate, incorrect or erroneous charge.</li>
      </UL>
    )
  },
  {
    id: 'statutory',
    title: 'Your legal rights',
    body: (
      <>
        <P>
          Nothing in this policy takes away rights you have under applicable Indian consumer law or other law that cannot be excluded by
          agreement. If you think a right applies to you, tell us in your request.
        </P>
        <ReviewNote>
          Counsel to confirm what consumer-protection and e-commerce rules require for refund and cancellation disclosure, whether any
          statutory refund right applies to a digital subscription, and the wording of this section. Also confirm Razorpay’s merchant
          expectations for refund policies.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <P>
        {LEGAL.brandName}, <SupportEmail />. See also the <LegalLink href="/terms">Terms of Service</LegalLink>.
      </P>
    )
  }
];

export const RefundPolicyPage: React.FC = () => (
  <LegalPage
    route="refund-policy"
    summary="When we refund a payment, how to ask, and what we need to investigate it."
    sections={refundSections}
  />
);

export default RefundPolicyPage;
