# Baby Tracking Web App — Full Specification

## 1. Objective

A dead-simple, real-time baby tracking app for a household.

- **Primary users (v1):** two parents, each with their own account.
- **Later:** grandparents, sitters, etc. added via invite (out of scope for v1 but data model and auth must accommodate).
- **Devices:** iPhone, iPad, Android tablet (including one wall-mounted in the nursery), used on the go as well as at home.
- **Primary use:** fast logging while sleep-deprived; quick glance at "when did we last…?"

---

## 2. Core Principles (MANDATORY)

1. **One tap** for simple actions (diapers).
2. **Quick panel, ≤2 taps** for parameterized actions (bottle volume, breast outcome, pump volume).
3. **Zero required typing** in the common case. Custom values are always possible but never required.
4. UI must be usable half-asleep at 3am.
5. All actions complete in <300ms perceived latency.
6. Realtime sync across all devices.
7. **Works on the go** — auth + data must not depend on being on the home network.
8. **Locked down** — authenticated household members only; no public access.
9. **PWA-first** — installed to home screen on every device; browser address bar should not appear in normal use.

If any feature violates these, it is rejected.

---

## 3. Tech Stack

Frontend:
- React with Next.js (App Router)
- Tailwind CSS
- Firestore SDK (client-side) with built-in offline persistence
- PWA with manifest + service worker

Backend:
- Firebase
  - **Firestore** (Native mode) — event storage
  - **Firebase Auth** — magic link (email link) sign-in

Hosting:
- Vercel (Next.js preset)

Rationale for Firebase over Supabase: Firestore's built-in offline queue and battle-tested realtime sync are higher value for a nursery-use app than Supabase's SQL flexibility, given the small data scale.

---

## 4. Users & Access Control

- **v1:** exactly two pre-created accounts (the two parents).
- Authentication required for all reads and writes.
- No public access.
- Each user has their own account — no sharing credentials.
- `created_by` on every event preserves attribution (useful when grandparents are added later).

Auth Requirements:
- **Magic link** (email link) login, no passwords.
- Session persists for 90+ days via refresh token renewal.
- Installed as a PWA on each device to avoid iOS Safari ITP storage wipes.
- Returning users should essentially never have to re-authenticate in practice.

Future (v1.1+):
- Invite flow for grandparents and sitters.
- Household concept (single household in v1; data model tolerates future multi-user additions without migration).

---

## 5. Data Model

Firestore collection: `events`

Every event is an independent document with type-specific fields. Fields that don't apply to a given type are simply absent.

### Common fields (all events)

| Field          | Type                | Notes |
| -------------- | ------------------- | ----- |
| `id`           | string (UUID v4)    | Generated **client-side** for offline/idempotency safety. Document ID in Firestore. |
| `type`         | string              | One of the types in §6. |
| `occurred_at`  | timestamp           | When the event actually happened (may be back-dated when editing). UTC. |
| `created_by`   | string (auth uid)   | Who logged it. |
| `created_at`   | timestamp           | When the row was written. Server-set. |
| `updated_at`   | timestamp           | Last edit. Server-set. |
| `deleted`      | boolean             | Soft delete. Default false. |

All display is in the device's local time zone; storage is always UTC.

---

## 6. Event Types

### 6.1 `breast_feed`
Extra fields:
- `outcome`: enum — one of:
  - `latched_fed` — "Latched & fed"
  - `latched_brief` — "Latched briefly / fussy"
  - `no_latch` — "Didn't latch"

No duration tracked.

### 6.2 `bottle_feed`
Extra fields:
- `volume_ml`: integer (required)
- `milk_types`: array of strings (non-empty; multi-select allowed) — any subset of:
  - `mom_pumped`
  - `donor`
  - `formula`

