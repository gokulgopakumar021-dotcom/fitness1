import React from 'react';
import { LEGAL } from '../../../legal/legalConfig';
import { LegalPage, type LegalSectionDef } from '../LegalPage';
import { LegalLink, P, Pending, ReviewNote, SupportEmail, UL } from '../LegalPrimitives';

/**
 * Only the support address is real. Legal name, address, phone, company registration and tax number are NOT invented:
 * they are placeholders until the owner supplies them. (No telephone number is offered.)
 */
export const contactSections: LegalSectionDef[] = [
  {
    id: 'support',
    title: 'Customer support',
    body: (
      <>
        <P>
          <strong>{LEGAL.brandName}</strong>
        </P>
        <P>
          Customer support: <SupportEmail />
        </P>
        <P>Email us for account help, payment or billing questions, cancellation problems, privacy requests and complaints.</P>
      </>
    )
  },
  {
    id: 'what-to-include',
    title: 'What to include',
    body: (
      <UL>
        <li>The email address of your account (never your password).</li>
        <li><strong>Payment issues:</strong> the date, amount, plan and the Razorpay payment ID or a statement screenshot. See the <LegalLink href="/refund-policy">Refund Policy</LegalLink>.</li>
        <li><strong>Cancellation problems:</strong> a screenshot of Settings, then Billing. See the <LegalLink href="/cancellation-policy">Cancellation Policy</LegalLink>.</li>
        <li><strong>Privacy requests:</strong> what you want us to do. See the <LegalLink href="/privacy">Privacy Policy</LegalLink>.</li>
      </UL>
    )
  },
  {
    id: 'operator',
    title: 'Who operates the service',
    body: (
      <>
        <UL>
          <li>Operator (an individual, not a registered company): <Pending field="operatorLegalName" /></li>
          <li>Business address and jurisdiction: <Pending field="operatorAddress" /></li>
          <li>Grievance officer or designated contact, if required: <Pending field="grievanceContact" /></li>
        </UL>
        <ReviewNote>
          Do not publish until the owner has filled these in. No company registration number, tax number or telephone number is shown
          because none has been supplied. They are not invented here.
        </ReviewNote>
      </>
    )
  }
];

export const ContactPage: React.FC = () => (
  <LegalPage route="contact" summary="How to reach us for support, billing, cancellation and privacy questions." sections={contactSections} />
);

export default ContactPage;
