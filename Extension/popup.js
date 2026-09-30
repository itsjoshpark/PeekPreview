// Toolbar popup: a Shift+Click reminder and a switch that turns peeking off for the current site.
(async function () {
  "use strict";

  // Same keys as content.js.
  const THEME_KEY = "peek_theme";
  const SITES_KEY = "peek_disabled_sites";

  const label = document.getElementById("site-label");
  const toggle = document.getElementById("site-toggle");

  const [stored, [tab]] = await Promise.all([
    browser.storage.local.get([THEME_KEY, SITES_KEY]),
    browser.tabs.query({ active: true, currentWindow: true }),
  ]);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = PeekCore.resolveTheme(stored[THEME_KEY], prefersDark);

  const site = PeekCore.siteKey(tab?.url ?? "");
  if (site === null) return;

  const name = document.createElement("strong");
  name.textContent = site;
  label.replaceChildren("Enable on ", name);
  toggle.disabled = false;
  toggle.checked = !PeekCore.isSiteDisabled(stored[SITES_KEY], tab.url);

  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    const current = await browser.storage.local.get(SITES_KEY);
    const sites = PeekCore.setSiteDisabled(current[SITES_KEY], site, !enabled);
    if (sites.length) {
      await browser.storage.local.set({ [SITES_KEY]: sites });
    } else {
      await browser.storage.local.remove(SITES_KEY);
    }
  });
})();
