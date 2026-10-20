// Shared by the per-site cleanups. Mirrors the user's cleanup toggles and the
// current path onto <html> as data-fm-* attributes, which each site's CSS keys
// off. Site scripts loaded after this one can react via onCleanupChange().

const cleanupListeners = [];

function onCleanupChange(listener) {
  cleanupListeners.push(listener);
}

(async () => {
  const root = document.documentElement;
  const { getSettings } = await import(chrome.runtime.getURL("settings.js"));
  let options = {};
  let path = null;

  function apply() {
    path = location.pathname;
    root.setAttribute("data-fm-path", path);
    for (const [key, on] of Object.entries(options)) root.toggleAttribute(`data-fm-${key.toLowerCase()}`, on);
    cleanupListeners.forEach((listener) => listener(options, path));
  }

  async function reload() {
    options = (await getSettings()).cleanup;
    apply();
  }

  await reload();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.cleanup) reload();
  });
  // These sites navigate client-side without a common event, so poll the path.
  setInterval(() => {
    if (location.pathname !== path) apply();
  }, 300);
})();
