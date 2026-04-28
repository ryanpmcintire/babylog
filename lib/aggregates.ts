import type { BabyEvent } from "./events";

export type DayBucket = {
  date: Date;
  label: string;
  milkMl: number;
  pumpMl: number;
  sleepMinutes: number;
  feeds: number;
  // Total diaper changes (one event = one change, regardless of contents).
  diapers: number;
  // Output counts: mixed contributes to BOTH wets and dirties so the
  // pediatrician's "how many wet diapers in 24h" question is accurate.
  // The change-count `diapers` does NOT double-count.
  wets: number;
  dirties: number;
  mixeds: number;
  meds: number;
  // Highest temperature reading on this day, in Fahrenheit. null if no reading.
  maxTempF: number | null;
};

export type SleepSegment = {
  dayKey: string;
  startMin: number;
  endMin: number;
  ongoing: boolean;
  source: "explicit" | "inferred";
};

export const DEFAULT_INFER_BUFFER_MIN = 10;
export const DEFAULT_FEED_DURATION_MIN = 20;
export const DIAPER_AWAKE_BUFFER_MIN = 5;
// After any logged event, assume the baby stays awake this long before sleep
// could start. Applied uniformly to feeds and diapers.
export const POST_EVENT_AWAKE_MIN = 20;
export const PRE_EVENT_AWAKE_MIN = 5;
// If two awake intervals are within this many minutes of each other,
// treat them as one continuous awake session instead of a brief sleep-and-wake.
export const AWAKE_MERGE_THRESHOLD_MIN = 15;
// Inferred sleep windows shorter than this are dropped — probably not real sleep.
export const MIN_INFERRED_SLEEP_MIN = 20;

export type Marker = {
  dayKey: string;
  atMin: number;
  kind:
    | "breast"
    | "bottle"
    | "pump"
    | "diaper_wet"
    | "diaper_dirty"
    | "diaper_mixed"
    | "medication"
    | "temperature";
  eventId: string;
  // For temperature markers: the Fahrenheit reading, used to color the dot
  // (normal vs fever vs high fever).
  tempF?: number;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  options: { inferBufferMin?: number; feedDurationMin?: number } = {},
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
      wets: 0,
      dirties: 0,
      mixeds: 0,
      meds: 0,
      maxTempF: null,
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
        b.diapers += 1;
        b.wets += 1;
        break;
      case "diaper_dirty":
        b.diapers += 1;
        b.dirties += 1;
        break;
      case "diaper_mixed":
        b.diapers += 1;
        b.mixeds += 1;
        b.wets += 1;
        b.dirties += 1;
        break;
      case "medication":
        b.meds += 1;
        break;
      case "temperature":
        if (b.maxTempF === null || e.temp_f > b.maxTempF) {
          b.maxTempF = e.temp_f;
        }
        break;
    }
  }

  // Merge explicit + inferred windows, then intersect with day buckets.
  const all: SleepWindow[] = [
    ...explicitSleepWindows(events, now),
    ...(options.inferBufferMin && options.inferBufferMin > 0
      ? inferredSleepWindows(
          events,
          options.inferBufferMin,
          now,
          options.feedDurationMin ?? DEFAULT_FEED_DURATION_MIN,
        )
      : []),
  ];
  const merged = unionWindows(all);
  for (const w of merged) {
    for (const b of buckets) {
      const dayStart = b.date.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const overlapStart = Math.max(w.start.getTime(), dayStart);
      const overlapEnd = Math.min(w.end.getTime(), dayEnd);
      if (overlapEnd > overlapStart) {
        b.sleepMinutes += (overlapEnd - overlapStart) / 60000;
      }
    }
  }

  return buckets;
}

export type SleepWindow = {
  start: Date;
  end: Date;
  ongoing: boolean;
  source: "explicit" | "inferred";
};

export function explicitSleepWindows(
  events: BabyEvent[],
  now: Date = new Date(),
): SleepWindow[] {
  const chrono = [...events].reverse();
  const windows: SleepWindow[] = [];
  let open: Date | null = null;
  for (const e of chrono) {
    if (e.type === "sleep_start") {
      // Two sleep_starts in a row without a close — treat earlier one as ending here.
      if (open) {
        windows.push({
          start: open,
          end: e.occurred_at.toDate(),
          ongoing: false,
          source: "explicit",
        });
      }
      open = e.occurred_at.toDate();
    } else if (e.type === "sleep_end" && open) {
      windows.push({
        start: open,
        end: e.occurred_at.toDate(),
        ongoing: false,
        source: "explicit",
      });
      open = null;
    } else if (
      open &&
      (e.type === "breast_feed" ||
        e.type === "bottle_feed" ||
        e.type === "diaper_wet" ||
        e.type === "diaper_dirty")
    ) {
      // User forgot to log wake-up. A subsequent feed or diaper implies baby
      // was awake by that point, so auto-close the sleep at that event.
      windows.push({
        start: open,
        end: e.occurred_at.toDate(),
        ongoing: false,
        source: "explicit",
      });
      open = null;
    }
  }
  if (open) {
    windows.push({ start: open, end: now, ongoing: true, source: "explicit" });
  }
  return windows;
}

