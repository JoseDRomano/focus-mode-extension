// Usage stats and bypass history, kept in storage.local (per device).
import { dayKey } from "./settings.js";

const KEEP_DAYS = 30;
const HISTORY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (ts) => new Date(ts).setHours(0, 0, 0, 0);

// Updates today's entry of a per-day counter and drops entries past KEEP_DAYS.
async function bumpToday(key, update) {
  const { [key]: byDay = {} } = await chrome.storage.local.get(key);
  const today = dayKey();
  byDay[today] = update(byDay[today]);
  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * DAY_MS));
  const kept = Object.fromEntries(Object.entries(byDay).filter(([day]) => day >= cutoff));
  await chrome.storage.local.set({ [key]: kept });
}

export const recordAttempt = (site) =>
  bumpToday("attempts", (counts = {}) => ({ ...counts, [site]: (counts[site] ?? 0) + 1 }));

export const recordFocusMinute = () => bumpToday("focusMinutes", (n = 0) => n + 1);

// Bypass history: every confirmed attempt to weaken blocking, newest first.

export async function getHistory() {
  const { bypasses = [] } = await chrome.storage.local.get("bypasses");
  return bypasses;
}

export async function logBypass(action, denied = false) {
  const bypasses = [{ at: Date.now(), action, denied }, ...(await getHistory())].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ bypasses });
  return bypasses;
}

export function attemptsToday(bypasses) {
  const today = dayKey();
  return bypasses.filter((b) => dayKey(new Date(b.at)) === today).length;
}

export async function getStats() {
  const { attempts = {}, focusMinutes = {}, installedAt = Date.now() } =
    await chrome.storage.local.get(["attempts", "focusMinutes", "installedAt"]);
  const bypasses = await getHistory();
  const today = dayKey();
  const weekStart = dayKey(new Date(Date.now() - 6 * DAY_MS)); // last 7 days, today included

  const minutesThisWeek = Object.entries(focusMinutes)
    .filter(([day]) => day >= weekStart)
    .reduce((sum, [, n]) => sum + n, 0);

  const siteTotals = {};
  for (const [day, counts] of Object.entries(attempts)) {
    if (day < weekStart) continue;
    for (const [site, n] of Object.entries(counts)) siteTotals[site] = (siteTotals[site] ?? 0) + n;
  }

  const lastBypass = bypasses.find((b) => !b.denied)?.at ?? installedAt;

  return {
    focusHoursThisWeek: minutesThisWeek / 60,
    blockedToday: Object.values(attempts[today] ?? {}).reduce((a, b) => a + b, 0),
    // Full days since the last successful bypass (or since install).
    cleanStreak: Math.round((startOfDay(Date.now()) - startOfDay(lastBypass)) / DAY_MS),
    topSites: Object.entries(siteTotals).sort((a, b) => b[1] - a[1]).slice(0, 5),
    bypasses,
  };
}
