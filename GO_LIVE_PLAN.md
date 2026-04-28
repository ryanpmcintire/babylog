# Babylog — Go-Live Plan

**Status:** strategic roadmap. Phases 1–4 below are high-level. Each
phase needs a detailed implementation spec before we build it.

## 1. Where babylog stands today (2026-04-28)

Built and running in prod for one household (Lily McIntire, born
2026-04-09):

- **Tracking:** breast/bottle feeds (session-counted nursing across
  L+R within a 5-minute window), pumps, diapers (wet / dirty / mixed),
  sleep (explicit sleep_start / sleep_end + inferred from event gaps),
  weight, books read, foods tried, medications, temperature.
- **Multi-caregiver sync:** Firestore real-time across iPhone, iPad,
  wall-mounted Android tablet. Persistent local cache for offline.
- **Smart UI:** "Tonight mode" reduced-clutter night layout,
  predictive "next feed" / "next diaper" via median-interval
  estimation, fever-aware temperature card with AAP guidance,
  medication adherence card, suggested-next-side for nursing.
- **History/edit:** 24h edit window enforced by Firestore rules.
- **Charts:** Trends (3 / 7 / 14 / 30-day daily totals for milk,
  sleep, feeds, diapers, pumped, meds, temp peaks), Weight scatter
  with regression projection and optional WHO percentile curves,
  Timeline with explicit + inferred sleep bars and per-event markers.
- **Cost-architected backend:** materialized view docs per screen
  (`households/{hid}/views/home`, `views/insights`, `views/library`).
  Each screen reads exactly one Firestore doc cold-cache.

What's hardcoded for single-household / single-baby use:

- Email allowlist (`lib/baby.ts`, two emails).
- One baby per household, hardcoded.
- One household ID (`mcintire`).
- No paywall, no subscription state, no account creation flow.
- No marketing site, no App Store / Play Store presence — installed
  via `Add to Home Screen` PWA.

## 2. Competitive landscape

| App | Platforms | Pricing | Notes |
|---|---|---|---|
| Huckleberry | iOS / Android / web | Free; Plus $9.99/mo or $59.99/yr; Premium $14.99/mo or $129.99/yr | "SweetSpot" nap prediction (paid). 5M+ families. Premium = 24/7 AI pediatric chat ("Berry"). |
| Nara Baby | iOS / Android | Free, no ads, no premium | Generous free tier; mom self-tracking; multi-child; multi-caregiver sync. |
| Baby Daybook | iOS / Android, Apple Watch | Free; $29.99 lifetime; ~$4.99/mo | 20+ trackable activities, Apple Watch app. Lifetime price undercuts annual subs. |
| Glow Baby | iOS / Android | Free; ~$90/yr | Tracking + active community/forums. |
| Baby Connect | iOS / Android | 7-day trial → paid required | Family + professional plans (up to 15 babies for daycare). |
| Hatch Baby | iOS / Android | Free | Originally bundled with Hatch smart scale. |
| Wonder Weeks | iOS / Android | $7 one-time | Developmental leaps focus, not a feed/diaper tracker. |
| Sprout Baby Tracker | iOS / Android | Free; annual sub > $29.99 | Polished UI, growth charts. |
| Pebbi / Bambii / ParentLove | Mobile | Various (often freemium) | Newer entrants; AI-forward marketing. |

### Things babylog has that few competitors do

- **Inferred sleep from event gaps** with explicit-takes-precedence.
  Most apps need explicit sleep_start / sleep_end. Gap detection
  means parents who forget to log wake-ups still get accurate sleep
  totals. Differentiator.
- **Session-counted nursing** (5-minute window across sides). Other
  trackers count L+R as 2 feedings. Babylog counts 1.
- **AAP fever guidance baked into the temperature card.** Not just a
  chart — actual "call the pediatrician at this threshold for this
  age" decision support. Differentiator if kept medically accurate.
- **Cost-architected backend.** Every screen is one doc read
  cold-cache. Genuinely cheap unit economics, fast UI.

### Table-stakes babylog is missing

- Account creation flow (currently allowlist + email-link only).
- Multiple babies per household (twins).
- Photo / video attachments (milestones, first foods).
- Vaccination / immunization schedule with reminders.
- Growth percentile charts for height + head circumference (weight
  curves are optional already).
