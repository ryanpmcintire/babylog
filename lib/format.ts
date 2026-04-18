export function formatElapsed(ms: number, short = false): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return short ? `${m}m` : `${m}m ago`;
  if (h < 10 && !short) return `${h}h ${m}m ago`;
  return short ? `${h}h ${m}m` : `${h}h ${m}m ago`;
}

export function formatLiveElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function mlToOz(ml: number): number {
  return Math.round((ml / 29.5735) * 10) / 10;
}

export function formatVolume(ml: number): string {
  return `${ml} ml (${mlToOz(ml)} oz)`;
}
