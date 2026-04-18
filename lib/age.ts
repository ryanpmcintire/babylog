export const LILY_BIRTHDATE = new Date("2026-04-09T02:25:00-05:00");

export function ageInMs(birthdate: Date, now: Date = new Date()): number {
  return Math.max(0, now.getTime() - birthdate.getTime());
}

export function formatBabyAge(birthdate: Date, now: Date = new Date()): string {
  const ms = ageInMs(birthdate, now);

  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(ms / 3600000);
  const totalDays = Math.floor(ms / 86400000);

  if (totalMinutes < 60) {
    if (totalMinutes < 1) return "just born";
    return totalMinutes === 1 ? "1 minute old" : `${totalMinutes} minutes old`;
  }

  if (totalHours < 24) {
    const m = totalMinutes % 60;
    return `${totalHours}h ${m}m old`;
  }

  if (totalDays < 30) {
    const h = totalHours % 24;
    const m = totalMinutes % 60;
    return `${totalDays}d ${h}h ${m}m old`;
  }

  if (totalDays < 365) {
    const weeks = Math.floor(totalDays / 7);
    const extraDays = totalDays % 7;
    if (totalDays < 60) {
      return extraDays === 0
        ? `${weeks} weeks old`
        : `${weeks}w ${extraDays}d old`;
    }
    const months = Math.floor(totalDays / 30.4375);
    return `${months} months old`;
  }

  const years = Math.floor(totalDays / 365.25);
  const extraMonths = Math.floor((totalDays - years * 365.25) / 30.4375);
  return extraMonths === 0 ? `${years}y old` : `${years}y ${extraMonths}m old`;
}