- Push notifications (medication due, next feed expected).
- PDF export for pediatrician visits.
- Account deletion in-app (App Store requirement).
- Apple HealthKit / Google Health Connect integration.
- Onboarding tutorial / empty states.

### Differentiating directions worth considering

- AI summarization layer (matches Huckleberry's Berry chat). Feed the
  dual-write data into Claude/OpenAI: "is her sleep pattern normal
  for 6 weeks?"
- Pediatrician-shared link or PDF.
- Postpartum mom tracking (Nara has it).

## 3. Free vs Paid split (recommended)

### Free tier — generous enough to be the default
- All event types, unlimited logging.
- 1 caregiver, 1 baby.
- Live cross-device sync.
- All charts, history, edit window, markers, sleep inference.
- 30-day data window for charts (older data still stored, just not
  charted).
- CSV export.

### Premium ($7.99/mo or $39.99/yr — undercuts Huckleberry, beats Glow's $90)
- Unlimited caregivers (grandparents, nanny).
- Multiple babies (twins).
- Unlimited chart history.
- PDF pediatrician report export.
- Apple HealthKit / Google Health Connect integration.
- Push notification reminders.
- Apple Watch app (if/when built).
- Photo attachments (10 GB).
- Lock-screen widget on iOS.

### Premium+ ($14.99/mo or $79.99/yr — Huckleberry-Premium tier)
- AI summaries / chat.
- Sleep coaching plans.
- Doula / lactation-consultant marketplace integration (revenue share).

**Conversion-rate context:** freemium median ~2%, hard-paywall median
~12%, health & fitness 4–12%. Realistic plan: 4% conversion at
$40/yr → ARPU ~$1.60 / registered user / yr; per-paying-user $40/yr.

## 4. Server cost model (per active family per month)

Workload assumptions:
- 30 events/day × 30 days = ~900 events/mo.
- Each write: 5 doc writes + 3 doc reads = 4,500 writes + 2,700 reads
  from writes per family.
- App opens: ~30 sessions/day combined, ~1.5 reads/session avg
  (cold-cache rare, persistent cache absorbs most) = ~1,350 reads/mo
  from reads.
- Storage growth: ~50 KB/family/mo.

Firestore unit costs (us-central1):
- Writes: $1.80/M → ~$0.0081 per family per month.
- Reads: $0.06/100K → ~$0.0024 per family per month.
- Storage: ~$0.0002/family/mo.
- **Total Firestore: ~$0.011 per family per month.**

| Scenario | Active families | Firestore | Vercel | RevenueCat | Monthly cost |
|---|---|---|---|---|---|
| Best (early, no paying) | 50 | $0.55 | $20 (Pro) | $0 | **~$21/mo** |
| Mid (5,000 active, 4% paying = 200 × $40/yr) | 5,000 | $55 | $20 | $0 (under $10K MTR) | **~$75/mo expense vs ~$667/mo revenue** |
| Worst (50,000 active, 4% paying = 2,000 × $40/yr) | 50,000 | $550 | ~$200 | ~$80 | **~$830/mo expense vs ~$6,600/mo revenue** |

**Costs are not the bottleneck.** Acquisition cost and Apple/Google's
30% cut are.

## 5. Acquisition channels

### What works for this category
- **App Store Optimization.** "baby tracker," "newborn log,"
  "breastfeeding tracker." Free, slow, compounds.
- **Reddit organic.** r/NewParents (1.8M), r/beyondthebump (450K),
  r/breastfeeding (200K). Reddit ads $0.10–0.80 CPC vs Instagram
  $1–5 CPI. Don't spam — answer threads where someone asks "what do
  you use to track feeds."
- **Instagram + TikTok influencer partnerships.** Mid-tier mom
  influencers $200–$2,000 per Instagram story.
- **Hospital / birth-class partnerships.** Long-tail, high-trust.
  Lactation consultants will recommend a tracker if you give it to
  them free.
- **Pinterest.** Underrated for parenting.

### What probably doesn't work yet
- Paid Google / Apple Search Ads. Huckleberry and venture-backed
  players outbid you.
- Generic Facebook / Instagram cold ads. $5+ CPI in this vertical.

**Realistic Year 1 acquisition target:** 1,000–5,000 organic installs,
50–250 paying = $2,000–10,000 ARR.

## 6. Market context

- US births 2025: 3,606,400 (CDC NCHS).
- ~3.6M new prospects / yr; ~1M actively in the 0–3 month "tracker is
  most-used" window.
- Parenting-apps market: $542M (2023) → ~$1B (2032), CAGR 7.6%.
  North America ~27%, baby trackers ~30% of parenting apps → ~$40–80M
  US baby-tracker addressable market today.
- Realistic ceiling for an indie app, no funding: 50K–200K MAU within
  2–3 years if marketing executes. ~$200K–$2M ARR potential at 4%
  conversion at $40/yr.

## 7. Phased roadmap

Each phase needs a comprehensive implementation spec before build.

### Phase 1 — multi-tenant foundation (4–6 weeks)
- Self-serve sign-up (kill the allowlist).
- Household setup wizard: name baby, DOB, sex, invite caregivers.
- Multi-baby support per household.
- Account deletion (App Store requirement).
- Privacy policy + Terms of Service (lawyer review).
- Internal alpha with 5–10 friend families.

### Phase 2 — store presence (2–3 weeks)
- Capacitor wrapper for iOS + Android.
- Native push notifications, biometric unlock, lock-screen widget
  (enough to clear Apple's 4.2 "wrapper-rejection" bar).
- App Store + Play Store listings with ASO keyword research.
- Marketing site (`babylog.app` or similar) — separate static site.

### Phase 3 — billing + launch (2–3 weeks)
- RevenueCat for IAP, Stripe for web.
- Free / Premium / Premium+ tiers with 7-day trial on annual.
- Soft launch via Reddit, Pinterest, week-of-life parenting groups.
- Watch retention (D1, D7, D30). Tracker-app D30 is brutal.

### Phase 4 — retention beyond newborn (6+ months in)
- AI summary / chat — the Premium+ hook for retention beyond
  6 months.
- Pediatrician partnerships, lactation-consultant networks for B2B
  distribution.
- If retention is bad: consider the Huckleberry play of extending
  product to "child" (toddler tracker, school-age tools) or accept
  the LTV ceiling.

## 8. Risk callouts

- **COPPA:** likely doesn't apply directly (babylog is for *parents*
  who happen to log data *about* children) but worth a $300–800
  one-time legal letter saying so.
- **HIPAA:** doesn't apply (not a covered entity).
- **GDPR:** apply right-to-export and right-to-erasure if EU users.
- **Apple guideline 4.2:** PWA-in-WebView gets rejected. Capacitor
  wrap needs at least one native feature (push, biometric, HealthKit)
  to clear review.
- **Built-in lifetime ceiling:** baby outgrows the use case in
  6–12 months. Either extend (toddler product) or accept it.

## 9. Sources

- [Huckleberry pricing](https://huckleberrycare.com/pricing)
- [Pebbi 2026 baby tracker comparison](https://pebbi.co/blog/best-baby-tracker-apps-2026)
- [Consumer Reports baby tracking apps](https://www.consumerreports.org/babies-kids/baby-tracking-apps/best-baby-tracking-apps-a6067862820/)
- [Baby Daybook premium](https://babydaybook.app/premium/)
- [SlashGear top baby tracking apps 2025](https://www.slashgear.com/1864409/best-baby-tracking-apps-parents-2025/)
- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [Capacitor — deploying to App Store](https://capacitorjs.com/docs/ios/deploying-to-app-store)
- [Mobiloud — publishing PWA to stores 2026](https://www.mobiloud.com/blog/publishing-pwa-app-store)
- [RevenueCat — Apple App Privacy](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy)
- [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- [Adapty — freemium to premium conversion](https://adapty.io/blog/freemium-to-premium-conversion-techniques/)
- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Vercel pricing](https://vercel.com/pricing)
- [Business of Apps — Cost per Install](https://www.businessofapps.com/ads/cpi/research/cost-per-install/)
- [RedLeads — Reddit ads cost breakdown](https://www.redleads.app/blog/how-much-do-reddit-ads-cost)
- [CDC NCHS — Vital Statistics 2025](https://www.cdc.gov/nchs/data/vsrr/vsrr043.pdf)
- [Roots Analysis — Parenting Apps Market](https://www.rootsanalysis.com/reports/parenting-apps-market.html)
- [Statista — Parenting apps revenues U.S. 2024](https://www.statista.com/statistics/1339457/parenting-apps-revenues-us/)
