import React from 'react';
import { LEGAL } from '../../../legal/legalConfig';
import { LegalPage, type LegalSectionDef } from '../LegalPage';
import { LegalLink, OL, P, ReviewNote, SupportEmail, UL } from '../LegalPrimitives';

/**
 * Written from the audited UI wording (BillingParts.tsx cancel dialog, AccountSecurity.tsx). It describes how the app is
 * designed to behave and promises no outcome that has not been tested against Razorpay.
 */
export const cancellationSections: LegalSectionDef[] = [
  {
    id: 'how',
    title: 'How to cancel',
    body: (
      <>
        <OL>
          <li>Sign in and open Settings, then Billing. (You can also open Settings, then Account, and choose “Manage billing”.)</li>
          <li>Choose to cancel your subscription and confirm.</li>
          <li>Check the Billing screen afterwards. It shows your current status.</li>
        </OL>
        <P>You do not need to contact us to cancel.</P>
      </>
    )
  },
  {
    id: 'what-happens',
    title: 'What the app says will happen',
    body: (
      <>
        <UL>
          <li>
            <strong>During a trial:</strong> future billing stops, so the first plan charge should not be taken. You keep access until the trial
            ends.
          </li>
          <li>
            <strong>On an active paid plan:</strong> the subscription will not renew. You keep access until the end of the period you already
            paid for.
          </li>
          <li>
            <strong>In other states</strong> (for example a payment that is pending or has failed): billing stops and no further payment
            attempts should be made.
          </li>
        </UL>
        <P>
          These describe how the app is designed to work. Subscription state is kept by Razorpay, so the exact moment a cancellation takes
          effect depends on Razorpay confirming it. If the Billing screen does not show your cancellation, treat it as not yet confirmed and
          contact us.
        </P>
        <ReviewNote>
          Cancellation during a trial, at the end of a paid cycle, and in pending or failed states has NOT been verified end to end against
          Razorpay Test Mode. Do not publish firmer language until that testing is done and recorded.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'trial-date',
    title: 'Cancel before the first charge',
    body: (
      <P>
        If you start a trial, the app shows the date your first plan charge is scheduled for before you confirm. To avoid that charge, cancel before that date.
        We recommend cancelling a day early to allow for time zones and for Razorpay to confirm.
      </P>
    )
  },
  {
    id: 'deletion',
    title: 'Deleting your account',
    body: (
      <P>
        Deleting your account cancels your subscription first. The account is not deleted until Razorpay confirms the subscription has
        stopped, so deletion can be delayed if Razorpay is unavailable. If you have a paid subscription, the app asks you to confirm that it
        will be cancelled immediately, with no refund of the current period. See the{' '}
        <LegalLink href="/refund-policy">Refund Policy</LegalLink> for charges made in error.
      </P>
    )
  },
  {
    id: 'cancel-fails',
    title: 'If cancelling does not work',
    body: (
      <>
        <P>Email <SupportEmail /> with the subject “Cancellation help” and include:</P>
        <UL>
          <li>the email address of your account;</li>
          <li>your plan and the date you tried to cancel;</li>
          <li>a screenshot of the Billing screen and of any error message;</li>
          <li>the Razorpay subscription or payment ID, if you have it.</li>
        </UL>
        <P>We will check your subscription with Razorpay and tell you the result. We cannot promise a specific time.</P>
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

export const CancellationPolicyPage: React.FC = () => (
  <LegalPage
    route="cancellation-policy"
    summary="How to cancel a trial or subscription, what the app says will happen, and what to do if it fails."
    sections={cancellationSections}
  />
);

export default CancellationPolicyPage;
