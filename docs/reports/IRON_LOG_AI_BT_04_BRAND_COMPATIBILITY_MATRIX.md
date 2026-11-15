# BT-04 — Brand Compatibility Matrix

Research date **2026-11-15**. **No device has been tested on hardware. Nothing below is "Verified"**, and nothing is "Implemented" except the generic standard-heart-rate Bluetooth path, which is device-agnostic and itself unverified on real hardware. This is a map of leads and gates, **not a list of supported devices.** Never advertise a brand from this table.

Machine-readable twin: `src/wearables/compatibility.ts` (a test fails if any entry is marked verified/implemented).

## Evidence labels
**OFFICIAL** read this stage on an official vendor/platform page · **SECONDARY** third-party, forum or integrator page read this stage · **CARRIED** claim carried from BT-03 and **not re-verified here** · **NONE** no source.

## What I actually verified this stage
| Claim | Source type | Finding |
|---|---|---|
| Garmin cloud API access | OFFICIAL (developer.garmin.com Health API/Program pages) | "Free to approved business developers"; approval required; an evaluation environment follows approval; Starter vs Enterprise tiers with different delivery, history and user capacity. |
| Garmin approval is not guaranteed | SECONDARY (Garmin developer forum threads) | Developers report rejections and unanswered follow-ups. One thread mentions a consumer program being "paused" (unconfirmed). |
| Fitbit legacy API | OFFICIAL (developers.google.com/health) | Legacy Fitbit Web API support ended 30 Sep 2026 and the API is turned off 30 Oct 2026 (an integrator page says 2 Nov; sources differ). Either way it is off as of today. |
| Google Health API for new projects | OFFICIAL + SECONDARY | Google's page said it was "not onboarding new projects at this time" (page updated 2026-09-25). An integrator reports the notice was later removed but reopening was not announced, and that a security assessment is mandatory. **Status uncertain; confirm in the console.** |
| Web Bluetooth on iOS | SECONDARY (library docs, App Store listings) | Safari and Chrome on iOS lack Web Bluetooth. Third-party iOS browsers (e.g. Bluefy) and an iOS 26+ Safari extension (WebBLE, exposes `navigator.webble`, not `navigator.bluetooth`, unless a bridge script is added) provide it. **None tested with Iron Log.** |
| Polar AccessLink | SECONDARY (client-library docs) | Client registration with a Polar Flow account, OAuth2 authorization-code flow, data pulled after the user syncs the device to Polar Flow. Official polar.com terms **not read**. |

Everything not in that table is CARRIED from BT-03 (itself labelled 2ND/ASSUME) or NONE. Do not treat carried items as facts.

## Matrix
States: Untested · Documented · Implemented · Verified · Degraded · Unsupported. "PWA" = works from the installed web app without native code. "Direct BLE" = Web Bluetooth to the device itself.

| Brand | Direct BLE (PWA, Android Chrome) | Direct BLE (iPhone PWA) | Official cloud API | Via aggregator | Via HealthKit / Health Connect (**native, deferred**) | Evidence | Notes / known limits |
|---|---|---|---|---|---|---|---|
| Apple Watch | Untested (CARRIED: no standard HR service by default) | Unsupported in Safari/Chrome iOS | n/a | Untested | Untested | CARRIED | Realistic route is HealthKit, which needs a native app. |
| Samsung Galaxy Watch | Untested | Unsupported (Safari) | Untested | Untested | Untested | NONE | Realistic route is Health Connect (native). |
| Garmin | Untested (optional HR-broadcast mode, CARRIED) | Unsupported (Safari) | **Documented** (approval-gated, business developers only) | Untested | Untested | OFFICIAL | Apply early; do not block releases. Terms must be reviewed for AI-processing restrictions. |
| Fitbit | Untested | Unsupported (Safari) | **Unsupported** (legacy off; new API uncertain) | Untested | Untested | OFFICIAL | Re-check quarterly. |
| Google Pixel Watch | Untested | Unsupported (Safari) | **Unsupported** (same transition) | Untested | Untested | OFFICIAL | Health Connect (native) is the realistic route. |
| Amazfit / Zepp | Untested | Unsupported (Safari) | Untested (partner program reported, CARRIED) | Untested | Untested | CARRIED | Do **not** use community reverse-engineered endpoints. |
| Xiaomi / Mi Fitness | Untested | Unsupported (Safari) | Untested (none found, CARRIED) | Untested | Untested | CARRIED | |
| Huawei | Untested | Unsupported (Safari) | Untested (HMS Health Kit, CARRIED) | Untested | Untested | CARRIED | Region/ecosystem limits likely. |
| Polar | Untested (chest straps typically expose standard HR) | Unsupported (Safari) | Untested; strong lead (self-serve registration, SECONDARY) | Untested | Untested | SECONDARY | Best first cloud candidate; audience in India probably small. |
| Suunto | Untested | Unsupported (Safari) | Untested (contract, CARRIED) | Untested | Untested | CARRIED | |
| COROS | Untested | Unsupported (Safari) | Untested | Untested | Untested | NONE | |
| Noise | Untested | Unsupported (Safari) | Untested (none found, CARRIED) | Untested | Untested | CARRIED | Vendor apps are closed; HR broadcast support unknown per model. |
| boAt | Untested | Unsupported (Safari) | Untested (none found, CARRIED) | Untested | Untested | CARRIED | As above. |
| Fire-Boltt | Untested | Unsupported (Safari) | Untested (none found, CARRIED) | Untested | Untested | CARRIED | As above. |
| Fastrack | Untested | Unsupported (Safari) | Untested (none found, CARRIED) | Untested | Untested | CARRIED | As above. |
| WHOOP | Untested (HR broadcast reported, CARRIED) | Unsupported (Safari) | Untested (public developer platform, CARRIED) | Untested | Untested | CARRIED | Membership required. |
| Oura | Unsupported in practice (rings do not broadcast standard HR, CARRIED) | Unsupported (Safari) | Untested (user cap before approval, CARRIED) | Untested | Untested | CARRIED | |
| Generic BLE heart-rate strap | **Implemented, hardware-unverified** (standard 0x180D) | Unsupported in Safari; Untested in third-party iOS browsers | n/a | n/a | n/a | n/a | The only path that exists in code. Parser is unit-tested against synthetic packets, not real straps. |

## Indian market (Noise, boAt, Fire-Boltt, Fastrack)
No official developer API was found in BT-03 and none was researched further here. These bands usually sync only to their own app; some can write to Health Connect/HealthKit, **which is model-specific and untested**. The honest position today: **do not claim any of them.** The efficient next step is a small hardware test (BT-09 style): for each popular model, record whether it (a) advertises the standard Heart Rate service in a BLE scanner, (b) writes to Health Connect/HealthKit via its app. Test only what the owner physically has.

## Companion-app ≠ Iron Log
A watch working with its manufacturer's phone app says nothing about Iron Log. Every cell above is about a route into Iron Log specifically.

## Regional note
Cloud-API availability and terms can differ by region; none were researched for India specifically. Treat as unknown.
