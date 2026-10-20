import { DEFAULT_SETTINGS, PRESETS, describeSchedule, getSettings, normalizeSite } from "../shared/settings.js";
import { buildCleanupToggles, createScheduleEditor, renderSiteList } from "../shared/ui.js";

const settings = await getSettings();
const steps = [...document.querySelectorAll(".step")];
const progress = [...document.querySelectorAll(".progress span")];

function showStep(name) {
  steps.forEach((s) => { s.hidden = s.dataset.step !== name; });
  const index = steps.findIndex((s) => s.dataset.step === name);
  progress.forEach((bar, i) => bar.classList.toggle("filled", i <= index));
}

// Setup only runs once, so it can't be used to get around the popup's
// confirmation and lock.
if (settings.setupComplete) {
  document.querySelector(".progress").hidden = true;
  showStep("already");
} else {
  initSetup();
}

function initSetup() {
  const scheduleError = document.getElementById("schedule-error");
  const breaksPerDayInput = document.getElementById("breaks-per-day");
  const breakMinutesInput = document.getElementById("break-minutes");
  const presetGrid = document.getElementById("presets");
  const siteForm = document.getElementById("site-form");
  const siteInput = document.getElementById("site-input");
  const siteError = document.getElementById("site-error");
  const customList = document.getElementById("custom-list");

  let schedule = DEFAULT_SETTINGS.schedule;
  let customSites = [];
  const cleanup = { ...DEFAULT_SETTINGS.cleanup };

  // Schedule and breaks

  const scheduleEditor = createScheduleEditor(document.getElementById("schedule-editor"), schedule);
  breaksPerDayInput.value = DEFAULT_SETTINGS.breaksPerDay;
  breakMinutesInput.value = DEFAULT_SETTINGS.breakMinutes;

  function validateSchedule() {
    const result = scheduleEditor.read();
    const breaksOk = breaksPerDayInput.checkValidity() && breakMinutesInput.checkValidity()
      && breaksPerDayInput.value !== "" && breakMinutesInput.value !== "";
    scheduleError.textContent = result.error ?? (breaksOk ? "" : "Breaks must be whole numbers: 0–20 per day, 1–60 minutes.");
    if (scheduleError.textContent) return false;
    schedule = result.schedule;
    return true;
  }

  // Sites

  const presetBoxes = PRESETS.map((preset) => {
    const label = document.createElement("label");
    label.className = "chip";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(preset.blocked);
    const domain = document.createElement("small");
    domain.textContent = preset.domains[0];
    label.append(box, preset.name, domain);
    presetGrid.append(label);
    return { preset, box };
  });

  function selectedSites() {
    const fromPresets = presetBoxes.filter(({ box }) => box.checked).flatMap(({ preset }) => preset.domains);
    return [...new Set([...fromPresets, ...customSites])];
  }

  function renderCustom() {
    customList.hidden = customSites.length === 0;
    renderSiteList(customList, customSites, {
      onRemove: (site) => {
        customSites = customSites.filter((s) => s !== site);
        renderCustom();
      },
    });
  }

  siteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const site = normalizeSite(siteInput.value.trim());
    if (!site) {
      siteError.textContent = "Enter a valid site, e.g. reddit.com";
      return;
    }

    siteError.textContent = "";
    siteInput.value = "";

    // Typing a popular site just ticks its tile.
    const match = presetBoxes.find(({ preset }) => preset.domains.includes(site));
    if (match) {
      match.box.checked = true;
      return;
    }
    if (!customSites.includes(site)) customSites = [...customSites, site];
    renderCustom();
  });

  // Cleanup

  buildCleanupToggles(document.getElementById("cleanup-toggles"), cleanup, (key, on) => {
    cleanup[key] = on;
  });

  // Summary

  function renderSummary() {
    const sites = selectedSites();
    const cleanups = Object.values(cleanup).filter(Boolean).length;
    const breaks = Number(breaksPerDayInput.value);
    document.getElementById("summary-hours").textContent = describeSchedule(schedule);
    document.getElementById("summary-breaks").textContent = breaks === 0
      ? "None"
      : `${breaks} × ${breakMinutesInput.value} min a day`;
    document.getElementById("summary-sites").textContent = sites.length
      ? `${sites.length} ${sites.length === 1 ? "site" : "sites"}`
      : "Nothing yet";
    document.getElementById("summary-cleanup").textContent = cleanups ? `${cleanups} on` : "None";
  }

  // Navigation

  const order = ["welcome", "schedule", "sites", "cleanup", "done"];
  let current = 0;

  function go(delta) {
    if (delta > 0 && order[current] === "schedule" && !validateSchedule()) return;
    current += delta;
    if (order[current] === "done") renderSummary();
    showStep(order[current]);
    window.scrollTo(0, 0);
  }

  document.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => go(1)));
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => go(-1)));

  document.getElementById("finish").addEventListener("click", async () => {
    await chrome.storage.sync.set({
      schedule,
      sites: selectedSites(),
      cleanup,
      breaksPerDay: Number(breaksPerDayInput.value),
      breakMinutes: Number(breakMinutesInput.value),
      setupComplete: true,
    });
    const tab = await chrome.tabs.getCurrent();
    chrome.tabs.remove(tab.id);
  });

  renderCustom();
  showStep("welcome");
}
