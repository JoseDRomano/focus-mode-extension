<img src="icons/icon-128.png" width="72" alt="Focus Mode icon">

# Focus Mode

A Chrome extension that blocks distracting sites during your work hours, and hides
the most addictive parts of them the rest of the time.

## Features

**Blocking during work hours**
- Block YouTube, LinkedIn, Instagram, X, Reddit, TikTok and any site you add.
- One schedule by default; you can opt in to split days (a lunch gap) or different
  hours per day.
- Breaks from a daily allowance (default 3 × 5 min). Blocking resumes on its own.
- A toolbar badge shows how much focus time is left.

**Cleanup the rest of the time**
- YouTube: hide Shorts, home recommendations, suggested videos, comments.
- LinkedIn: hide the feed. X: hide the home timeline, trends. Reddit: hide the front
  page. Instagram: hide Reels and Explore.

**Hard to undo, on purpose**
- Loosening any setting means typing *"I am choosing to be distracted instead of
  doing my work."* by hand.
- Then a wheel of destiny decides. The odds of being sent back to work rise with
  each attempt that day: 50% → 70% → 90%.
- A lock that refuses all loosening until a date and time you pick.

**Stats**
- Focus hours over the last 7 days, days without a bypass, blocked visits today,
  top distractions and the bypass history.

## Install from source

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder (the one with `manifest.json`).
4. The setup page opens: pick your hours, sites and cleanups.

After changing code, click **reload** (↻) on the extension's card.

## Using it

Click the toolbar icon (pin it from the puzzle-piece menu first):

- **Home** shows the status card (with the break button) and your stats.
- **⚙** opens the settings: Schedule, Sites and Cleanup.
- **🔒** opens the lock. The icon fills in black while a lock is active.

## How it works

- **Blocking**: during work hours the service worker installs one
  `declarativeNetRequest` redirect rule per site, pointing at
  `src/pages/blocked.html`. Navigations the rules can't redirect (such as New Tab
  page shortcuts, which start from a `chrome://` page) are caught by a
  `tabs.onUpdated` listener. A once-a-minute alarm turns blocking on and off and
  updates the badge.
- **Cleanup**: content scripts copy your cleanup toggles and the current path onto
  `<html>` as `data-fm-*` attributes; each site's CSS hides elements based on them.
- **Storage**: settings live in `chrome.storage.sync`; stats, break state and the
  bypass history live in `chrome.storage.local`. Nothing is sent anywhere.

## Project structure

```
manifest.json
icons/              icon.svg (source) and the exported PNGs
src/
  background.js     service worker: rules, breaks, badge, stats
  shared/           settings, stats and UI helpers, shared styles
  pages/            popup, setup and blocked pages
  content/          cleanup content scripts and per-site CSS
scripts/
  package.sh        builds the Chrome Web Store zip into dist/
  make-icons.sh     exports icons/icon.svg to PNGs with headless Chrome
tests/              logic tests for the shared modules
docs/               privacy policy and Chrome Web Store listing
```

## Development

```sh
node tests/logic.test.mjs   # run the logic tests (Node 18+)
scripts/make-icons.sh       # after editing icons/icon.svg
scripts/package.sh          # build dist/focus-mode-<version>.zip
```

## Privacy and publishing

- [Privacy policy](docs/PRIVACY.md)
- [Chrome Web Store listing and publishing steps](docs/STORE_LISTING.md)

## Contributing

Issues and pull requests are welcome. Run `node tests/logic.test.mjs` before
opening a pull request, and keep the UI black and white.

Site cleanups depend on each site's markup, which changes often. If a cleanup stops
working, the selectors live in `src/content/<site>.css`.

## License

[MIT](LICENSE). The icon's "F." uses glyph outlines from
[Inter](https://rsms.me/inter/) Bold, licensed under the SIL Open Font License 1.1.