Multi-select reflects real mixed bottles (e.g. donor + mom's).

### 6.3 `pump`
Extra fields:
- `volume_ml`: integer (required)

No left/right tracking in v1.

### 6.4 `diaper_wet`
No extra fields.

### 6.5 `diaper_dirty`
No extra fields.

(If a diaper is both, log both events — two taps. Keeps schema trivial.)

### 6.6 `sleep_start`
No extra fields.

### 6.7 `sleep_end`
No extra fields. The pair `sleep_start` → `sleep_end` defines a sleep session.

---

## 7. Derived Logic (computed client-side)

- **Last feed:** most recent `breast_feed` or `bottle_feed` by `occurred_at`. Display "Xh Ym ago" plus type.
- **Last diaper:** most recent `diaper_wet` or `diaper_dirty`.
- **Sleeping status:** if latest sleep event is `sleep_start` with no later `sleep_end`, baby is sleeping. Dashboard shows a live up-counting timer. Otherwise "awake (Xh Ym)."
- **Baby's age:** computed from `birthdate` in config.

---

## 8. Core Features

### 8.1 Logging Actions — Layout

Fixed grid (2 columns × 3 rows of primary buttons), each ≥80px tall:

```
[ Breast Feed ] [ Bottle Feed ]
[ Wet Diaper  ] [ Dirty Diaper ]
[ Pump        ] [ Sleep (toggle) ]
```

The Sleep button toggles based on current state: label reads "Start Sleep" when awake, "End Sleep" when sleeping.

### 8.2 Quick Panels for Parameterized Events

**Bottle Feed:**
- Volume preset buttons: 30, 60, 90, 120, 150 ml, plus "Custom"
- Milk type checkboxes: Mom pumped / Donor / Formula (multi-select; at least one required)
- "Last used" values pre-selected
- One confirm tap writes the event

**Breast Feed:**
- Three large outcome buttons — each is tap-to-log:
  - Latched & fed
  - Latched briefly / fussy
  - Didn't latch

**Pump:**
- Volume preset buttons (same scheme as bottle) + Custom
- One confirm tap writes the event

Simple events (diapers, sleep toggle) skip the panel and log instantly.

### 8.3 Dashboard

Always visible at the top:
- Baby's name + age ("Emma — 14 days")
- Last feed: "1h 12m ago — Bottle, 75ml" (or equivalent for breast)
- Last diaper: "22m ago — Wet"
- Sleep status: "Sleeping — 38m" (live counter) or "Awake — 2h 04m"

All values update in realtime.

### 8.4 History

- Reverse chronological list.
- Each entry shows: icon/type, time ("2:14 PM"), relative ("3h ago"), type-specific details, and who logged it (initial or name).
- **Edit** within 24 hours of `occurred_at`: any field including `occurred_at` itself.
- **Delete** within 24 hours (soft delete).
- After 24 hours, entries are read-only.
- "Log at past time" entry point: a small "Log for earlier time…" button that opens a quick panel with a time picker, useful when you forgot to log at the moment.

### 8.5 Units

- Volumes stored in **ml**.
- Display: primary value in ml, secondary small conversion in oz (e.g. "75 ml (2.5 oz)").

---

## 9. UI/UX Rules

- Minimum 80px touch targets.
- High contrast; large text throughout.
- No modals for core actions.
- No confirmation dialogs except destructive delete in history.
- All quick panels dismiss on outside tap or after confirm.
- Subtle visual feedback on button tap; no disruptive animation.

Tablet (wall mode):
- Same layout, larger text.
- Buttons still functional (grandparents may still tap them).
- Dashboard is the focus.

---

## 10. Realtime Sync

- Firestore `onSnapshot` listener on the `events` collection, ordered by `occurred_at` desc, limit to recent window (e.g. last 7 days) for performance.
- All clients update automatically on writes from any user.
- No polling.

---

## 11. Offline & PWA

- Installable on iOS and Android via home-screen install.
- Installation is part of onboarding (documented setup checklist per device).
- Fullscreen standalone mode via manifest.
- Cached app shell for fast load.
- **Offline writes** queued by Firestore SDK automatically; replayed on reconnect.
- Client-generated UUIDs ensure no duplicate events from offline replay + realtime echo.

---

## 12. Error Handling

- Failed writes: Firestore retries automatically.
- Show a small, non-blocking indicator (e.g. a dot in a corner) when a write is pending or failed.
- **Never show a technical error dialog to the user.** Any surfaced message must be human-readable and non-blocking.

---

## 13. Edge Cases

- **Double taps:** debounce all action buttons for 500ms.
- **Concurrent users:** multiple inserts are fine; realtime reflects latest state.
- **Missing sleep_end:** dashboard shows "Sleeping — live timer." Tapping Sleep toggles to End.
- **Back-dated events:** an edit that changes `occurred_at` to the past correctly re-sorts history and updates dashboard derived values.

---

## 14. Configuration

Stored in a single config document in Firestore (`config/household`):
- `baby_name`: string
- `baby_birthdate`: date
- Editable via a minimal settings page (accessible from a small gear icon, not in the primary flow).

---

## 15. Deployment

### Firebase
1. Create Firebase project at console.firebase.google.com (Spark / free plan).
2. Add a Web App to the project — copy the config object.
3. Enable **Authentication → Email link (passwordless)**.
4. Enable **Firestore** (Native mode); pick a region near you.
5. Set security rules (see §16).
6. Pre-create both parent accounts (add allowed emails to an allowlist collection or hardcode in rules for v1).

### Vercel
1. Import this repo as a Next.js project (auto-detected).
2. Add environment variables (all `NEXT_PUBLIC_` prefixed, since Firebase web config is client-side):
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
3. Deploy. Vercel auto-deploys on git push.

### Domain
- Custom domain optional for v1 (default `.vercel.app` URL is fine behind a PWA install).

---

## 16. Security

Firestore Security Rules:
- Only authenticated users in an explicit `allowed_emails` list (or UID allowlist) can read or write.
- No public access under any path.
- Writes must include `created_by == request.auth.uid`.
- Edits and deletes must be by the original author OR within the 24-hour window; enforce via rules.

---

## 17. Performance Requirements

- Action latency (tap → optimistic UI update): under 100ms.
- Write round-trip: under 500ms on WiFi.
- Initial load: under 1 second on WiFi (after first install).
- Realtime updates across devices: under 500ms.

---

## 18. Definition of Done (v1)

- Both parents have accounts and are logged in on their phone + the nursery tablet, all installed as PWAs.
- All event types in §6 can be logged in ≤2 taps.
- Dashboard reflects realtime state across all devices.
- Edit and delete work within 24 hours from the history view.
- Offline writes while in the nursery (no WiFi) replay correctly on reconnect.
- No re-login required in normal use over 30+ days.

---

## 19. Non-Goals (v1)

- No analytics dashboards or charts.
- No multi-child support (but `child_id` column reserved as nullable for future).
- No notifications.
- No social features.
- No data export UI (can be done from Firebase console if needed).
- No nursery cam / UniFi Protect integration.
- No grandparent / sitter invite flow (accounts pre-created manually in v1).

---

## 20. Future Scope (v1.1+)

- Invite flow for additional household members (grandparents, sitters).
- Weight & milestone tracking.
- Medications / vitamins.
- Notifications (e.g. "no feed in 4 hours").
- Data export (CSV).
- Nursery cam link (likely via Home Assistant + Tailscale).
- Trends view (sleep totals, feed volumes over time).
- Passkey auth if Firebase support matures.

---

## Final Instruction to Coding Agent

Prioritize:
1. Simplicity.
2. Speed (both perceived latency and developer velocity).
3. Reliability (especially offline and session persistence).

Reject any feature that adds friction to the core logging flow.
