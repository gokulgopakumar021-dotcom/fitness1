import React from 'react';
import { LEGAL } from '../../../legal/legalConfig';
import { LegalPage, type LegalSectionDef } from '../LegalPage';
import { LegalLink, LegalTable, P, Pending, ReviewNote, SubHeading, SupportEmail, UL } from '../LegalPrimitives';

/**
 * Privacy Policy draft. Every statement is tied to the Stage 2A audit of `main` @ ceac8b8 (see docs/legal).
 * Rules followed: local-only vs cloud data is separated; no retention periods are invented; no deletion promise goes
 * beyond what the app controls; nothing claims DPDP (or any other law) compliance; Gemini training use is not denied.
 */
export const privacySections: LegalSectionDef[] = [
  {
    id: 'who-we-are',
    title: 'Who this policy is from',
    body: (
      <>
        <P>
          {LEGAL.brandName} (“we”, “us”) is a fitness tracking and AI-assisted training app and website. It is operated personally by an
          individual, not by a registered company. Operator: <Pending field="operatorLegalName" />. Address and jurisdiction:{' '}
          <Pending field="operatorAddress" />.
        </P>
        <P>
          This policy explains what information the app handles, where it is kept, who else receives it, and what you can do about it. It
          applies to the {LEGAL.brandName} website and app. Questions or requests: <SupportEmail />.
        </P>
        <ReviewNote>
          This draft does not claim compliance with the Digital Personal Data Protection Act 2023, its Rules, the IT Act or any other law.
          Whether and how those apply, and what consent or notice wording they require, must be confirmed by Indian counsel before launch.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'short-version',
    title: 'The short version',
    body: (
      <UL>
        <li>
          <strong>Most of your fitness data stays on your device.</strong> Nutrition logs, body metrics, sleep, your fitness profile, custom
          foods, uploaded documents and Body Scan data are kept in your browser or app storage and are not backed up by us.
        </li>
        <li>
          <strong>Some data is synchronised to your account in the cloud</strong>: your workout plans, workout sessions, any workout in
          progress and which plan is active, so they can follow you across devices.
        </li>
        <li>
          <strong>AI features send text to Google’s Gemini API</strong> (through our server) to produce a reply. Plan documents you upload for
          import are also sent.
        </li>
        <li>
          <strong>Body Scan photos stay on your device</strong> in the audited version of the app. They are optional and off by default.
        </li>
        <li>
          <strong>Payments are handled by Razorpay.</strong> We keep subscription and payment status records.
        </li>
        <li>
          <strong>Deleting your account does not erase everything everywhere.</strong> See “Deleting your account” for exactly what is
          removed and what is kept.
        </li>
      </UL>
    )
  },
  {
    id: 'what-we-collect',
    title: 'Information the app handles',
    body: (
      <>
        <SubHeading>Account and sign-in</SubHeading>
        <P>
          Your email address, a password (held by our authentication provider in hashed form, never in readable form by us), your display
          name, and technical session data that keeps you signed in. We send verification and password-reset emails.
        </P>
        <SubHeading>Fitness profile</SubHeading>
        <P>
          Details you enter such as name, age, sex, height, weight, training preferences, calorie and macro targets and goal weight. These
          are kept on your device.
        </P>
        <SubHeading>Workout plans and workout history</SubHeading>
        <P>
          Plans you create or import, completed sessions, sets and reps, and any session in progress. These are kept on your device and
          synchronised to your account.
        </P>
        <SubHeading>Nutrition and food information</SubHeading>
        <P>
          Meals, foods, calories, macros, water intake and custom foods you create. Kept on your device. When you use food search by text, AI
          food parsing or barcode lookup, the text or barcode you submit is sent to the relevant service (see “Who else receives data”).
        </P>
        <SubHeading>Body metrics and fitness goals</SubHeading>
        <P>Bodyweight, measurements and goals you record. Kept on your device.</P>
        <SubHeading>Sleep and recovery information</SubHeading>
        <P>
          Sleep entries and recovery-related information derived from your training. Kept on your device. Summaries of this information can be
          sent to the AI service when you ask for recovery insights or trainer advice.
        </P>
        <SubHeading>AI prompts and generated responses</SubHeading>
        <P>
          What you type to the AI Personal Trainer and other AI features, plus context the feature needs (for example your name, goal,
          experience level, weight, the exercise you are in the middle of, and recovery or connected-device readings). Our database does not
          store the content of AI requests; it stores only per-day usage counters per account. AI Trainer conversations (including the quick-question
          widget) are held in memory while the screen is open and are not saved by the app.
        </P>
        <SubHeading>Body Scan and optional photographs</SubHeading>
        <P>
          If you use Body Scan you must be 18 or older and give consent inside the feature. Photos, pose measurements and the consent record
          are kept on your device only. Saving photos is optional and off by default.
        </P>
        <SubHeading>Workout Mirror</SubHeading>
        <P>
          Workout Mirror uses your camera and an on-device pose model that is bundled with the app. Video frames are analysed on your device.
          In the audited version they are not uploaded to us or to the AI service.
        </P>
        <SubHeading>Subscription and payment information</SubHeading>
        <P>
          Which plan you chose, trial and renewal status, payment status, amounts, dates and Razorpay reference identifiers. Card or UPI
          details are entered in Razorpay’s checkout, which Razorpay operates.
        </P>
        <SubHeading>Technical and security data</SubHeading>
        <P>
          Our servers keep structured, redacted logs of requests and errors, and use your IP address and account identifier for rate limiting.
        </P>
      </>
    )
  },
  {
    id: 'local-vs-cloud',
    title: 'What stays on your device and what is synchronised',
    body: (
      <>
        <LegalTable
          caption="Where each type of data is kept"
          head={['Data', 'Where it is kept', 'Backed up by us?']}
          rows={[
            ['Email, hashed password, sign-in identity', 'Cloud (Supabase)', 'Held by our provider'],
            ['Display name', 'Cloud (Supabase) and this device', 'Held by our provider'],
            ['Workout plans, sessions, workout in progress, active plan', 'This device and cloud (Supabase)', 'Yes, as part of your account'],
            ['AI daily usage counters', 'Cloud (Supabase)', 'Counters only, no content'],
            ['Subscription and payment records', 'Cloud (Supabase) and Razorpay', 'Yes'],
            ['Fitness profile (age, sex, height, weight, goals, targets)', 'This device only', 'No'],
            ['Nutrition logs, custom foods, water', 'This device only', 'No'],
            ['Body metrics and measurements', 'This device only', 'No'],
            ['Sleep entries', 'This device only', 'No'],
            ['Uploaded plan documents (the file itself)', 'This device only; sent to the AI service when you import', 'No'],
            ['Body Scan photos, measurements and consent', 'This device only (browser IndexedDB)', 'No']
          ]}
        />
        <P>
          Because device-only data is not backed up, clearing your browser data, uninstalling, or switching device can permanently remove it
          unless you exported it first (Settings, then Privacy &amp; data, offers JSON and CSV export). Data on one device is not visible on
          another device unless it is in the synchronised group above.
        </P>
      </>
    )
  },
  {
    id: 'how-we-use',
    title: 'How we use information',
    body: (
      <UL>
        <li>To create and secure your account and keep you signed in.</li>
        <li>To provide the features you use, including workout sync and AI responses.</li>
        <li>To set up, bill and cancel subscriptions, and to investigate payment problems.</li>
        <li>To prevent abuse, enforce rate limits and AI usage limits, and prevent repeat free trials.</li>
        <li>To keep the service working, find and fix errors, and respond to your messages.</li>
      </UL>
    )
  },
  {
    id: 'ai',
    title: 'AI features and Google Gemini',
    body: (
      <>
        <P>
          AI features (AI Personal Trainer, form cues, warm-up and routine generation, progressive-overload tuning, recovery insights, food
          parsing, physique analysis and plan import) send the text or file you submit, plus the context described above, from our server to
          Google’s Gemini API, which generates the response.
        </P>
        <UL>
          <li>
            Google processes that data under its own terms for the Gemini API product and tier we use. <Pending field="geminiTier" />. We
            therefore do not state whether Google retains it or uses it to improve its models.
          </li>
          <li>Please do not include information in AI prompts or uploaded documents that you would not want processed by a third party.</li>
          <li>
            Workout Mirror and Body Scan do not send camera frames or photos to Gemini in the audited version. The preset physique images
            shown by the physique feature are not generated by AI.
          </li>
        </UL>
        <ReviewNote>
          Confirm which Gemini API tier (free or paid) and which Google terms apply, then replace the sentence above with an accurate
          description of retention and training use. Do not publish a “not used for training” claim unless the applicable terms establish it.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'third-parties',
    title: 'Who else receives data',
    body: (
      <>
        <LegalTable
          caption="Service providers and what they receive"
          head={['Provider', 'Role', 'What it receives']}
          rows={[
            ['Supabase', 'Account sign-in and database', 'Email, hashed password, display name, synchronised workout data, subscription and payment records, AI usage counters'],
            ['Vercel', 'Hosting of the website and server functions', 'Requests to our site and API, including IP address and the content of API requests while they are processed; server logs'],
            ['Google (Gemini API)', 'Generates AI responses', 'Text, context and uploaded plan documents you submit to an AI feature'],
            ['Razorpay', 'Payment processing and subscriptions', 'Payment details and contact details you enter in checkout, plus subscription and payment data we exchange with it'],
            ['Upstash (Redis)', 'Rate limiting', 'Short-lived counters keyed by IP address and/or account identifier'],
            ['Open Food Facts', 'Barcode food database', 'Barcode numbers you scan, sent from our server'],
            ['Google Fonts', 'Delivers the fonts used by the site', 'Your IP address and browser details whenever a page loads, including signed-out visitors'],
            ['GitHub Actions', 'Runs scheduled back-end jobs such as billing reconciliation', 'Billing and subscription identifiers needed for the job. It does not receive your workout, nutrition or Body Scan data']
          ]}
        />
        <P>
          Each provider handles data under its own terms and privacy policy. We do not sell your personal information. We do not use
          advertising or analytics trackers in the application code audited for this draft.
        </P>
        <ReviewNote>
          Supabase project region, Vercel log retention and the exact Upstash configuration have not been verified. Cross-border processing
          (for example Gemini and Vercel functions running in Tokyo) needs legal review. “We do not sell” wording needs counsel’s confirmation.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'storage-technologies',
    title: 'Cookies, local storage and similar technologies',
    body: (
      <>
        <P>
          The app stores data in your browser using local storage and IndexedDB. This holds your signed-in session, your device-only fitness
          data, preferences such as theme and units, and Body Scan data. These are necessary for the app to work. Razorpay’s checkout may set
          its own cookies or storage while you pay. Google Fonts is requested from Google’s servers.
        </P>
        <P>
          You can clear this data in your browser settings or in the app (Settings, then Privacy &amp; data), but doing so removes device-only
          data that has not been exported.
        </P>
      </>
    )
  },
  {
    id: 'retention',
    title: 'How long data is kept',
    body: (
      <>
        <P>We have not set fixed retention periods for every category. Where a period is not stated below, it is not yet decided.</P>
        <LegalTable
          caption="Retention by data type"
          head={['Data', 'Kept until']}
          rows={[
            ['Account, display name, synchronised workout data, usage counters', 'You delete your account (or, for workout data, reset your data). Supabase backups age out on the provider’s own schedule, which we have not verified.'],
            ['Device-only data', 'You erase it, clear browser data or uninstall. We cannot see or delete it remotely.'],
            [
              'Subscription and payment records',
              <>
                Kept after account deletion, no longer linked to your account. Period: <Pending field="billingRetention" />.
              </>
            ],
            [
              'One-way hash of your email used to stop repeat free trials',
              <>
                Kept after account deletion. Period: <Pending field="trialHashRetention" />. It cannot be turned back into your email address,
                but it can be matched against the same email if it is used again.
              </>
            ],
            ['Server logs', 'Governed by Vercel’s log retention for our plan, which we have not verified.'],
            ['Records held by Razorpay and Google', 'Governed by their own policies, not by us.']
          ]}
        />
      </>
    )
  },
  {
    id: 'deleting-account',
    title: 'Deleting your account',
    body: (
      <>
        <P>You can delete your account in Settings, then Account. You must re-enter your password and type a confirmation word. Then:</P>
        <UL>
          <li>If you have a subscription, it is cancelled first. Deletion is refused until the payment provider confirms the subscription has stopped, so deletion can be blocked or delayed if Razorpay is unavailable. Nothing is removed in that case.</li>
          <li>Your sign-in account, display name, synchronised workout data and AI usage counters are removed from our database.</li>
          <li>Data for that account is erased from the device you are using. The app does this on a best-effort basis.</li>
        </UL>
        <P>What is not removed:</P>
        <UL>
          <li>Subscription and payment records are kept, no longer linked to your account.</li>
          <li>A one-way hash of your email is kept to stop repeat free trials.</li>
          <li>Other devices keep their local copy of your data until you sign in there and erase it, or clear that browser.</li>
          <li>Razorpay, Google and our other providers keep their own copies under their own policies; deleting your account here does not delete them.</li>
          <li>Backups and logs held by our providers age out on their schedules, which we have not verified.</li>
        </UL>
        <P>Deletion is not instant in every system and cannot be undone.</P>
      </>
    )
  },
  {
    id: 'your-controls',
    title: 'Your choices, export and rights',
    body: (
      <>
        <UL>
          <li>Export your data as JSON or CSV, delete selected data, or reset everything on this device: Settings, then Privacy &amp; data.</li>
          <li>Delete saved Body Scan records and photos: Body Scan privacy controls.</li>
          <li>Change your name or password: Settings.</li>
          <li>Ask us about, or ask us to correct or delete, information we hold about you: email <SupportEmail />.</li>
        </UL>
        <P>
          You may have additional rights under applicable law. We will review requests and reply, but we do not promise a fixed response time
          here. Complaints and grievances: <SupportEmail />. Grievance contact: <Pending field="grievanceContact" />.
        </P>
        <ReviewNote>
          Counsel must confirm which rights, notices, grievance-officer details and response timelines apply, and whether the current
          deletion design (hash and payment-record retention) is acceptable.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'children',
    title: 'Age and children',
    body: (
      <>
        <P>
          Iron Log AI is only for people aged 18 or older, and so is Body Scan. When you sign up, or once for an account created before this
          rule, you confirm that you are 18 or older. We store only that confirmation: that you confirmed it, when, and which version of the
          Terms was current. We do not collect your date of birth or your age for this, and we do not verify it. If you are under 18, do not
          use the Service. You can delete your account and its data at any time. Deleting your account also deletes this confirmation.
        </P>
        <ReviewNote>
          Owner decision: 18+ for the whole Service. This is a self-declaration, not verified age. Counsel to confirm the wording, whether
          self-declaration is enough under the DPDP Act, 2023 (anyone under 18 is a child), and whether the confirmation record should be
          kept after account deletion. See docs/legal/AGE_ELIGIBILITY_DESIGN.md and docs/legal/AGE_ELIGIBILITY_RESEARCH.md.
        </ReviewNote>
      </>
    )
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <>
        <P>
          We use account authentication, row-level security on our database, authenticated and rate-limited server endpoints and standard
          security headers. No system is completely secure. Device-only data is only as secure as your device, browser profile and screen
          lock. Please use a strong, unique password.
        </P>
      </>
    )
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <P>
        We may update this policy. Updates carry a new version identifier. When the policy changes, signed-in users are shown a one-time
        notice with a link to the updated text. Showing the notice is not itself your agreement to anything. This version: {LEGAL.privacyVersion}.
      </P>
    )
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <P>
        {LEGAL.brandName}, <SupportEmail />. Other policies: <LegalLink href="/terms">Terms of Service</LegalLink>,{' '}
        <LegalLink href="/refund-policy">Refund Policy</LegalLink>, <LegalLink href="/cancellation-policy">Cancellation Policy</LegalLink>,{' '}
        <LegalLink href="/contact">Contact</LegalLink>.
      </P>
    )
  }
];

export const PrivacyPage: React.FC = () => (
  <LegalPage
    route="privacy"
    version={LEGAL.privacyVersion}
    summary="What information the app handles, what stays on your device, who else receives data, and how deletion works."
    sections={privacySections}
  />
);

export default PrivacyPage;
