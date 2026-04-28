# Competitive takeaways from r/beyondthebump threads

Source: two long-form review threads on r/beyondthebump (saved as
`reddit-beyondthebump.json` and `reddit-beyondthebump2.json`). Author
"placeperson" tested Huckleberry, Glow, NIGHP Baby Tracker, and Baby
Daybook in detail. Comments are 2020-era but the apps and themes
remain dominant.

## What parents praise (vote-weighted)

1. **Huckleberry "sweet spot" sleep predictor.** Repeatedly described
   as "dark magic," "literal lifesaver," "ridiculously accurate."
   Multiple users stay on Huckleberry *only* for this even after
   switching trackers. This is THE killer feature in the category.
2. **Real-time cross-device sync of in-progress events.** Start a feed
   or nap on phone A, see it live and stop it from phone B.
   Huckleberry ships it but it's flaky. Baby Daybook does it best.
3. **Voice / Google Assistant integration** (Baby Daybook only).
   "Yell at my phone to mark his diapers as I'm changing him" —
   called a "gamechanger."
4. **Persistent ongoing-event notification** (nap timer in
   notification shade) — easy stop without unlocking the app.
5. **Customizable day-start time on calendar.** Run the day 7am→7am
   or 8am→8am instead of midnight, so night sleep looks like one
   continuous block.
6. **Configurable home screen.** Order/add/remove the trackable
   actions you actually use.
7. **Per-family premium pricing.** Baby Daybook ($13/yr, *one* sub
   shared by both parents) is praised; Glow's per-user model
   ($48/yr × 2 parents) is called "borderline offensively
   anticonsumer."
8. **Apple Watch app** (Baby Tracker) for one-handed logging.
9. **Photo attachment to events** (poop, rashes, milestones).
10. **Data export.** Huckleberry is the lone holdout. "It's my data,
    not theirs" — repeated dealbreaker for some users.

## Universal gaps across the entire category

- **No web/desktop app.** Every reviewed app is mobile-only. Babylog
  already has this — it's a real differentiator, not just a stack
  choice.
- **Reminders pegged to time-of-day vs. interval-since-last.** Baby
  Daybook's reminder is criticized as "silly" because it says
  "every 24 hours since the last log" instead of "every day at noon."
- **Switching breasts mid-feed in one entry.** Baby Daybook can't.
  Babylog's session-counted nursing solves this.

## Pricing benchmarks

| App | Price | Model |
|---|---|---|
| Huckleberry | $120/yr | per family, premium-gated sleep plans |
| Glow | $48/yr or $80 lifetime | **per user** (resented) |
| Baby Daybook | **$13/yr** | family-shared, ~95% of features free |
| NIGHP Baby Tracker | $5 one-time | ad removal only |

Quote on Huckleberry expensiveness: "the free version is very
powerful, you don't need to subscribe in order to get a lot of
value from the app." A meaningful share of the active user base
never pays.

Quote on Glow's per-user pricing: "This strikes me as insane and
borderline offensively anticonsumer."

Quote on data export: "I take exception to describing it as 'their
data' when I spend so much time each day carefully inputting every
single piece! These apps are just a spreadsheet front end; I don't
think it's excusable to keep the data locked away from the users."

## Implications for babylog

### 1. Pricing rethink
The current GO_LIVE_PLAN proposes Premium at $7.99/mo or $39.99/yr.
Baby Daybook covers the same feature surface for $13/yr, family-
shared. Huckleberry charges 3× that but justifies it with sleep
predictions + Berry AI chat. Babylog at $40/yr risks looking
overpriced unless we lean hard on a moat (sleep prediction,
AI summaries, web app, pediatrician export).

Options worth modeling:
- **$29/yr (annual-only)** — splits the difference, family-shared.
- **$39.99/yr OR $49 lifetime** — lifetime undercuts every
  competitor's renewal.
- **$3.99/mo or $19.99/yr** — undercut Baby Daybook entirely;
  rely on volume.

### 2. Web/desktop is bigger than the plan currently treats it
Phase 2 should market the web app in parallel with the iOS/Android
wrap, not as an afterthought. Tagline: "the only baby tracker you
can use from your laptop." Targets a real, repeated complaint.

### 3. Voice integration as a Phase 3 differentiator
None of the major iOS apps have it. Baby Daybook has Google
Assistant only. Adding "Hey Google, log a wet diaper" or Siri
Shortcuts moves babylog from category-equal to category-leading
on hands-free use — which is the worst pain point at 3am.

### 4. Live cross-device sync — surface what we already have
The dual-write architecture already gives near-real-time updates.
What's missing is the UX of "ongoing event" — a feed-in-progress
or nap-in-progress card visible on both partners' phones with
start/stop controls. That's product work, not infra. High-leverage
because Huckleberry's flaky sync is one of the most-cited frustrations.

### 5. Data export must be free
Putting CSV/JSON export behind a paywall puts babylog in
Glow/Huckleberry's anti-consumer bucket. Free export, paid PDF
pediatrician report.

### 6. Sleep prediction is the moat to defend
Babylog already infers sleep from event gaps. Productizing this as
a "sweet spot for nap"-style notification (the Huckleberry feature
parents stay for) would let us match their killer feature with no
subscription gate. Could be a free-tier hook that drives Premium+
upgrades for AI sleep coaching.

### 7. Customizable day-start time on calendar
Cheap product change with high satisfaction return. Lets parents
view their night as one continuous block. Worth adding before
launch.

### 8. Configurable home screen / quick actions
Lets parents pin only what they log. Reduces tap depth. Probably a
Phase 1 polish item, not a launch blocker.

### 9. Photo attachment to events
Phase 2 or Phase 3. Storage cost is real (move to Cloud Storage,
not Firestore field) but parents want it for poop/rash tracking.

### 10. Apple Watch
Premium-tier feature. Defer until Phase 3+ — but signal it on the
roadmap because at least one reviewer specifically chose Baby
Tracker for the Watch app.
