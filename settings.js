// Settings and status logic shared by the background worker, the extension
// pages and the cleanup content scripts. Keep this file free of imports: the
// content scripts load it on its own.

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Sites offered as one-click picks during setup.
export const PRESETS = [
  { name: "YouTube", domains: ["youtube.com", "youtu.be"], blocked: true },
  { name: "LinkedIn", domains: ["linkedin.com"], blocked: true },
  { name: "Instagram", domains: ["instagram.com"] },
  { name: "Facebook", domains: ["facebook.com"] },
  { name: "X", domains: ["x.com", "twitter.com"] },
  { name: "Reddit", domains: ["reddit.com"] },
  { name: "TikTok", domains: ["tiktok.com"] },
  { name: "Netflix", domains: ["netflix.com"] },
  { name: "Twitch", domains: ["twitch.tv"] },
];

// Page cleanups applied whenever a site isn't blocked. Each key becomes a
// data-fm-<key lowercased> attribute on <html> that the site's CSS keys off.
export const CLEANUP_OPTIONS = [
  { key: "youtubeShorts", site: "YouTube", label: "Hide Shorts", on: true },
  { key: "youtubeHome", site: "YouTube", label: "Hide home page recommendations" },
  { key: "youtubeRecs", site: "YouTube", label: "Hide suggested videos next to and after videos" },
  { key: "youtubeComments", site: "YouTube", label: "Hide comments" },
  { key: "linkedinFeed", site: "LinkedIn", label: "Hide the feed", on: true },
  { key: "xHome", site: "X", label: "Hide the home timeline" },
  { key: "xTrends", site: "X", label: "Hide trends and who to follow" },
  { key: "redditHome", site: "Reddit", label: "Hide the front page feed" },
  { key: "instagramReels", site: "Instagram", label: "Hide Reels and Explore" },
];

const WORKDAY = [{ start: "09:00", end: "17:00" }];

export const DEFAULT_SETTINGS = {
  // One list of time ranges per weekday, indexed like Date#getDay().
  schedule: DAY_NAMES.map((_, day) => (day >= 1 && day <= 5 ? WORKDAY : [])),
  sites: PRESETS.filter((p) => p.blocked).flatMap((p) => p.domains),
  cleanup: Object.fromEntries(CLEANUP_OPTIONS.map((o) => [o.key, Boolean(o.on)])),
  breaksPerDay: 3,
  breakMinutes: 5,
  lockUntil: 0, // timestamp; weakening changes are refused until then
  setupComplete: false,
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  // Earlier versions stored a single start/end shared by a list of days.
  if (!stored.schedule && stored.start) {
    stored.schedule = DAY_NAMES.map((_, day) =>
      stored.days?.includes(day) ? [{ start: stored.start, end: stored.end }] : []);
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    cleanup: { ...DEFAULT_SETTINGS.cleanup, ...stored.cleanup },
  };
}

// Time helpers

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function atTime(date, hhmm) {
  const d = new Date(date);
  d.setHours(...hhmm.split(":").map(Number), 0, 0);
  return d.getTime();
}

export function formatTime(ts) {
  return new Date(ts).toTimeString().slice(0, 5);
}

// Local calendar date as "YYYY-MM-DD".
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Schedule

const inRange = (minute, r) => minute >= toMinutes(r.start) && minute < toMinutes(r.end);

export function activeRange(settings, now = new Date()) {
  const minute = now.getHours() * 60 + now.getMinutes();
  return settings.schedule[now.getDay()].find((r) => inRange(minute, r)) ?? null;
}

// When today's last work-hours range ends, or null if there's none today.
export function todaysEnd(settings, now = new Date()) {
  const ranges = settings.schedule[now.getDay()];
  if (ranges.length === 0) return null;
  const last = ranges.reduce((a, b) => (toMinutes(b.end) > toMinutes(a.end) ? b : a));
  return atTime(now, last.end);
}

// True if some minute of the week is work time under `before` but not `after`.
export function scheduleShrinks(before, after) {
  return before.some((ranges, day) => {
    for (let m = 0; m < 24 * 60; m++) {
      if (ranges.some((r) => inRange(m, r)) && !after[day].some((r) => inRange(m, r))) return true;
    }
    return false;
  });
}

// "Mon", "Mon, Wed" or "Mon–Fri" for runs of three or more days.
function formatDays(days) {
  const positions = days.map((d) => DAY_ORDER.indexOf(d)).sort((a, b) => a - b);
  const runs = [];
  for (const p of positions) {
    const run = runs.at(-1);
    if (run && p === run.at(-1) + 1) run.push(p);
    else runs.push([p]);
  }
  return runs.flatMap((run) => {
    const names = run.map((p) => DAY_NAMES[DAY_ORDER[p]]);
    return run.length >= 3 ? [`${names[0]}–${names.at(-1)}`] : names;
  }).join(", ");
}

// e.g. "Mon–Fri 09:00–12:00, 13:00–17:00; Sat 10:00–12:00"
export function describeSchedule(schedule) {
  const groups = [];
  for (const day of DAY_ORDER) {
    if (schedule[day].length === 0) continue;
    const hours = schedule[day].map((r) => `${r.start}–${r.end}`).join(", ");
    const group = groups.find((g) => g.hours === hours);
    if (group) group.days.push(day);
    else groups.push({ hours, days: [day] });
  }
  return groups.map((g) => `${formatDays(g.days)} ${g.hours}`).join("; ") || "No work hours";
}

// Breaks and status. Break state lives in storage.local: it's per device.

export async function getBreakState() {
  const { breakUntil = 0, breaksUsed } = await chrome.storage.local.get(["breakUntil", "breaksUsed"]);
  return { breakUntil, usedToday: breaksUsed?.date === dayKey() ? breaksUsed.count : 0 };
}

// What Focus Mode is doing right now: { state: "blocking" | "break", until }
// or { state: "off" } outside work hours.
export async function getStatus(settings, now = new Date()) {
  const range = activeRange(settings, now);
  if (!range) return { state: "off" };
  const rangeEnd = atTime(now, range.end);
  const { breakUntil } = await getBreakState();
  if (breakUntil > now.getTime()) return { state: "break", until: Math.min(breakUntil, rangeEnd) };
  return { state: "blocking", until: rangeEnd };
}

// Sites

// Accepts "reddit.com", "www.reddit.com" or a full URL; returns the bare hostname.
export function normalizeSite(input) {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

// Match pattern covering a site and its subdomains.
export const sitePattern = (site) => `*://*.${site}/*`;

// The entry of `sites` that `url` belongs to (subdomains included), or null.
export function matchSite(sites, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return sites.find((site) => host === site || host.endsWith(`.${site}`)) ?? null;
}
