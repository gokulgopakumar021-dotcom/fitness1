> **SUPERSEDED (Stage 2D).** The owner has decided the entire platform is **18+**, so the 14+ options discussed below (B and C) are no longer in play. This file is kept only as the research record that led to that decision. The current design is `AGE_ELIGIBILITY_DESIGN.md`; the open legal questions are listed in `STAGE_6_OWNER_INFORMATION_AND_RELEASE.md`.

# Iron Log AI: age eligibility research (Stage 2B)

**Status: research notes for the owner and Indian counsel. NOT legal advice, NOT a compliance claim.**
**No final age gate has been implemented.** Body Scan stays 18+ (existing behaviour, unchanged).

Prepared 12 November 2026 from web research of secondary sources (law-firm and trade commentary). The primary texts (the Act, the
Rules, and the Gazette commencement notification) were **not** read directly in this stage. Counsel must verify every point below
against the primary sources.

> **UPDATE (Stage 2D):** the owner has since decided **18+ for the entire platform** (Option A below). Sections 1 and 3 are kept as
> the original research record. The implementation and its limits are in `AGE_ELIGIBILITY_DESIGN.md`.

## 1. The owner's earlier preference (superseded by the 18+ decision)

The owner prefers a minimum account age of 14. Under the DPDP Act, 2023 a "child" is anyone under 18. A 14+ account gate therefore
means accepting 14 to 17-year-olds, who are children for data-protection purposes. The Terms and Privacy drafts show the minimum age
as an "OWNER TO PROVIDE" placeholder, and signup carries no age assertion, until counsel has decided.

## 2. What the research found (to be verified)

| Topic | Finding (secondary sources) | Confidence |
|---|---|---|
| Definition of child | DPDP Act s.2(g) (per one source): an individual who has not completed 18 years. | High across sources |
| Parental consent | s.9(1): before processing a child's personal data, the data fiduciary must obtain **verifiable consent of the parent or lawful guardian**, in the manner prescribed. | High |
| How consent is verified | DPDP Rules 2025, **Rule 10**: verifiable parental consent using reliable age and identity verification (sources mention verified details already held by the fiduciary, or virtual tokens from authorised entities such as DigiLocker). A simple "I am the parent" checkbox is described as not enough. | Medium; read Rule 10 itself |
| Detrimental processing | s.9(2): no processing likely to cause a detrimental effect on a child's well-being. | High |
| Tracking / profiling | s.9(3): **no tracking or behavioural monitoring of children and no targeted advertising directed at them**, subject to prescribed exemptions. Sources describe this as a prohibition that parental consent does not cure. | High |
| Exemptions | Rules provide narrow exemptions for some classes (for example healthcare, education, safety) from some s.9 duties. Whether a fitness app could qualify is unknown. | Low |
| Persons with disability | s.9(1) and Rule 11 cover lawful guardians of persons with disability. Not relevant to age but relevant to consent design. | Medium |
| When it applies | The Rules were notified 13/14 Nov 2025 in phases. Section 9 and most substantive duties are reported to commence **about 18 months after notification, around 13/14 May 2027** (sources differ by a day). A 2026 "Removal of Difficulties" order reportedly adjusted wording of ss.9-10 without changing their commencement. | Medium; verify dates |
| Penalty exposure | Sources cite up to ₹200 crore for breaches of children's-data obligations. | Medium |

## 3. What this means for the 14+ preference

If 14 to 17-year-olds can have accounts, then once s.9 is in force counsel will have to decide how the service would:

1. **Identify** that a user is a child (age is self-declared today; the app has no verification).
2. **Obtain verifiable parental consent** per Rule 10 before processing their data, including the data that is synced to the cloud, sent to
   Gemini, and held by Razorpay if they ever pay. This is likely to need an age-and-identity verification provider and a parent flow.
3. **Avoid tracking and behavioural monitoring.** Counsel must say whether the app's personalisation (workout history driving AI
   suggestions, recovery analytics, adaptive targets) amounts to "behavioural monitoring" of a child. This is the hardest question
   for a fitness product and parental consent does not solve it.
4. **Avoid detrimental processing.** Body image, calorie targets, weight goals and physique projections for minors raise well-being
   concerns independent of the Act (eating-disorder risk). Body Scan is already 18+; physique analysis, nutrition targets and weight
   goals have no age restriction today.
5. **Contract capacity.** Whether a minor can be bound by the Terms or pay a subscription is a contract-law question separate from the
   data-protection one. A parent or guardian may need to be the contracting party.

Separately: before s.9 commences, the Act's child provisions are not yet operative, but a payment-provider or app-store review may ask
about minors earlier, and good practice and consumer-protection rules may still apply.

## 4. Options for counsel and owner (no recommendation is made)

| Option | Effect | Cost / risk |
|---|---|---|
| A. Adults only (18+) for all accounts | Avoids s.9 entirely for registered users. Contradicts the 14+ preference. | Self-declared age can be false; still need reasonable steps. Smallest build. |
| B. 14+ with verifiable parental consent for 14-17 | Matches the preference. | Needs a Rule 10-compliant consent flow and verification provider; unresolved "behavioural monitoring" question; larger build and ongoing cost. |
| C. 14+ with a restricted mode for under-18s (no AI, no cloud sync, no nutrition or physique goals) | Reduces risk surface. | Still processes a child's data; consent still needed; large product change. |
| D. Defer the age decision until counsel advises, launch adults-only in the meantime | Safe default for a paid launch. | Needs a stated age rule in the Terms and an age confirmation at sign-up (separate from the approved wording). |

## 5. Questions for Indian counsel

1. Which option above is acceptable for a paid public launch, and from what date does s.9 bind this service?
2. Is a self-declared age confirmation sufficient evidence before s.9 commences, and what does Rule 10 require after?
3. Does the app's personalisation or AI coaching amount to "tracking or behavioural monitoring" of children?
4. Do any Rule exemptions (health, education, safety) apply to a fitness-tracking app?
5. Can a minor contract for a subscription, and should a parent or guardian be the contracting party?
6. What wording is required in the Terms (eligibility) and Privacy Policy (children's data, parental consent, grievance route)?
7. Do Razorpay or app-store rules impose age or parent requirements on the merchant?

## 6. Source list (secondary; verify against primary)

- Mondaq, "Children's Data Protection Under India's DPDP Act: What Businesses Need To Know".
- Mondaq, "Data Privacy Laws For Businesses Handling Children's Personal Data In India" (commencement dates).
- Sansa Legal, "How to Design a Verifiable Parental Consent Process Under the DPDP Rules 2025" (s.9, Rule 10, G.S.R. 843(E) and 846(E) of 13 Nov 2025).
- Mondaq, "DPDP (Removal Of Difficulties) Order, 2026: What Changes In Sections 9 And 10".
- KS&K and ORF commentary on the DPDP Rules 2025.

Primary sources to obtain: the Digital Personal Data Protection Act 2023; the DPDP Rules 2025 (G.S.R. 846(E)); commencement notification
G.S.R. 843(E) of 13 November 2025; the 2026 Removal of Difficulties Order.
