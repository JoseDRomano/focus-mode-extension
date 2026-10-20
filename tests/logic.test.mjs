// Logic tests for the shared modules. Run with: node tests/logic.test.mjs
import assert from "node:assert/strict";

// Minimal fake of chrome.storage for the modules under test.
const stores = { sync: {}, local: {} };
const area = (name) => ({
  async get(keys) {
    const s = stores[name];
    if (keys === null) return structuredClone(s);
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in s).map((k) => [k, structuredClone(s[k])]));
  },
  async set(obj) { Object.assign(stores[name], structuredClone(obj)); },
});
globalThis.chrome = { storage: { sync: area("sync"), local: area("local") } };

const S = await import("../src/shared/settings.js");
const T = await import("../src/shared/stats.js");
let pass = 0;
const test = async (name, fn) => { await fn(); pass++; console.log("ok -", name); };

const at = (iso) => new Date(iso);
const sched = (byDay) => S.DAY_NAMES.map((_, d) => byDay[d] ?? []);

await test("defaults: Mon-Fri 9-17, YouTube+LinkedIn, shorts+feed cleanup on", async () => {
  const s = await S.getSettings();
  assert.equal(S.describeSchedule(s.schedule), "Mon–Fri 09:00–17:00");
  assert.deepEqual(s.sites, ["youtube.com", "youtu.be", "linkedin.com"]);
  assert.equal(s.cleanup.youtubeShorts, true);
  assert.equal(s.cleanup.linkedinFeed, true);
  assert.equal(s.cleanup.xHome, false);
});

await test("migrates old start/end/days settings", async () => {
  stores.sync = { start: "10:00", end: "16:00", days: [1, 3], cleanup: { xHome: true } };
  const s = await S.getSettings();
  assert.equal(S.describeSchedule(s.schedule), "Mon, Wed 10:00–16:00");
  assert.equal(s.cleanup.xHome, true);
  assert.equal(s.cleanup.youtubeShorts, true, "new cleanup keys get defaults");
  stores.sync = {};
});

await test("activeRange with a split day", async () => {
  const s = { schedule: sched({ 2: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] }) };
  // 2026-10-20 is a Tuesday
  assert.equal(S.activeRange(s, at("2026-10-20T10:00"))?.end, "12:00");
  assert.equal(S.activeRange(s, at("2026-10-20T12:30")), null);
  assert.equal(S.activeRange(s, at("2026-10-20T13:00"))?.end, "17:00");
  assert.equal(S.activeRange(s, at("2026-10-20T17:00")), null);
  assert.equal(S.activeRange(s, at("2026-10-21T10:00")), null);
  assert.equal(S.formatTime(S.todaysEnd(s, at("2026-10-20T08:00"))), "17:00");
});

await test("scheduleShrinks detects any lost minute, ignores additions", async () => {
  const base = sched({ 1: [{ start: "09:00", end: "17:00" }] });
  assert.equal(S.scheduleShrinks(base, sched({ 1: [{ start: "08:00", end: "18:00" }] })), false);
  assert.equal(S.scheduleShrinks(base, sched({ 1: [{ start: "09:00", end: "17:00" }], 6: [{ start: "10:00", end: "11:00" }] })), false);
  assert.equal(S.scheduleShrinks(base, sched({ 1: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] })), true);
  assert.equal(S.scheduleShrinks(base, sched({ 1: [{ start: "09:01", end: "17:00" }] })), true);
  assert.equal(S.scheduleShrinks(base, sched({})), true);
});

await test("describeSchedule groups days and runs", async () => {
  const nine = [{ start: "09:00", end: "17:00" }];
  assert.equal(S.describeSchedule(sched({ 1: nine, 2: nine, 3: nine, 5: nine, 6: [{ start: "10:00", end: "12:00" }] })),
    "Mon–Wed, Fri 09:00–17:00; Sat 10:00–12:00");
  assert.equal(S.describeSchedule(sched({ 0: nine, 6: nine })), "Sat, Sun 09:00–17:00");
  assert.equal(S.describeSchedule(sched({})), "No work hours");
});

await test("getStatus: blocking, break, off", async () => {
  const s = { schedule: sched({ 2: [{ start: "09:00", end: "17:00" }] }) };
  const now = at("2026-10-20T10:00");
  stores.local = {};
  let st = await S.getStatus(s, now);
  assert.equal(st.state, "blocking");
  assert.equal(S.formatTime(st.until), "17:00");
  stores.local.breakUntil = now.getTime() + 5 * 60000;
  st = await S.getStatus(s, now);
  assert.equal(st.state, "break");
  assert.equal(S.formatTime(st.until), "10:05");
  // A break never extends past the end of work hours.
  stores.local.breakUntil = at("2026-10-20T17:30").getTime();
  assert.equal(S.formatTime((await S.getStatus(s, at("2026-10-20T16:58"))).until), "17:00");
  assert.equal((await S.getStatus(s, at("2026-10-20T18:00"))).state, "off");
  stores.local = {};
});

await test("normalizeSite", async () => {
  assert.equal(S.normalizeSite("https://www.Reddit.com/r/x?y=1"), "reddit.com");
  assert.equal(S.normalizeSite("localhost"), null);
  assert.equal(S.sitePattern("reddit.com"), "*://*.reddit.com/*");
});

await test("stats: attempts, focus minutes, top sites, streak, destiny attempts", async () => {
  stores.local = { installedAt: Date.now() - 10 * 864e5 };
  for (let i = 0; i < 3; i++) await T.recordAttempt("youtube.com");
  await T.recordAttempt("reddit.com");
  for (let i = 0; i < 90; i++) await T.recordFocusMinute();
  let st = await T.getStats();
  assert.equal(st.blockedToday, 4);
  assert.equal(st.focusHoursThisWeek, 1.5);
  assert.deepEqual(st.topSites, [["youtube.com", 3], ["reddit.com", 1]]);
  assert.equal(st.cleanStreak, 10);

  await T.logBypass("Removed x.com", true); // denied: doesn't break the streak
  assert.equal((await T.getStats()).cleanStreak, 10);
  assert.equal(T.attemptsToday(await T.getHistory()), 1);
  await T.logBypass("Removed x.com");
  st = await T.getStats();
  assert.equal(st.cleanStreak, 0);
  assert.equal(T.attemptsToday(st.bypasses), 2);
});

await test("stats: old daily entries are pruned after 30 days", async () => {
  stores.local = { attempts: { "2020-01-01": { "a.com": 1 } } };
  await T.recordAttempt("b.com");
  assert.deepEqual(Object.keys(stores.local.attempts), [S.dayKey()]);
});

await test("matchSite: subdomains match, lookalikes and other schemes don't", async () => {
  const sites = ["youtube.com", "youtu.be", "linkedin.com"];
  assert.equal(S.matchSite(sites, "https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(S.matchSite(sites, "https://m.youtube.com/"), "youtube.com");
  assert.equal(S.matchSite(sites, "https://youtu.be/abc"), "youtu.be");
  assert.equal(S.matchSite(sites, "https://www.linkedin.com/feed/"), "linkedin.com");
  assert.equal(S.matchSite(sites, "https://notyoutube.com/"), null);
  assert.equal(S.matchSite(sites, "https://youtube.com.evil.io/"), null);
  assert.equal(S.matchSite(sites, "chrome-extension://abc/blocked.html?site=youtube.com"), null);
  assert.equal(S.matchSite(sites, "chrome://newtab/"), null);
  assert.equal(S.matchSite(sites, "not a url"), null);
});

console.log(`\n${pass} tests passed`);
