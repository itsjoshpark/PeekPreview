// Non-persistent background page: decides overlay vs popup window, and opens tabs/windows.
"use strict";

const CHECK_TIMEOUT_MS = 5000;

// Does the site forbid being framed? Reads only the response headers, then aborts the body.
// Unknown (network error, timeout) counts as "not blocked": the overlay shows its own error card.
async function isFramingBlocked(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return PeekCore.blocksFraming(headers);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
  if (!(await isFramingBlocked(message.url))) return { mode: "overlay" };

  if (sender.tab?.windowId !== undefined) {
    try {
      await openPopup(message.url, sender.tab.windowId);
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
    case "peek:openTab":
      return openTab(message.url, sender);
  }
});