export function inferredSleepWindows(
  events: BabyEvent[],
  bufferMin: number = DEFAULT_INFER_BUFFER_MIN,
  now: Date = new Date(),
  feedDurationMin: number = DEFAULT_FEED_DURATION_MIN,
): SleepWindow[] {
  const awakes = buildAwakeIntervals(
    events,
    bufferMin,
    feedDurationMin,
    AWAKE_MERGE_THRESHOLD_MIN,
  );
  if (awakes.length === 0) return [];

  // Sleep fills the gaps between awake intervals.
  let windows: SleepWindow[] = [];
  for (let i = 0; i < awakes.length - 1; i++) {
    const start = awakes[i]!.end;
    const end = awakes[i + 1]!.start;
    if (end > start) {
      windows.push({ start, end, ongoing: false, source: "inferred" });
    }
  }

  // After the last awake interval, sleep extends to now (if in the past).
  const last = awakes[awakes.length - 1]!;
  if (last.end < now) {
    windows.push({
      start: last.end,
      end: now,
      ongoing: true,
      source: "inferred",
    });
  }

  // Explicit sleep takes precedence — inferred must not overlap with it.
  for (const ex of explicitSleepWindows(events, now)) {
    windows = windows.flatMap((w) =>
      subtractRangeFrom(w, ex.start, ex.end),
    );
  }

  // Drop windows shorter than the minimum — likely artifacts, not real sleep.
  const minMs = MIN_INFERRED_SLEEP_MIN * 60 * 1000;
  return windows.filter(
    (w) => w.end.getTime() - w.start.getTime() >= minMs,
  );
}

function subtractRangeFrom(
  w: SleepWindow,
  removeStart: Date,
  removeEnd: Date,
): SleepWindow[] {
  if (removeEnd <= w.start || removeStart >= w.end) return [w];
  if (removeStart <= w.start && removeEnd >= w.end) return [];
  if (removeStart > w.start && removeEnd < w.end) {
    return [
      { ...w, end: removeStart, ongoing: false },
      { ...w, start: removeEnd },
    ];
  }
  if (removeStart <= w.start) {
    return [{ ...w, start: removeEnd }];
  }
  return [{ ...w, end: removeStart, ongoing: false }];
}

