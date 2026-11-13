import React from 'react';
import { LEGAL } from '../../../legal/legalConfig';
import { LegalPage, type LegalSectionDef } from '../LegalPage';
import { LegalLink, P, Pending, ReviewNote, SubHeading, SupportEmail, UL } from '../LegalPrimitives';

/**
 * Terms of Service draft. Nothing here describes the service as a medical device or clinically validated, and no
 * warranty or legal protection is invented. Enforceability-sensitive clauses carry review notes for counsel.
 */
export const termsSections: LegalSectionDef[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    body: (
      <>
        <P>
          These Terms of Service govern your use of the {LEGAL.brandName} website and app (the “Service”). The Service is operated personally
          by an individual, not by a registered company: <Pending field="operatorLegalName" />, <Pending field="operatorAddress" />.
        </P>
        <P>
          By creating an account you agree to these Terms and acknowledge that you have read the{' '}
          <LegalLink href="/privacy">Privacy Policy</LegalLink>. If you do not agree, do not use the Service. Our{' '}
          <LegalLink href="/refund-policy">Refund Policy</LegalLink> and <LegalLink href="/cancellation-policy">Cancellation Policy</LegalLink>{' '}
          form part of these Terms.
        </P>
        <ReviewNote>
          Counsel to confirm the contracting party and that an individual sole operator can contract on these terms, including if the operator
          is based outside India.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'service',
    title: 'What the Service is',
    body: (
      <>
        <P>
          {LEGAL.brandName} is a fitness tracking app. It lets you log workouts, plan training, log food and body metrics, view progress, and
          use AI-assisted features such as an AI Personal Trainer, form cues, recovery insights, progressive-overload suggestions, food
          analysis, a Workout Mirror camera feature that gives on-device movement feedback, and Body Scan.
        </P>
        <P>
          The Service is a general fitness and wellness tool. It is not a medical device, is not clinically validated, and does not diagnose,
          treat, cure or prevent any condition.
        </P>
      </>
    )
  },
  {
    id: 'eligibility',
    title: 'Who can use the Service',
    body: (
      <>
        <P>
          You must be at least 18 years of age to create an account or use the Service. When you sign up, or when we ask you to confirm on an
          account created earlier, you confirm that you are 18 or older. We record only that you confirmed it. We do not ask for your date of
          birth and we do not independently verify your age. If you are under 18, do not create or use an account. Body Scan is covered by the
          same rule. You must give accurate sign-up information and be able to form a binding agreement where you live.
        </P>
        <ReviewNote>
          Owner decision: the whole Service is 18+ (not 14+). Wording is a draft for counsel. Counsel to confirm: whether a self-declaration is
          sufficient, what the Terms should say if someone reveals they are under 18, and the contracting-capacity wording. See
          docs/legal/AGE_ELIGIBILITY_DESIGN.md and docs/legal/AGE_ELIGIBILITY_RESEARCH.md.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'your-account',
    title: 'Your account and responsibilities',
    body: (
      <UL>
        <li>Keep your password confidential and tell us if you think your account has been misused.</li>
        <li>You are responsible for activity under your account.</li>
        <li>Keep a backup of data you care about. Much of your data is stored only on your device (see the Privacy Policy), and we cannot recover it.</li>
        <li>Use the Service only in line with these Terms and the law.</li>
      </UL>
    )
  },
  {
    id: 'plans',
    title: 'Free features, paid features and subscriptions',
    body: (
      <>
        <P>
          Core tracking features can be used without a paid plan. Some AI-powered features may require a trial or an active subscription. The
          in-app plan screen (Settings, then Billing) shows what is included at any time and is the authoritative statement of what each plan
          covers.
        </P>
        <SubHeading>Prices and billing</SubHeading>
        <UL>
          <li>Monthly plan: ₹299 per month. Annual plan: ₹1,499 per year.</li>
          <li>The amount shown in the app before you authorise payment is the amount that applies to you. At the time of this draft, checkout charges those amounts with no separate tax amount added. We do not state any tax registration or tax collection in this draft.</li>
          <li>Subscriptions are processed by Razorpay and renew automatically every month or year at the plan price until you cancel.</li>
        </UL>
        <SubHeading>Trial</SubHeading>
        <UL>
          <li>New accounts may be offered a trial. It starts only after Razorpay confirms your payment authorisation, not before. A trial is not “no charge”.</li>
          <li>When you authorise, Razorpay may make a small verification debit (shown as ₹5 for cards). It is not part of the plan price. Whether and how it is returned is covered in the Refund Policy.</li>
          <li>The first plan charge is taken on the day the trial ends, and the plan then renews until you cancel. The app shows the date before you confirm.</li>
          <li>One trial is allowed per account and per email address.</li>
        </UL>
        <P>
          See the <LegalLink href="/cancellation-policy">Cancellation Policy</LegalLink> and <LegalLink href="/refund-policy">Refund Policy</LegalLink>.
          We may change prices or features for future billing periods and will show the change in the app before it applies to you.
        </P>
        <ReviewNote>
          Confirm with a CA how GST and invoicing apply to a digital subscription, and with counsel how “free” and trial-to-paid advertising and
          recurring-payment rules apply. Prices are configurable on the server, so confirm the live values still equal ₹299 and ₹1,499 before publishing.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'ai-content',
    title: 'AI-generated content',
    body: (
      <UL>
        <li>AI features can be wrong, incomplete or out of date. You are responsible for checking anything before you act on it.</li>
        <li>Workout, nutrition, recovery, physique and form suggestions are general information. They do not replace advice from a doctor, physiotherapist, dietitian, qualified coach or other professional.</li>
        <li>AI output is not guaranteed to be unique, and similar output may be given to others.</li>
        <li>Your prompts and some context are sent to Google’s Gemini API to generate responses (see the Privacy Policy).</li>
        <li>Workout Mirror gives feedback from an on-device pose model, not from a person or a video review by AI. Its feedback is approximate.</li>
      </UL>
    )
  },
  {
    id: 'fitness-limits',
    title: 'Fitness and wellness limitations',
    body: (
      <>
        <P>
          Exercise and changes to diet carry risk. Talk to a qualified professional before starting or changing a programme, especially if you
          are pregnant, injured, have a medical condition, take medication or have a history of disordered eating. Stop immediately and seek
          appropriate help if you feel pain, dizziness, faintness, shortness of breath or any other concerning symptom. You use the Service
          and follow its suggestions at your own risk.
        </P>
        <P>Do not use the Service in an emergency. Contact local emergency services instead.</P>
      </>
    )
  },
  {
    id: 'your-content',
    title: 'Your content and uploaded documents',
    body: (
      <>
        <UL>
          <li>You keep ownership of the content you enter or upload, such as workout data, notes and plan documents.</li>
          <li>You give us permission to process that content only as needed to run the Service, including sending it to the providers listed in the Privacy Policy when you use a feature that needs them.</li>
          <li>Only upload documents you have the right to use. Do not upload anyone else’s private information.</li>
        </UL>
        <ReviewNote>Counsel to review the licence wording and any intermediary or user-content obligations for uploaded documents.</ReviewNote>
      </>
    )
  },
  {
    id: 'ip',
    title: 'Intellectual property',
    body: (
      <P>
        The Service, its software, design, text, graphics and brand are owned by the operator or its licensors and are protected by
        applicable law. You get a personal, limited, non-exclusive, non-transferable right to use the Service under these Terms. You may not
        copy, resell, reverse engineer or build a competing service from it, except where the law allows. Third-party exercise videos or
        content shown in the Service remain the property of their owners.
      </P>
    )
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <P>You agree not to:</P>
        <UL>
          <li>break the law, or infringe or misuse anyone’s rights or personal information;</li>
          <li>attempt to access accounts, data or systems that are not yours, or probe, attack or overload the Service;</li>
          <li>bypass usage limits, rate limits, paywalls or the one-trial rule, including by creating accounts for that purpose;</li>
          <li>use automated tools to scrape or mass-extract data from the Service;</li>
          <li>submit unlawful, harmful or malicious content to AI features, or try to make them produce it; or</li>
          <li>use the Service to give professional medical, nutrition or coaching advice to others as if it were validated clinical advice.</li>
        </UL>
      </>
    )
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <P>
        The Service depends on third parties such as hosting, authentication, AI and payment providers, and on your own connection and
        device. It may be unavailable, slow or changed from time to time. Some actions, including account deletion, depend on a provider being
        reachable. We may add, change or remove features, with notice where reasonable.
      </P>
    )
  },
  {
    id: 'liability',
    title: 'Liability',
    body: (
      <>
        <P>
          Nothing in these Terms excludes or limits any right or liability that cannot be excluded or limited under applicable law, including
          statutory consumer rights.
        </P>
        <P>
          Subject to that, and to the extent the law allows, the Service is provided “as is” and “as available”, and we are not liable for
          indirect or consequential loss, for loss of data held only on your device, for injury or loss resulting from acting on fitness,
          nutrition or AI suggestions, or for failures of third-party services. To the extent the law allows, our total liability relating to
          the Service is limited to the amount you paid us in the three months before the event giving rise to the claim.
        </P>
        <ReviewNote>
          Enforceability of this limitation, the three-month cap, and any fitness-injury disclaimer under Indian law (including consumer law)
          must be confirmed by counsel. The figure is a placeholder proposal, not a verified standard.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    body: (
      <>
        <UL>
          <li>You can stop using the Service at any time. To delete your account, use Settings, then Account. Cancel any subscription first or let deletion cancel it (see the Cancellation Policy).</li>
          <li>We may suspend or end access if you break these Terms, create risk or legal exposure, abuse limits or payments, or if the law requires. Where practical we will tell you why.</li>
          <li>Sections that by their nature should survive termination, such as liability limits and dispute terms, do so.</li>
        </UL>
      </>
    )
  },
  {
    id: 'disputes',
    title: 'Governing law and disputes',
    body: (
      <>
        <P>
          Please contact <SupportEmail /> first so we can try to resolve the problem informally. Governing law and venue:{' '}
          <Pending field="governingLaw" />.
        </P>
        <ReviewNote>
          Governing law, courts and any arbitration clause must be chosen with counsel. They depend on where the operator is based and on
          consumer-protection rules that may limit what can be agreed. No clause is proposed here.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <P>
        We may update these Terms. Updates carry a new version identifier, and signed-in users see a one-time notice with a link to the new
        text. Showing the notice is not itself your agreement. A change takes effect as described in the notice and, where the law requires
        your agreement, only after you give it. This version: {LEGAL.termsVersion}.
      </P>
    )
  },
  {
    id: 'contact',
    title: 'Contact and grievances',
    body: (
      <P>
        {LEGAL.brandName}, <SupportEmail />. Grievance contact: <Pending field="grievanceContact" />. See also the{' '}
        <LegalLink href="/contact">Contact page</LegalLink>.
      </P>
    )
  }
];

export const TermsPage: React.FC = () => (
  <LegalPage
    route="terms"
    version={LEGAL.termsVersion}
    summary="The rules for using the app: your account, subscriptions, AI and fitness limitations, and how disputes are handled."
    sections={termsSections}
  />
);

export default TermsPage;
