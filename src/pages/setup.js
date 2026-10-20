import { DEFAULT_SETTINGS, PRESETS, describeSchedule, getSettings, normalizeSite } from "../shared/settings.js";
import { buildCleanupToggles, createScheduleEditor, renderSiteList } from "../shared/ui.js";

const settings = await getSettings();
const card = document.querySelector(".card");
const progressBar = document.querySelector(".progress");

// The card is as tall as its tallest step, so keep only the steps this visit
// can show: the setup flow or the "already set up" message, then the tour.
const steps = [...document.querySelectorAll(".step")].filter((step) => {
  const { phase } = step.dataset;
  const keep = phase === "tour" || (phase === "already") === settings.setupComplete;
  if (!keep) step.remove();
  return keep;
});
const order = steps.map((s) => s.dataset.step);
let currentIndex = 0;

const tourSteps = steps.filter((s) => s.dataset.phase === "tour");
tourSteps.forEach((step, i) => {
  step.querySelector("[data-tour-label]").textContent = `Quick tour · ${i + 1} of ${tourSteps.length}`;
});

// Puts the user's own break settings into the tour.
function fillTour({ breaksPerDay, breakMinutes }) {
  document.querySelectorAll('[data-fill="breaksPerDay"]').forEach((el) => { el.textContent = breaksPerDay; });
  document.querySelectorAll('[data-fill="breakMinutes"]').forEach((el) => { el.textContent = breakMinutes; });
  if (breaksPerDay === 0) {
    document.getElementById("tour-breaks-lead").textContent =
      "Breaks are off right now. Turn them on anytime in your schedule settings, and "
      + "everything unblocks for a few minutes whenever you take one.";
  }
}

// Step transitions

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";
const SLIDE_PX = reduceMotion ? 0 : 12;
// Timings in ms. The old step fades out fast while the new one comes in just
// behind it. Everything ends by 250ms: enterDelay + enter = 50 + 200. Keep the
// progress fill in setup.html at 0.25s too.
const MOTION = reduceMotion
  ? { exit: 60, enterDelay: 0, enter: 100, reveal: 100, finish: 100 }
  : { exit: 130, enterDelay: 50, enter: 200, reveal: 250, finish: 250 };

// The transition in progress, if any: its animations and the cleanup that
// puts the DOM in its final state.
let active = null;

const stepNamed = (name) => steps.find((s) => s.dataset.step === name);
const visibleStep = () => steps.find((s) => !s.hidden);

// One segment per step of the current phase (setup or tour). Hidden on a
// single-step phase, but it keeps its space so the card doesn't resize.
function setProgress(name) {
  const step = stepNamed(name);
  const phaseSteps = steps.filter((s) => s.dataset.phase === step.dataset.phase);
  progressBar.hidden = phaseSteps.length < 2;
  if (progressBar.children.length !== phaseSteps.length) {
    progressBar.replaceChildren(...phaseSteps.map(() => document.createElement("span")));
  }
  const index = phaseSteps.indexOf(step);
  [...progressBar.children].forEach((bar, i) => bar.classList.toggle("filled", i <= index));
}

function focusHeading(step) {
  const heading = step.querySelector("h1");
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

// Brings a step in, sliding from the side we're heading to (direction 1 =
// forward, -1 = back) or rising on load (0).
//
// Only the step itself is animated, never the elements inside it. Showing
// and hiding a step changes its visibility, which its children inherit, and
// Chrome can leave an animated child stuck on the old value: buttons that
// vanish or stop responding after going back and forth.
function enterStep(step, direction, delay = 0) {
  const from = direction === 0
    ? `translateY(${SLIDE_PX / 2}px)`
    : `translateX(${SLIDE_PX * direction}px)`;
  return [step.animate(
    [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }],
    { duration: MOTION.enter, delay, easing: EASE_OUT, fill: "backwards" },
  )];
}

