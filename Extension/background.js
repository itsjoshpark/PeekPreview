// Non-persistent background page: decides overlay vs popup window, and opens tabs/windows.
"use strict";

const CHECK_TIMEOUT_MS = 5000;

// `{ headers, url }` for `url` after redirects (`headers` has lower-case keys), or null on a
// network error or timeout. Reads only the response headers, then aborts the body.
async function fetchHeaders(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { headers, url: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// A site that blocks the extension's frame page can still go straight into the page's overlay
// when the link is on the page's own origin (before and after redirects), the site accepts the
// page as its parent, and the page's <meta> CSP (`pageCsp`) lets it frame the link. The page's
// header CSP isn't re-fetched: the content script checks that the frame loaded and falls back to
// the popup (`peek:popup`) if it didn't.
function canFrameInPage(target, url, pageUrl, pageCsp) {
  if (!PeekCore.isSameOrigin(url, pageUrl) || !PeekCore.isSameOrigin(target.url, pageUrl)) {
    return false;
  }
  return (
    PeekCore.allowsParent(target.headers, target.url, pageUrl) &&
    PeekCore.allowsFrame(pageCsp, url, pageUrl) &&
    PeekCore.allowsFrame(pageCsp, target.url, pageUrl)
  );
}

// How long to watch a new popup: Safari may resize it to fill the screen shortly after it opens
// (seen ~50 ms after creation on a site's first peek), overriding the bounds we set.
const POPUP_SETTLE_MS = 1500;
const POPUP_POLL_MS = 100;

// Safari ignores the size passed to windows.create and may resize the window again as it opens.
// Create it unfocused (behind the current window), keep applying the bounds, and bring it forward
// once they've held for two checks, so the full-screen flash stays hidden. Keeps enforcing the
// bounds until POPUP_SETTLE_MS in case Safari resizes it later.
async function openPopup(url, windowId) {
  const parent = await browser.windows.get(windowId);
  const bounds = PeekCore.popupBounds(parent);
  const popup = await browser.windows.create({ url, type: "popup", focused: false, ...bounds });
  await browser.windows.update(popup.id, bounds);

  let reveal;
  const revealed = new Promise((resolve) => {
    reveal = () => {
      resolve();
      return browser.windows.update(popup.id, { focused: true });
    };
  });
  keepBounds(popup.id, bounds, reveal).catch(() => {}); // Rejects if the window was closed.
  await revealed;
}

async function keepBounds(windowId, bounds, reveal) {
  const deadline = Date.now() + POPUP_SETTLE_MS;
  let stableChecks = 0;
  let shown = false;
  const show = async () => {
    if (!shown) {
      shown = true;
      await reveal();
    }
  };
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POPUP_POLL_MS));
      const current = await browser.windows.get(windowId);
      if (PeekCore.sameBounds(current, bounds)) {
        stableChecks += 1;
        if (stableChecks >= 2) await show();
      } else {
        stableChecks = 0;
        await browser.windows.update(windowId, bounds);
      }
    }
  } finally {
    await show();
  }
}

async function openTab(url, sender) {
  if (PeekCore.classifyUrl(url, "") === "ignore") return;
  const properties = { url };
  if (sender.tab) {
    properties.index = sender.tab.index + 1;
    properties.windowId = sender.tab.windowId;
  }
  await browser.tabs.create(properties);
}

async function handlePeekOpen(message, sender) {
  const mode = PeekCore.classifyUrl(message.url, message.pageUrl);
  if (mode !== "overlay") return { mode };
  // Unknown headers (network error, timeout) count as framable: the overlay shows its error card.
  const target = await fetchHeaders(message.url);
  if (!target || !PeekCore.blocksFraming(target.headers)) return { mode: "overlay" };
  if (canFrameInPage(target, message.url, message.pageUrl, message.pageCsp || "")) {
    return { mode: "overlay", inPage: true };
  }
  return openOutside(message.url, sender);
}

// For a site that can't be framed: a popup window, or "tab" to have the content script open a tab.
async function openOutside(url, sender) {
  if (sender.tab?.windowId !== undefined) {
    try {
      await openPopup(url, sender.tab.windowId);
      return { mode: "popup" };
    } catch (error) {
      console.warn("PeekPreview: could not open popup window", error);
    }
  }
  return { mode: "tab" };
}

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message?.type) {
    case "peek:open":
      return handlePeekOpen(message, sender);
    case "peek:popup":
      if (PeekCore.classifyUrl(message.url, "") !== "overlay") return undefined;
      return openOutside(message.url, sender);
    case "peek:openTab":
      return openTab(message.url, sender);
  }
});
