# Chrome Web Store listing

Copy these into the Chrome Web Store developer dashboard.

## Basics

- **Name:** Focus Mode
- **Category:** Productivity
- **Language:** English
- **Summary** (132 characters max):
  Block distracting sites during your work hours. Hide YouTube Shorts and feeds the rest of the time.

## Description

Focus Mode keeps distracting sites out of your work hours, and keeps the rest of
your day a little calmer too.

DURING WORK HOURS
• Block YouTube, LinkedIn, Instagram, X, Reddit, TikTok and any other site you add
• Split your day (say, a lunch break) or set different hours per day if you want
• Take short breaks from a daily allowance; blocking resumes on its own

THE REST OF THE TIME
• Hide YouTube Shorts, home recommendations, suggested videos and comments
• Hide the LinkedIn feed, the X home timeline, the Reddit front page, Instagram Reels

HARD TO UNDO, ON PURPOSE
• Loosening your settings means typing out "I am choosing to be distracted…"
• Then the wheel of destiny decides, and the odds get worse every time
• Lock your settings until a set time so you can't loosen them at all

SEE YOUR PROGRESS
• Focus hours, days without a bypass and your top distractions
• The toolbar icon shows how much focus time is left

Private by design: everything stays in your browser. No accounts, no analytics,
no data collection.

## Single purpose

Focus Mode helps users stay focused by blocking distracting websites during their
chosen work hours and hiding distracting sections of selected sites.

## Permission justifications

- **declarativeNetRequest:** Redirects the user's blocked sites to the extension's
  "blocked" page during their work hours.
- **storage:** Saves the user's settings (work hours, blocked sites, options) and
  local usage stats.
- **alarms:** Checks once a minute whether work hours or a break have started or
  ended, to turn blocking on and off on time.
- **Host permissions (`*://*/*`):** Users choose which sites to block, and can add
  any site. A declarativeNetRequest redirect only applies when the extension has
  host access to both the request URL and the request initiator, so a visit that
  starts from a search result or any other site can only be redirected with access
  to all sites. The extension does not read page content; it only redirects the
  user's blocked sites and adds styles that hide feed sections on YouTube,
  LinkedIn, X, Reddit and Instagram.
- **Remote code:** None. All code ships in the package.

## Data usage disclosures

- Collects no user data in any category.
- Certify: not sold to third parties; not used for unrelated purposes; not used for
  creditworthiness or lending.

## Assets to prepare

- [ ] Store icon: `icons/store-icon-128.png` (already in the repo)
- [ ] At least 1 screenshot, 1280×800 or 640×400: popup, setup page, blocked page,
      wheel of destiny
- [ ] Optional small promo tile, 440×280
- [ ] Privacy policy URL: fill in the contact email in `docs/PRIVACY.md`, then use
      https://github.com/JoseDRomano/focus-mode-extension/blob/main/docs/PRIVACY.md

## Publishing

1. Run `scripts/package.sh` to build `dist/focus-mode-<version>.zip`.
2. Register at https://chrome.google.com/webstore/devconsole (one-time $5 fee).
3. Upload the zip, fill in the fields above, and submit for review.
4. For later releases, bump `version` in `manifest.json` and repeat steps 1 and 3.
