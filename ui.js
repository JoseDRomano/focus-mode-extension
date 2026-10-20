// DOM building blocks shared by popup.html and setup.html.
import { CLEANUP_OPTIONS, DAY_NAMES, DAY_ORDER, toMinutes } from "./settings.js";

const DEFAULT_RANGE = { start: "09:00", end: "17:00" };
const clone = (ranges) => ranges.map((r) => ({ ...r }));
const sameRanges = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fromMinutes(total) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function fieldset(legendText, className) {
  const fs = document.createElement("fieldset");
  if (className) fs.className = className;
  const legend = document.createElement("legend");
  legend.textContent = legendText;
  fs.append(legend);
  return fs;
}

function chip(text, checked, onChange) {
  const label = document.createElement("label");
  label.className = "chip";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  label.append(box, text);
  return label;
}

function switchRow(text, checked, onChange) {
  const label = document.createElement("label");
  label.className = "switch-row";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked, box));
  label.append(text, box);
  return label;
}

function removeButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove";
  button.textContent = "×";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function linkButton(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function timeInput(value, onInput) {
  const input = document.createElement("input");
  input.type = "time";
  input.value = value;
  input.required = true;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

// Weekly schedule editor. Starts simple (one set of hours for the chosen days);
// splitting the day and setting different hours per day are opt-in.
export function createScheduleEditor(container, schedule) {
  const workDays = DAY_ORDER.filter((d) => schedule[d].length > 0);
  const state = {
    perDay: !workDays.every((d) => sameRanges(schedule[d], schedule[workDays[0]])),
    days: new Set(workDays),
    shared: clone(schedule[workDays[0]] ?? [DEFAULT_RANGE]),
    byDay: schedule.map(clone),
  };

  function rangeRows(ranges) {
    const wrap = document.createElement("div");
    wrap.className = "ranges";
    ranges.forEach((range, i) => {
      const row = document.createElement("div");
      row.className = "range";
      const dash = document.createElement("span");
      dash.textContent = "–";
      row.append(
        timeInput(range.start, (v) => { range.start = v; }),
        dash,
        timeInput(range.end, (v) => { range.end = v; }),
      );
      if (ranges.length > 1) {
        row.append(removeButton("Remove time range", () => {
          ranges.splice(i, 1);
          render();
        }));
      }
      wrap.append(row);
    });
    return wrap;
  }

  // New ranges start an hour after the last one ends, e.g. a lunch gap.
  function addRangeButton(ranges, text) {
    return linkButton(text, () => {
      const start = Math.min(toMinutes(ranges.at(-1)?.end ?? "08:00") + 60, 23 * 60);
      ranges.push({ start: fromMinutes(start), end: fromMinutes(Math.min(start + 4 * 60, 23 * 60 + 59)) });
      render();
    });
  }

  function setPerDay(on) {
    if (on) {
      state.byDay = DAY_NAMES.map((_, d) => (state.days.has(d) ? clone(state.shared) : []));
    } else {
      const first = DAY_ORDER.find((d) => state.byDay[d].length > 0);
      state.days = new Set(DAY_ORDER.filter((d) => state.byDay[d].length > 0));
      state.shared = clone(state.byDay[first] ?? [DEFAULT_RANGE]);
    }
    state.perDay = on;
    render();
  }

  function render() {
    const parts = [];
    if (state.perDay) {
      const byDay = fieldset("Work hours by day");
      for (const d of DAY_ORDER) {
        const row = document.createElement("div");
        row.className = "day-row";
        row.append(chip(DAY_NAMES[d], state.byDay[d].length > 0, (on) => {
          state.byDay[d] = on ? [{ ...DEFAULT_RANGE }] : [];
          render();
        }));
        const hours = document.createElement("div");
        if (state.byDay[d].length > 0) {
          hours.append(rangeRows(state.byDay[d]), addRangeButton(state.byDay[d], "+ Add time range"));
        } else {
          hours.className = "day-off";
          hours.textContent = "Off";
        }
        row.append(hours);
        byDay.append(row);
      }
      parts.push(byDay);
    } else {
      const days = fieldset("Work days", "days");
      DAY_ORDER.forEach((d) => days.append(chip(DAY_NAMES[d], state.days.has(d), (on) => {
        if (on) state.days.add(d);
        else state.days.delete(d);
      })));
      const hours = fieldset("Work hours");
      hours.append(rangeRows(state.shared), addRangeButton(state.shared, "+ Add another time range"));
      parts.push(days, hours);
    }
    parts.push(switchRow("Different hours on different days", state.perDay, setPerDay));
    container.replaceChildren(...parts);
  }

  // Returns { schedule } or { error }.
  function read() {
    const schedule = state.perDay
      ? state.byDay.map(clone)
      : DAY_NAMES.map((_, d) => (state.days.has(d) ? clone(state.shared) : []));
    for (const ranges of schedule) {
      ranges.sort((a, b) => a.start.localeCompare(b.start));
      if (ranges.some((r) => !r.start || !r.end || r.start >= r.end)) {
        return { error: "Each time range must end after it starts." };
      }
      if (ranges.some((r, i) => i > 0 && r.start < ranges[i - 1].end)) {
        return { error: "Time ranges on the same day can't overlap." };
      }
    }
    return { schedule };
  }

  render();
  return { read };
}

// Renders sites as rows; pass onRemove to show a remove button on each row.
export function renderSiteList(list, sites, { onRemove, emptyText = "No sites blocked." } = {}) {
  if (sites.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = emptyText;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...sites.map((site) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = site;
    li.append(name);
    if (onRemove) li.append(removeButton(`Remove ${site}`, () => onRemove(site)));
    return li;
  }));
}

// Cleanup switches grouped by site. onToggle(key, on) may resolve to false to
// put the switch back.
export function buildCleanupToggles(container, values, onToggle) {
  const sites = [...new Set(CLEANUP_OPTIONS.map((o) => o.site))];
  container.replaceChildren(...sites.map((site) => {
    const group = fieldset(site, "cleanup-group");
    for (const option of CLEANUP_OPTIONS.filter((o) => o.site === site)) {
      group.append(switchRow(option.label, values[option.key], async (on, input) => {
        if ((await onToggle(option.key, on)) === false) input.checked = !on;
      }));
    }
    return group;
  }));
}
