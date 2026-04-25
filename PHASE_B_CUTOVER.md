# Phase B prod cutover

Move events from top-level `events/{eid}` to `households/{hid}/events/{eid}`,
behind membership-based rules. Source-of-truth doc — do not run any of these
steps blind. Read the whole thing first.

## Pre-flight

- [ ] Working tree clean, current changes pushed.
- [ ] Rules tests pass: `npm run test:rules` → 10 passing.
- [ ] Emulator end-to-end works:
  - `npm run emulator` (separate terminal)
  - `npx tsx scripts/seed-emulator.ts` (with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`)
  - `npm run migrate:emulator` → "Counts match"
  - Re-run migration → "skipped: 3" (idempotent).
- [ ] You have a service-account key JSON for the prod project with at least
      Cloud Datastore User on `babylog-ea6b2`. Save its path:
      `export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json`.
- [ ] You're on a stable connection. Pick a quiet time — ideally when nobody
      is logging events.

## Step 1 — Backup

Export the current Firestore to a GCS bucket. This is the rollback point.

```
gcloud auth login
gcloud config set project babylog-ea6b2
gcloud firestore export gs://babylog-ea6b2-backups/pre-phaseb-$(date +%Y%m%d-%H%M%S)
```

If the bucket doesn't exist yet:

```
gsutil mb -l us-central1 gs://babylog-ea6b2-backups
```

Note the export path printed by the command. To roll back later:
`gcloud firestore import gs://.../pre-phaseb-YYYYMMDD-HHMMSS`.

## Step 2 — Run the migration (copy-only)

```
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
FIREBASE_PROJECT_ID=babylog-ea6b2 \
  npx tsx scripts/migrate-to-households.ts --prod
```

The script:

- Seeds `households/mcintire` with baby info + `member_emails`.
- Copies every doc from `events/*` → `households/mcintire/events/{same id}`.
- Skips already-copied docs (idempotent — safe to re-run).
- Aborts with non-zero exit if destination total < source total.

Expected output ends with `✓ Counts match.` Anything else → STOP.

## Step 3 — Deploy rules + indexes

```
firebase deploy --only firestore:rules,firestore:indexes
```

This atomically swaps the rules. The new rules:

- Allow members to read/write `households/{hid}/...` based on
  `member_emails`.
- Keep `events/*` (top-level) **read-only** for the legacy allowlist (so
  the in-app fallback banner can fire if anything goes wrong).
- Block client writes to `households/{hid}` doc itself.

The new index covers `events` (collection-scoped) for both legacy and
subcollection.

## Step 4 — Deploy app code

```
git push origin main
```

Vercel will pick it up. Wait until the deploy finishes.

## Step 5 — Verify

In a regular browser tab signed in as you:

1. Open `https://babylog.vercel.app/health`.
2. Check:
   - `resolved hid` = `mcintire`
   - `Household doc → exists ✓ yes`
   - `member_emails` includes both your and Kelly's emails
   - `count (new path)` matches the source count from step 2
   - `count (legacy)` is the same number (legacy still readable)
   - `latest event` shows a recent event
3. Click **Run write+delete probe**. Should print `✓ ...succeeded`.
4. Open the home page. Verify:
   - Today's stats / dashboard show real data.
   - History shows recent events.
   - **No yellow legacy-fallback banner.**
5. Have Kelly do the same on her phone.

If the legacy banner appears, something failed. Don't panic — the app is
still working off legacy data. Roll forward by debugging the new path
(check `/health` for clues), or roll back rules (Step 6).

## Step 6 — Rollback (only if needed)

If the new path is broken and you need to restore the old behavior:

```
git checkout main~1 -- firestore.rules
firebase deploy --only firestore:rules
```

…and revert the app deploy via Vercel dashboard. The old code reads from
top-level `events/*`, which we never deleted, so all data is intact.

If data itself looks corrupt (it shouldn't — migration is copy-only):

```
gcloud firestore import gs://babylog-ea6b2-backups/pre-phaseb-YYYYMMDD-HHMMSS
```

## Step 7 — Cleanup (one week later)

Once you've confirmed the new path is working for ~7 days:

1. Remove the legacy fallback in `lib/useEvents.ts` (the `source === "legacy"`
   branch in `useRecentEvents`).
2. Remove the legacy `events/*` rules block in `firestore.rules`.
3. Remove the legacy banner in `app/components/HomeClient.tsx`.
4. Remove `app/health/page.tsx` (or keep it — it's useful).
5. Delete the legacy collection:

   ```
   firebase firestore:delete --recursive --project babylog-ea6b2 events
   ```

6. Deploy.

After this, top-level `events` is gone and Phase B is fully complete.

## Rollback summary

| Step reached | What to revert |
| --- | --- |
| Step 1 (export only) | nothing — no changes made |
| Step 2 (migration ran) | nothing — copy is non-destructive; re-run is idempotent |
| Step 3 (rules deployed) | redeploy old rules from previous git commit |
| Step 4 (code deployed) | revert Vercel deploy + redeploy old rules |
| Step 7 (legacy deleted) | restore from gcloud export |
