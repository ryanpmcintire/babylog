import type { BabyEvent } from "./events";

export type DayBucket = {
  date: Date;
  label: string;
  milkMl: number;
  pumpMl: number;
  sleepMinutes: number;
  feeds: number;
  diapers: number;
};

export type SleepSegment = {
  dayKey: string;
  startMin: number;
  endMin: number;
  ongoing: boolean;
};

export type Marker = {
  dayKey: string;
  atMin: number;
  kind: "breast" | "bottle" | "pump" | "diaper_wet" | "diaper_dirty";
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d: Date): string {
  const y = startOfDay(d);
  return `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`;
}

function shortLabel(d: Date, today: Date): string {
  const diff = Math.round(
    (startOfDay(today).getTime() - startOfDay(d).getTime()) / 86400000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yest";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function buildDailyBuckets(
  events: BabyEvent[],
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const day = startOfDay(d);
    buckets.push({
      date: day,
      label: shortLabel(day, now),
      milkMl: 0,
      pumpMl: 0,
      sleepMinutes: 0,
      feeds: 0,
      diapers: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [dayKey(b.date), b]));

  for (const e of events) {
    const at = e.occurred_at.toDate();
    const b = byKey.get(dayKey(at));
    if (!b) continue;
    switch (e.type) {
      case "bottle_feed":
        b.milkMl += e.volume_ml;
        b.feeds += 1;
        break;
      case "breast_feed":
        b.feeds += 1;
        break;
      case "pump":
        b.pumpMl += e.volume_ml;
        break;
      case "diaper_wet":
      case "diaper_dirty":
        b.diapers += 1;
        break;
    }
  }

  // Sleep spans can cross midnight, so walk sleep pairs and split.
  const sleeps = buildSleepSegments(events, now);
  for (const s of sleeps) {
    const b = byKey.get(s.dayKey);
    if (!b) continue;
    b.sleepMinutes += Math.max(0, s.endMin - s.startMin);
  }

  return buckets;
}

export function buildSleepSegments(
  events: BabyEvent[],
  now: Date = new Date(),
): SleepSegment[] {
  // events newest-first. Walk oldest-first for pairing.
  const chrono = [...events].reverse();
  const segments: SleepSegment[] = [];
  let open: Date | null = null;

  for (const e of chrono) {
    if (e.type === "sleep_start") {
      open = e.occurred_at.toDate();
    } else if (e.type === "sleep_end" && open) {
      addSleepSegment(segments, open, e.occurred_at.toDate(), false);
      open = null;
    }
  }
  if (open) {
    addSleepSegment(segments, open, now, true);
  }
  return segments;
}

function addSleepSegment(
  out: SleepSegment[],
  start: Date,
  end: Date,
  ongoing: boolean,
) {
  let cursor = new Date(start);
  while (cursor < end) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(24, 0, 0, 0);
    const segmentEnd = dayEnd < end ? dayEnd : end;
    const startMin = cursor.getHours() * 60 + cursor.getMinutes();
    const endMin =
      segmentEnd.getTime() === dayEnd.getTime()
        ? 24 * 60
        : segmentEnd.getHours() * 60 + segmentEnd.getMinutes();
    out.push({
      dayKey: dayKey(cursor),
      startMin,
      endMin,
      ongoing: ongoing && segmentEnd === end,
    });
    cursor = dayEnd;
  }
}

export function buildMarkers(events: BabyEvent[]): Marker[] {
  const markers: Marker[] = [];
  for (const e of events) {
    const at = e.occurred_at.toDate();
    const key = dayKey(at);
    const atMin = at.getHours() * 60 + at.getMinutes();
    switch (e.type) {
      case "breast_feed":
        markers.push({ dayKey: key, atMin, kind: "breast" });
        break;
      case "bottle_feed":
        markers.push({ dayKey: key, atMin, kind: "bottle" });
        break;
      case "pump":
        markers.push({ dayKey: key, atMin, kind: "pump" });
        break;
      case "diaper_wet":
        markers.push({ dayKey: key, atMin, kind: "diaper_wet" });
        break;
      case "diaper_dirty":
        markers.push({ dayKey: key, atMin, kind: "diaper_dirty" });
        break;
    }
  }
  return markers;
}

export function dayKeyOf(d: Date): string {
  return dayKey(d);
}
