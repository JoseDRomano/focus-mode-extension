import {
  CLEANUP_OPTIONS, dayKey, describeSchedule, formatTime, getBreakState, getSettings,
  getStatus, normalizeSite, scheduleShrinks, todaysEnd,
} from "../shared/settings.js";
import { attemptsToday, getHistory, getStats, logBypass } from "../shared/stats.js";
import { buildCleanupToggles, createScheduleEditor, renderSiteList } from "../shared/ui.js";

const BYPASS_SENTENCE = "I am choosing to be distracted instead of doing my work.";
// Chance the wheel refuses a bypass: 1st, 2nd, then every later attempt today.
const DESTINY_ODDS = [0.5, 0.7, 0.9];
const SPIN_MS = matchMedia("(prefers-reduced-motion: reduce)").matches ? 600 : 3200;

const settings = await getSettings();

const isLocked = () => Date.now() < settings.lockUntil;

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function save(changes) {
  await chrome.storage.sync.set(changes);
  Object.assign(settings, changes);
}

// Opens a <form method="dialog"> dialog; resolves with its returnValue on close.
function showDialog(dialog) {
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
}

// Panels: Stats is home. The cog opens the settings tabs, the padlock opens
// the lock panel; pressing either again goes back.

const SETTINGS_TABS = ["schedule", "sites", "cleanup"];
const tabBar = document.querySelector(".tabs");
const tabs = document.querySelectorAll("[role=tab]");
const panels = document.querySelectorAll("[role=tabpanel]");
const settingsToggle = document.getElementById("settings-toggle");
const lockToggle = document.getElementById("lock-toggle");
let current = "stats";
let beforeLock = "stats";
let lastSettingsTab = "schedule";

function showPanel(name) {
  const inSettings = SETTINGS_TABS.includes(name);
  current = name;
  if (name !== "lock") beforeLock = name;
  if (inSettings) lastSettingsTab = name;

  panels.forEach((p) => { p.hidden = p.id !== name; });
  tabBar.hidden = !inSettings;
  tabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
  settingsToggle.setAttribute("aria-pressed", inSettings);
  lockToggle.setAttribute("aria-pressed", name === "lock");
}

tabs.forEach((tab) => tab.addEventListener("click", () => showPanel(tab.dataset.tab)));
settingsToggle.addEventListener("click", () => {
  showPanel(SETTINGS_TABS.includes(current) ? "stats" : lastSettingsTab);
});
lockToggle.addEventListener("click", () => {
  showPanel(current === "lock" ? beforeLock : "lock");
});

// Status and breaks

const statusCard = document.getElementById("status-card");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const breakButton = document.getElementById("break-button");

async function renderStatus() {
  const status = await getStatus(settings);
  const { usedToday } = await getBreakState();
  const breaksLeft = Math.max(0, settings.breaksPerDay - usedToday);
  statusCard.dataset.state = status.state;
  breakButton.hidden = true;

  if (status.state === "blocking") {
    statusTitle.textContent = `Blocking until ${formatTime(status.until)}`;
    statusDetail.textContent = settings.breaksPerDay === 0
      ? "Breaks are turned off."
      : `${breaksLeft} of ${settings.breaksPerDay} breaks left today`;
    if (breaksLeft > 0) {
      breakButton.hidden = false;
      breakButton.textContent = `Take a ${settings.breakMinutes}-min break`;
      breakButton.dataset.action = "start";
    }
  } else if (status.state === "break") {
    const minutesLeft = Math.max(1, Math.ceil((status.until - Date.now()) / 60000));
    statusTitle.textContent = `On a break, ${minutesLeft} min left`;
    statusDetail.textContent = `Blocking resumes at ${formatTime(status.until)}.`;
    breakButton.hidden = false;
    breakButton.textContent = "End break";
    breakButton.dataset.action = "end";
  } else {
    statusTitle.textContent = "Outside work hours";
    statusDetail.textContent = "Sites aren't blocked right now.";
  }
}

