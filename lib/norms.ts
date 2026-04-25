// Age-based pediatric reference ranges. Sources: AAP, WHO Child Growth
// Standards (girls, weight-for-age, 0-24 months). Used as non-judgmental
// visual context on charts, not alerts.

export type Range = { min: number; max: number };

// Approximate weight-for-age reference points for girls, in grams, sampled at
// key day-of-life milestones. Early points reflect the typical newborn weight
// dip (~6-7% loss by day 3-4, return to birth weight by day 10-14); later
// points approximate WHO Child Growth Standards. Linear interpolation between.
const WHO_GIRLS_WEIGHT: { day: number; p3: number; p50: number; p97: number }[] =
  [
    { day: 0, p3: 2400, p50: 3200, p97: 4200 },
    { day: 3, p3: 2230, p50: 2975, p97: 3910 },
    { day: 5, p3: 2275, p50: 3040, p97: 3990 },
    { day: 7, p3: 2330, p50: 3100, p97: 4070 },
    { day: 10, p3: 2400, p50: 3180, p97: 4180 },
    { day: 14, p3: 2500, p50: 3280, p97: 4300 },
    { day: 21, p3: 2900, p50: 3700, p97: 4800 },
    { day: 30, p3: 3500, p50: 4400, p97: 5500 },
    { day: 60, p3: 4500, p50: 5400, p97: 6600 },
    { day: 90, p3: 5200, p50: 6100, p97: 7400 },
    { day: 120, p3: 5700, p50: 6700, p97: 8000 },
    { day: 150, p3: 6100, p50: 7100, p97: 8500 },
    { day: 180, p3: 6500, p50: 7500, p97: 9000 },
    { day: 240, p3: 7000, p50: 8100, p97: 9800 },
    { day: 300, p3: 7500, p50: 8700, p97: 10500 },
    { day: 365, p3: 7900, p50: 9200, p97: 11100 },
    { day: 545, p3: 8900, p50: 10500, p97: 12700 },
    { day: 730, p3: 9800, p50: 11500, p97: 14000 },
  ];

function interp(
  day: number,
  key: "p3" | "p50" | "p97",
): number {
  if (day <= WHO_GIRLS_WEIGHT[0]!.day) return WHO_GIRLS_WEIGHT[0]![key];
  const last = WHO_GIRLS_WEIGHT[WHO_GIRLS_WEIGHT.length - 1]!;
  if (day >= last.day) return last[key];
  for (let i = 0; i < WHO_GIRLS_WEIGHT.length - 1; i++) {
    const a = WHO_GIRLS_WEIGHT[i]!;
    const b = WHO_GIRLS_WEIGHT[i + 1]!;
    if (day >= a.day && day <= b.day) {
      const t = (day - a.day) / (b.day - a.day);
      return a[key] + (b[key] - a[key]) * t;
    }
  }
  return last[key];
}

export function weightPercentileGrams(
  dayOfLife: number,
  percentile: 3 | 50 | 97,
): number {
  const key = percentile === 3 ? "p3" : percentile === 50 ? "p50" : "p97";
  return interp(Math.max(0, dayOfLife), key);
}

// Age buckets for daily-rate norms.
function ageBucketDays(days: number): "newborn" | "1to3mo" | "3to6mo" | "6to12mo" | "over12mo" {
  if (days < 29) return "newborn";
  if (days < 91) return "1to3mo";
  if (days < 181) return "3to6mo";
  if (days < 366) return "6to12mo";
  return "over12mo";
}

export function dailySleepNorm(ageDays: number): Range {
  // Total hours of sleep per 24h.
  switch (ageBucketDays(ageDays)) {
    case "newborn":
      return { min: 14, max: 17 };
    case "1to3mo":
      return { min: 14, max: 16 };
    case "3to6mo":
      return { min: 13, max: 15 };
    case "6to12mo":
      return { min: 12, max: 15 };
    default:
      return { min: 11, max: 14 };
  }
}

export function wetDiaperMinPerDay(ageDays: number): number {
  // Only a floor — the clinically meaningful threshold is "too few wet diapers."
  switch (ageBucketDays(ageDays)) {
    case "newborn":
      return 6;
    case "1to3mo":
      return 5;
    default:
      return 4;
  }
}

export function feedsPerDayRange(ageDays: number): Range {
  switch (ageBucketDays(ageDays)) {
    case "newborn":
      return { min: 8, max: 12 };
    case "1to3mo":
      return { min: 7, max: 9 };
    case "3to6mo":
      return { min: 5, max: 7 };
    case "6to12mo":
      return { min: 4, max: 6 };
    default:
      return { min: 3, max: 5 };
  }
}

// Expected max interval between feeds, in hours. Used to flag unusually long
// gaps on the "Next feed" estimate. Derived from max feeds/day → 24 / max.
export function maxFeedIntervalHours(ageDays: number): number {
  const range = feedsPerDayRange(ageDays);
  return Math.ceil(24 / range.min + 0.5);
}

// Minimum sensible interval between feeds, in hours. Used as a floor when the
// computed median is suspiciously small (e.g. duplicate/clustered sessions).
export function minSensibleFeedIntervalHours(ageDays: number): number {
  const bucket = ageDays < 29 ? "newborn" : ageDays < 91 ? "1to3mo" : "older";
  if (bucket === "newborn") return 1.25;
  if (bucket === "1to3mo") return 1.5;
  return 2;
}

// Suggested awake window between sleeps, in minutes. Wider buckets than the
// other norms because wake-window guidance varies a lot by source — these are
// midpoints of the ranges Huckleberry/Taking Cara Babies publish.
export function wakeWindowMinutes(ageDays: number): Range {
  if (ageDays < 14) return { min: 30, max: 60 };
  if (ageDays < 30) return { min: 45, max: 75 };
  if (ageDays < 60) return { min: 60, max: 90 };
  if (ageDays < 90) return { min: 75, max: 105 };
  if (ageDays < 120) return { min: 90, max: 120 };
  if (ageDays < 180) return { min: 105, max: 150 };
  if (ageDays < 270) return { min: 150, max: 210 };
  if (ageDays < 365) return { min: 180, max: 240 };
  return { min: 240, max: 300 };
}