function buildAwakeIntervals(
  events: BabyEvent[],
  _bufferMin: number,
  _feedDurationMin: number,
  mergeThresholdMin: number,
): { start: Date; end: Date }[] {
  const preMs = PRE_EVENT_AWAKE_MIN * 60 * 1000;
  const postMs = POST_EVENT_AWAKE_MIN * 60 * 1000;
  const mergeMs = mergeThresholdMin * 60 * 1000;

  const raw: { start: Date; end: Date }[] = [];
  for (const e of events) {
    const atMs = e.occurred_at.toDate().getTime();
    if (
      e.type === "breast_feed" ||
      e.type === "bottle_feed" ||
      e.type === "diaper_wet" ||
      e.type === "diaper_dirty"
    ) {
      raw.push({
        start: new Date(atMs - preMs),
        end: new Date(atMs + postMs),
      });
    }
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [{ ...raw[0]! }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1]!;
    const cur = raw[i]!;
    // Merge if overlapping OR if gap between them is under the threshold.
    if (cur.start.getTime() - prev.end.getTime() <= mergeMs) {
      if (cur.end.getTime() > prev.end.getTime()) prev.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function unionWindows(
  windows: SleepWindow[],
): { start: Date; end: Date }[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: { start: Date; end: Date }[] = [
    { start: sorted[0]!.start, end: sorted[0]!.end },
  ];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

export function buildSleepSegments(
  events: BabyEvent[],
  now: Date = new Date(),
  options: { inferBufferMin?: number; feedDurationMin?: number } = {},
): SleepSegment[] {
  const segments: SleepSegment[] = [];
  for (const w of explicitSleepWindows(events, now)) {
    addSleepSegment(segments, w.start, w.end, w.ongoing, "explicit");
  }
  if (options.inferBufferMin && options.inferBufferMin > 0) {
    for (const w of inferredSleepWindows(
      events,
      options.inferBufferMin,
      now,
      options.feedDurationMin ?? DEFAULT_FEED_DURATION_MIN,
    )) {
      addSleepSegment(segments, w.start, w.end, w.ongoing, "inferred");
    }
  }
  return segments;
}

function addSleepSegment(
  out: SleepSegment[],
  start: Date,
  end: Date,
  ongoing: boolean,
  source: "explicit" | "inferred",
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
      source,
    });
    cursor = dayEnd;
  }
}

export function currentSleepState(
  events: BabyEvent[],
  bufferMin: number = DEFAULT_INFER_BUFFER_MIN,
  now: Date = new Date(),
  feedDurationMin: number = DEFAULT_FEED_DURATION_MIN,
): { sleeping: boolean; since: Date | null; source: "explicit" | "inferred" | null } {
  // Check explicit first (takes priority)
  const chrono = [...events].reverse();
  let openStart: Date | null = null;
  let lastExplicitSleepEnd: Date | null = null;
  for (const e of chrono) {
    if (e.type === "sleep_start") openStart = e.occurred_at.toDate();
    else if (e.type === "sleep_end") {
      openStart = null;
      lastExplicitSleepEnd = e.occurred_at.toDate();
    }
  }
  if (openStart) {
    return { sleeping: true, since: openStart, source: "explicit" };
  }

  // Inferred: build awake intervals (feeds + diapers, merged if close),
  // and check whether `now` is after the last awake ended.
  const awakes = buildAwakeIntervals(
    events,
    bufferMin,
    feedDurationMin,
    AWAKE_MERGE_THRESHOLD_MIN,
  );
  if (awakes.length === 0) return { sleeping: false, since: null, source: null };

  const lastAwake = awakes[awakes.length - 1]!;

  // Explicit sleep_end after the last awake interval suppresses inference.
  if (lastExplicitSleepEnd && lastExplicitSleepEnd > lastAwake.end) {
    return { sleeping: false, since: null, source: null };
  }

  if (now <= lastAwake.end) {
    return { sleeping: false, since: null, source: null };
  }

  return { sleeping: true, since: lastAwake.end, source: "inferred" };
}

export function buildMarkers(events: BabyEvent[]): Marker[] {
  const markers: Marker[] = [];
  for (const e of events) {
    const at = e.occurred_at.toDate();
    const key = dayKey(at);
    const atMin = at.getHours() * 60 + at.getMinutes();
    switch (e.type) {
      case "breast_feed":
        markers.push({ dayKey: key, atMin, kind: "breast", eventId: e.id });
        break;
      case "bottle_feed":
        markers.push({ dayKey: key, atMin, kind: "bottle", eventId: e.id });
        break;
      case "pump":
        markers.push({ dayKey: key, atMin, kind: "pump", eventId: e.id });
        break;
      case "diaper_wet":
        markers.push({
          dayKey: key,
          atMin,
          kind: "diaper_wet",
          eventId: e.id,
        });
        break;
      case "diaper_dirty":
        markers.push({
          dayKey: key,
          atMin,
          kind: "diaper_dirty",
          eventId: e.id,
        });
        break;
      case "diaper_mixed":
        markers.push({
          dayKey: key,
          atMin,
          kind: "diaper_mixed",
          eventId: e.id,
        });
        break;
      case "medication":
        markers.push({
          dayKey: key,
          atMin,
          kind: "medication",
          eventId: e.id,
        });
        break;
      case "temperature":
        markers.push({
          dayKey: key,
          atMin,
          kind: "temperature",
          eventId: e.id,
          tempF: e.temp_f,
        });
        break;
    }
  }
  return markers;
}

export function dayKeyOf(d: Date): string {
  return dayKey(d);
}

export function estimateNextEvent(
  events: BabyEvent[],
  types: BabyEvent["type"][],
  lookbackN: number = 8,
  mergeWithinMs: number = 0,
): { nextAt: Date; medianIntervalMs: number; lastAt: Date } | null {
  const filtered = events.filter((e) => types.includes(e.type));
  // Collapse events that occurred within mergeWithinMs of each other into a
  // single "session" using the earliest timestamp. Events are in reverse
  // chrono order.
  const merged: BabyEvent[] = [];
  for (const e of filtered) {
    const last = merged[merged.length - 1];
    if (
      mergeWithinMs > 0 &&
      last &&
      Math.abs(last.occurred_at.toMillis() - e.occurred_at.toMillis()) <=
        mergeWithinMs
    ) {
      // Keep the earlier of the two so the session anchors on its start.
      if (e.occurred_at.toMillis() < last.occurred_at.toMillis()) {
        merged[merged.length - 1] = e;
      }
      continue;
    }
    merged.push(e);
  }
  const relevant = merged.slice(0, lookbackN);
  if (relevant.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 0; i < relevant.length - 1; i++) {
    intervals.push(
      relevant[i]!.occurred_at.toMillis() -
        relevant[i + 1]!.occurred_at.toMillis(),
    );
  }
  intervals.sort((a, b) => a - b);
  const medianIntervalMs = intervals[Math.floor(intervals.length / 2)]!;
  const lastAt = relevant[0]!.occurred_at.toDate();
  const nextAt = new Date(lastAt.getTime() + medianIntervalMs);
  return { nextAt, medianIntervalMs, lastAt };
}
