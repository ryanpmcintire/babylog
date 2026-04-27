/**
 * One-off: print the latest entries from prod's views/home doc to check
 * whether the dual-write has been keeping it current. Read-only.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 npx tsx scripts/inspect-prod-view.ts
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error("FIREBASE_PROJECT_ID required");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing: FIRESTORE_EMULATOR_HOST is set, this is a prod inspector.");
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

async function main() {
  const snap = await db.doc("households/mcintire/views/home").get();
  if (!snap.exists) {
    console.log("views/home does not exist");
    return;
  }
  const d = snap.data()!;
  const re = (d.recent_events ?? []) as Array<{
    id: string;
    type: string;
    occurred_at: { toDate: () => Date };
  }>;
  const ts = (d.updated_at as { toDate: () => Date } | undefined)?.toDate();
  console.log(`updated_at: ${ts?.toISOString() ?? "(none)"}`);
  console.log(`recent_events count: ${re.length}`);
  console.log(`\nNewest 15 entries (newest-first):`);
  for (const e of re.slice(0, 15)) {
    const occ = e.occurred_at?.toDate?.()?.toISOString() ?? "?";
    console.log(`  ${occ}  ${e.type.padEnd(15)}  id=${e.id}`);
  }

  // Cross-check: query the events collection for entries newer than the
  // oldest in recent_events but within today, to see if any were missed.
  const eventsSnap = await db
    .collection("households/mcintire/events")
    .orderBy("occurred_at", "desc")
    .limit(15)
    .get();
  console.log(`\nNewest 15 events in collection (source of truth):`);
  for (const doc of eventsSnap.docs) {
    const data = doc.data() as { type: string; occurred_at: { toDate: () => Date }; deleted?: boolean };
    if (data.deleted) continue;
    const occ = data.occurred_at.toDate().toISOString();
    console.log(`  ${occ}  ${data.type.padEnd(15)}  id=${doc.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