breakButton.addEventListener("click", async () => {
  if (breakButton.dataset.action === "end") {
    await chrome.storage.local.set({ breakUntil: 0 });
  } else {
    const { usedToday } = await getBreakState();
    if (usedToday >= settings.breaksPerDay) return;
    await chrome.storage.local.set({
      breakUntil: Date.now() + settings.breakMinutes * 60000,
      breaksUsed: { date: dayKey(), count: usedToday + 1 },
    });
  }
  renderStatus();
});

setInterval(renderStatus, 10000);

// Stats

const historyList = document.getElementById("history-list");
const topSites = document.getElementById("top-sites");

function emptyItem(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  return li;
}

async function renderStats() {
  const stats = await getStats();
  const hours = stats.focusHoursThisWeek;
  document.getElementById("stat-focus").textContent = hours < 10 ? hours.toFixed(1) : Math.round(hours);
  document.getElementById("stat-streak").textContent = stats.cleanStreak;
  document.getElementById("stat-blocked").textContent = stats.blockedToday;

  if (stats.topSites.length === 0) {
    topSites.replaceChildren(emptyItem("Nothing blocked in the last 7 days."));
  } else {
    const max = stats.topSites[0][1];
    topSites.replaceChildren(...stats.topSites.map(([site, count]) => {
      const li = document.createElement("li");
      li.title = `${site}: ${count} blocked ${count === 1 ? "visit" : "visits"}`;
      const name = document.createElement("span");
      name.className = "bar-name";
      name.textContent = site;
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${(count / max) * 100}%`;
      const value = document.createElement("span");
      value.className = "bar-value";
      value.textContent = count;
      li.append(name, bar, value);
      return li;
    }));
  }

  if (stats.bypasses.length === 0) {
    historyList.replaceChildren(emptyItem("No bypasses yet. Keep it up."));
    return;
  }
  historyList.replaceChildren(...stats.bypasses.map(({ at, action, denied }) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const what = document.createElement("span");
    what.textContent = denied ? `${action} (stopped by destiny)` : action;
    const when = document.createElement("time");
    when.textContent = formatDate(at);
    li.append(what, when);
    return li;
  }));
}

// Bypass confirmation and the wheel of destiny

const bypassDialog = document.getElementById("bypass-dialog");
const bypassAction = document.getElementById("bypass-action");
const bypassInput = document.getElementById("bypass-input");
const bypassConfirm = document.getElementById("bypass-confirm");

document.getElementById("bypass-sentence").textContent = BYPASS_SENTENCE;
document.getElementById("bypass-cancel").addEventListener("click", () => bypassDialog.close());

// The sentence has to be typed out by hand.
bypassInput.addEventListener("paste", (e) => e.preventDefault());
bypassInput.addEventListener("drop", (e) => e.preventDefault());
bypassInput.addEventListener("input", () => {
  bypassConfirm.disabled = bypassInput.value.trim() !== BYPASS_SENTENCE;
});

async function confirmBypass(action) {
  bypassAction.textContent = action;
  bypassInput.value = "";
  bypassConfirm.disabled = true;
  return (await showDialog(bypassDialog)) === "confirm";
}

const destinyDialog = document.getElementById("destiny-dialog");
const destinyTitle = document.getElementById("destiny-title");
const destinyResult = document.getElementById("destiny-result");
const destinyMessage = document.getElementById("destiny-message");
const destinyOk = document.getElementById("destiny-ok");
const wheel = document.getElementById("wheel");
let spinning = false;

const oddsFor = (attempt) => DESTINY_ODDS[Math.min(attempt, DESTINY_ODDS.length - 1)];
const percent = (p) => `${Math.round(p * 100)}%`;

destinyOk.addEventListener("click", () => destinyDialog.close());
destinyDialog.addEventListener("cancel", (e) => {
  if (spinning) e.preventDefault();
});

// Spins the wheel; resolves true if destiny lets the bypass through.
async function spinDestiny() {
  const attempt = attemptsToday(await getHistory());
  const odds = oddsFor(attempt);
  const denied = Math.random() < odds;

  document.getElementById("odds-focus").textContent = percent(odds);
  document.getElementById("odds-free").textContent = percent(1 - odds);
  destinyTitle.textContent = "Spinning the wheel of destiny…";
  destinyResult.hidden = true;
  wheel.style.setProperty("--focus", percent(odds));
  wheel.style.transition = "none";
  wheel.style.transform = "rotate(0deg)";
  destinyDialog.showModal();
  wheel.getBoundingClientRect(); // apply the reset before spinning

  // The "Back to work" slice runs clockwise from the top over odds × 360°.
  // Land somewhere inside the outcome's slice, then rotate it under the pointer.
  const focusDeg = odds * 360;
  const margin = 10;
  const [from, to] = denied ? [margin, focusDeg - margin] : [focusDeg + margin, 360 - margin];
  const landing = from + Math.random() * (to - from);
  wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
  wheel.style.transform = `rotate(${5 * 360 - landing}deg)`;

  spinning = true;
  await new Promise((resolve) => setTimeout(resolve, SPIN_MS));
  spinning = false;

  const next = `Next try today: ${percent(oddsFor(attempt + 1))} chance of staying focused.`;
  if (denied) {
    destinyTitle.textContent = "Destiny chose not to let you unfocus.";
    destinyMessage.textContent = `Wanna reconsider? ${next}`;
    destinyOk.textContent = "Back to work";
  } else {
    destinyTitle.textContent = "Destiny lets you through.";
    destinyMessage.textContent = `This time. ${next}`;
    destinyOk.textContent = "Continue";
  }
  destinyResult.hidden = false;
  destinyOk.focus();
  await new Promise((resolve) => destinyDialog.addEventListener("close", resolve, { once: true }));
  return !denied;
}

// Gate for any change that weakens blocking: refused while locked, otherwise
// requires the typed sentence and a spin of the wheel, and is logged either way.
async function allowWeakening(action, showError) {
  if (isLocked()) {
    showError(`Locked until ${formatDate(settings.lockUntil)}.`);
    return false;
  }
  if (!(await confirmBypass(action))) return false;
  const allowed = await spinDestiny();
  await logBypass(action, !allowed);
  renderStats();
  return allowed;
}

// Schedule

const scheduleForm = document.getElementById("schedule-form");
const scheduleNotice = document.getElementById("schedule-notice");
const breaksPerDayInput = document.getElementById("breaks-per-day");
const breakMinutesInput = document.getElementById("break-minutes");
const saveStatus = document.getElementById("save-status");

const scheduleEditor = createScheduleEditor(document.getElementById("schedule-editor"), settings.schedule);
breaksPerDayInput.value = settings.breaksPerDay;
breakMinutesInput.value = settings.breakMinutes;

function showSaveStatus(text, isError = false) {
  saveStatus.textContent = text;
  saveStatus.className = isError ? "error" : "";
}

scheduleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { schedule, error } = scheduleEditor.read();
  if (error) {
    showSaveStatus(error, true);
    return;
  }
  const breaksPerDay = Number(breaksPerDayInput.value);
  const breakMinutes = Number(breakMinutesInput.value);

  const loosened = [];
  if (scheduleShrinks(settings.schedule, schedule)) {
    loosened.push(`Reduced schedule to ${describeSchedule(schedule)}`);
  }
  if (breaksPerDay > settings.breaksPerDay || breakMinutes > settings.breakMinutes) {
    loosened.push(`Allowed ${breaksPerDay} breaks of ${breakMinutes} min`);
  }
  if (loosened.length > 0) {
    const allowed = await allowWeakening(loosened.join("; "), (msg) => showSaveStatus(msg, true));
    if (!allowed) return;
  }

  await save({ schedule, breaksPerDay, breakMinutes });
  showSaveStatus("Saved.");
  renderStatus();
});

// Blocked sites

const siteForm = document.getElementById("site-form");
const sitesNotice = document.getElementById("sites-notice");
const siteInput = document.getElementById("site-input");
const siteError = document.getElementById("site-error");
const siteList = document.getElementById("site-list");

async function removeSite(site) {
  const showError = (msg) => { siteError.textContent = msg; };
  if (!(await allowWeakening(`Removed ${site}`, showError))) return;
  await save({ sites: settings.sites.filter((s) => s !== site) });
  renderSites();
}

function renderSites() {
  renderSiteList(siteList, settings.sites, { onRemove: isLocked() ? null : removeSite });
}

siteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const site = normalizeSite(siteInput.value.trim());
  if (!site) {
    siteError.textContent = "Enter a valid site, e.g. reddit.com";
    return;
  }
  if (settings.sites.includes(site)) {
    siteError.textContent = `${site} is already blocked.`;
    return;
  }
  siteError.textContent = "";
  siteInput.value = "";
  await save({ sites: [...settings.sites, site] });
  renderSites();
});

// Cleanup

const cleanupNotice = document.getElementById("cleanup-notice");
const cleanupError = document.getElementById("cleanup-error");

buildCleanupToggles(document.getElementById("cleanup-toggles"), settings.cleanup, async (key, on) => {
  if (!on) {
    const option = CLEANUP_OPTIONS.find((o) => o.key === key);
    const showError = (msg) => { cleanupError.textContent = msg; };
    if (!(await allowWeakening(`Turned off "${option.label}" on ${option.site}`, showError))) return false;
  }
  cleanupError.textContent = "";
  await save({ cleanup: { ...settings.cleanup, [key]: on } });
  return true;
});

// Lock

const lockForm = document.getElementById("lock-form");
const lockStatus = document.getElementById("lock-status");
const lockInput = document.getElementById("lock-input");
const lockButton = document.getElementById("lock-button");
const lockError = document.getElementById("lock-error");
const lockDialog = document.getElementById("lock-dialog");
const lockDialogText = document.getElementById("lock-dialog-text");

document.getElementById("lock-cancel").addEventListener("click", () => lockDialog.close());

// datetime-local wants "YYYY-MM-DDTHH:MM" in local time.
function toInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderLock() {
  const locked = isLocked();
  const until = formatDate(settings.lockUntil);

  lockStatus.textContent = locked ? `Locked until ${until}.` : "Settings are unlocked.";
  lockButton.textContent = locked ? "Extend lock" : "Lock";
  lockToggle.classList.toggle("locked", locked);
  lockToggle.title = locked ? `Locked until ${until}` : "Lock settings";
  lockToggle.setAttribute("aria-label", lockToggle.title);
  lockInput.min = toInputValue(new Date(locked ? settings.lockUntil : Date.now()));

  const notices = [
    [scheduleNotice, "You can extend your hours but not reduce them."],
    [sitesNotice, "You can add sites but not remove them."],
    [cleanupNotice, "You can turn cleanups on but not off."],
  ];
  for (const [notice, text] of notices) {
    notice.hidden = !locked;
    notice.textContent = `Locked until ${until}. ${text}`;
  }

  renderSites();
}

lockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const until = new Date(lockInput.value).getTime();
  const locked = isLocked();
  if (Number.isNaN(until)) {
    lockError.textContent = "Pick a date and time.";
    return;
  }
  if (until <= (locked ? settings.lockUntil : Date.now())) {
    lockError.textContent = locked ? "Pick a time after the current lock." : "Pick a time in the future.";
    return;
  }
  lockError.textContent = "";
  lockDialogText.textContent = `You won't be able to loosen any settings until ${formatDate(until)}. This can't be undone.`;
  if ((await showDialog(lockDialog)) !== "confirm") return;
  await save({ lockUntil: until });
  renderLock();
});

// Default the lock to the end of today's work hours, if that's still ahead.
const endOfToday = todaysEnd(settings);
if (!isLocked() && endOfToday > Date.now()) lockInput.value = toInputValue(new Date(endOfToday));

renderStatus();
renderLock();
renderStats();
