/**
 * One-off: dump the sleep_segments from prod's views/insights for
 * specific dayKeys, so we can see whether they look right.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 npx tsx scripts/inspect-prod-segments.ts
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error("FIREBASE_PROJECT_ID required");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing: emulator host set, this is a prod inspector.");
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

async function main() {
  const snap = await db.doc("households/mcintire/views/insights").get();
  if (!snap.exists) {
    console.log("views/insights does not exist");
    return;
  }
  const d = snap.data()!;
  const segments = (d.sleep_segments ?? []) as Array<{
    dayKey: string;
    startMin: number;
    endMin: number;
    source: string;
    ongoing: boolean;
  }>;
  // Group by dayKey, sort.
  const byDay = new Map<string, typeof segments>();
  for (const s of segments) {
    const arr = byDay.get(s.dayKey) ?? [];
    arr.push(s);
    byDay.set(s.dayKey, arr);
  }
  const days = Array.from(byDay.keys()).sort();
  console.log(`Total segments: ${segments.length}`);
  console.log(`Distinct dayKeys: ${days.length}`);
  console.log(`\nPer-day breakdown (newest first):\n`);
  for (const day of days.reverse()) {
    const segs = (byDay.get(day) ?? []).sort(
      (a, b) => a.startMin - b.startMin,
    );
    const totalMin = segs.reduce(
      (sum, s) => sum + (s.endMin - s.startMin),
      0,
    );
    const totalH = (totalMin / 60).toFixed(1);
    console.log(`  ${day}: ${segs.length} segs, ${totalH}h total`);
    for (const s of segs) {
      const h = Math.floor(s.startMin / 60).toString().padStart(2, "0");
      const m = (s.startMin % 60).toString().padStart(2, "0");
      const eh = Math.floor(s.endMin / 60).toString().padStart(2, "0");
      const em = (s.endMin % 60).toString().padStart(2, "0");
      console.log(
        `      ${h}:${m}–${eh}:${em} (${s.source}${s.ongoing ? ", ongoing" : ""})`,
      );
    }
  }

  // Cross-check with daily_summaries.sleepMinutes for same days.
  const dailySummaries = (d.daily_summaries ?? []) as Array<{
    dayKey: string;
    sleepMinutes: number;
  }>;
  console.log(`\nCross-check vs daily_summaries.sleepMinutes:\n`);
  for (const ds of dailySummaries.slice(-15).reverse()) {
    const segs = byDay.get(ds.dayKey) ?? [];
    const segTotal = segs.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);
    const dsH = (ds.sleepMinutes / 60).toFixed(1);
    const segH = (segTotal / 60).toFixed(1);
    const flag = Math.abs(ds.sleepMinutes - segTotal) > 30 ? "  <-- DRIFT" : "";
    console.log(
      `  ${ds.dayKey}: daily_summary=${dsH}h, segments=${segH}h${flag}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
