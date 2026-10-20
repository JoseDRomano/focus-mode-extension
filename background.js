import { formatTime, getSettings, getStatus, matchSite, sitePattern } from "./settings.js";
import { recordFocusMinute } from "./stats.js";

const CHECK_ALARM = "focus-check";
const BREAK_ALARM = "break-end";

const blockedPath = (site, attempt) =>
  `/blocked.html?site=${encodeURIComponent(site)}${attempt ? "&attempt=1" : ""}`;

// One rule per site so the blocked page knows which site was tried.
function buildRules(sites) {
  return sites.map((site, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: blockedPath(site, true) } },
    condition: { requestDomains: [site], resourceTypes: ["main_frame"] },
  }));
}

async function redirectOpenTabs(sites) {
  for (const site of sites) {
    const tabs = await chrome.tabs.query({ url: sitePattern(site) });
    const url = chrome.runtime.getURL(blockedPath(site, false));
    await Promise.all(tabs.map((tab) => chrome.tabs.update(tab.id, { url })));
  }
}

function formatLeft(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}

async function updateBadge(status) {
  if (status.state === "off") {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Focus Mode: outside work hours" });
    return;
  }
  const onBreak = status.state === "break";
  await chrome.action.setBadgeText({ text: formatLeft(status.until - Date.now()) });
  await chrome.action.setBadgeBackgroundColor({ color: onBreak ? "#6b6b6b" : "#000000" });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setTitle({
    title: onBreak
      ? `Focus Mode: on a break until ${formatTime(status.until)}`
      : `Focus Mode: blocking until ${formatTime(status.until)}`,
  });
}

// Rebuilt on every check so edits to the site list apply immediately.
// Returns whether sites are being blocked right now.
async function applyState() {
  const settings = await getSettings();
  const status = await getStatus(settings);
  const blocking = status.state === "blocking" && settings.sites.length > 0;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: blocking ? buildRules(settings.sites) : [],
  });
  if (blocking) await redirectOpenTabs(settings.sites);
  if (status.state === "break") chrome.alarms.create(BREAK_ALARM, { when: status.until });
  await updateBadge(status);
  return blocking;
}

// Serialized so overlapping triggers can't race on the rule IDs.
let pending = Promise.resolve();
function update() {
  pending = pending.then(applyState).catch((err) => {
    console.error(err);
    return false;
  });
  return pending;
}

function scheduleChecks() {
  // Align to the start of the next minute so blocking flips on time.
  const nextMinute = Math.ceil(Date.now() / 60000) * 60000;
  chrome.alarms.create(CHECK_ALARM, { when: nextMinute, periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  scheduleChecks();
  update();
  if (reason === "install") {
    await chrome.storage.local.set({ installedAt: Date.now() });
    chrome.tabs.create({ url: "setup.html" });
  }
});

chrome.runtime.onStartup.addListener(() => {
  scheduleChecks();
  update();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const blocking = await update();
  if (alarm.name === CHECK_ALARM && blocking) await recordFocusMinute();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" || "breakUntil" in changes) update();
});

// Backstop for navigations the block rules can't redirect, such as shortcuts
// on Chrome's New Tab page (extensions get no access to chrome:// initiators).
// `url` only changes once a navigation commits, and redirected navigations
// commit as blocked.html, so each visit is counted once.
chrome.tabs.onUpdated.addListener(async (tabId, { url }) => {
  if (!url) return;
  const settings = await getSettings();
  const site = matchSite(settings.sites, url);
  if (!site || (await getStatus(settings)).state !== "blocking") return;
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL(blockedPath(site, true)) });
});