// Jumps the running transition, if any, to its end state.
function settle() {
  if (!active) return;
  const { animations, cleanup } = active;
  active = null;
  animations.forEach((a) => a.finish());
  cleanup();
}

// Runs animations as one transition; cleanup runs exactly once, whether they
// finish on their own or settle() cuts them short.
function track(animations, cleanup) {
  const transition = { animations, cleanup };
  active = transition;
  Promise.all(animations.map((a) => a.finished)).then(() => {
    if (active !== transition) return;
    active = null;
    cleanup();
  }, () => {});
}

// First paint: the card and its content settle in together.
function revealStep(name) {
  currentIndex = order.indexOf(name);
  steps.forEach((s) => {
    s.hidden = s !== stepNamed(name);
    s.classList.toggle("current", !s.hidden);
  });
  setProgress(name);
  track([
    card.animate(
      [{ opacity: 0, transform: `translateY(${SLIDE_PX / 2}px)` }, { opacity: 1, transform: "none" }],
      { duration: MOTION.reveal, easing: EASE_OUT },
    ),
    ...enterStep(stepNamed(name), 0),
  ], () => {});
}

// Both steps share the same grid cell, so the new one comes in while the old
// one fades. The new step is stacked on top (.current), so clicks always
// land on it.
function transitionTo(name, direction) {
  settle();
  const from = visibleStep();
  const to = stepNamed(name);
  if (from === to) return;
  currentIndex = order.indexOf(name);

  from.classList.remove("current");
  to.classList.add("current");
  to.hidden = false;
  setProgress(name);
  focusHeading(to);

  // Ease-out so the old text drops away immediately instead of lingering
  // over the new step.
  const exit = from.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-SLIDE_PX * direction}px)` }],
    { duration: MOTION.exit, easing: EASE_OUT, fill: "forwards" },
  );
  // Cancel before hiding (same frame, no flash), so a step is never hidden
  // while an animation is attached to it.
  track([exit, ...enterStep(to, direction, MOTION.enterDelay)], () => {
    exit.cancel();
    from.hidden = true;
  });
}

// Navigation, shared by setup and the tour. Steps can register a check that
// must pass before Next, and work to do when they're entered.
const beforeNext = {};
const onEnter = {};

function go(delta) {
  const name = order[currentIndex];
  if (delta > 0 && beforeNext[name] && !beforeNext[name]()) return;
  const target = order[currentIndex + delta];
  if (!target) return;
  onEnter[target]?.();
  transitionTo(target, delta);
}

// Lets the card settle out, then closes the tab.
async function closeSetup() {
  settle();
  await card.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `scale(${reduceMotion ? 1 : 0.98})` }],
    { duration: MOTION.finish, easing: EASE_IN, fill: "forwards" },
  ).finished;
  const tab = await chrome.tabs.getCurrent();
  chrome.tabs.remove(tab.id);
}

document.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => go(1)));
document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => go(-1)));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSetup));

// Setup only runs once, so it can't be used to get around the popup's
// confirmation and lock. The tour can be replayed from here, or opened
// directly with ?tour (the popup's help button).
if (new URLSearchParams(location.search).has("tour")) {
  fillTour(settings);
  revealStep(tourSteps[0].dataset.step);
} else if (settings.setupComplete) {
  fillTour(settings);
  revealStep("already");
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

  beforeNext.schedule = validateSchedule;
  onEnter.done = renderSummary;

  // Saves everything, then continues into the tour.
  document.getElementById("finish").addEventListener("click", async () => {
    const breaks = {
      breaksPerDay: Number(breaksPerDayInput.value),
      breakMinutes: Number(breakMinutesInput.value),
    };
    await chrome.storage.sync.set({
      schedule,
      sites: selectedSites(),
      cleanup,
      ...breaks,
      setupComplete: true,
    });
    fillTour(breaks);
    go(1);
  });

  renderCustom();
  revealStep("welcome");
}
