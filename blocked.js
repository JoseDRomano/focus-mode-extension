import { formatTime, getSettings, getStatus } from "./settings.js";
import { recordAttempt } from "./stats.js";

const params = new URLSearchParams(location.search);
const site = params.get("site");

// Count real attempts only once: drop the flag so a reload doesn't recount.
if (site && params.has("attempt")) {
  await recordAttempt(site);
  history.replaceState(null, "", `?site=${encodeURIComponent(site)}`);
}

const name = site ?? "This site";
const status = await getStatus(await getSettings());
const message = document.getElementById("message");

if (status.state === "blocking") {
  message.textContent = `${name} is blocked until ${formatTime(status.until)}. Back to work!`;
} else {
  // Reached via the back button or a restored tab after blocking ended.
  document.querySelector("h1").textContent = "Focus time is over";
  message.textContent = site ? `You can open ${site} again.` : "Blocked sites are available again.";
  if (site) {
    const link = document.createElement("a");
    link.href = `https://${site}`;
    link.textContent = `Go to ${site}`;
    message.after(link);
  }
}
