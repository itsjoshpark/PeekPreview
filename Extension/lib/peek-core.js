// Pure helpers shared by the content script and background page.
// Plain script (no modules): exposes globalThis.PeekCore, and module.exports for Node tests.
(function (root) {
  "use strict";

  // Short-link hosts that never render usefully in a frame.
  const BLOCKED_HOSTS = ["t.co"];

  // Default peek size, shared by the overlay and the popup window.
  const SIZE_LIMITS = { minWidth: 400, minHeight: 300, maxWidth: 1400, maxHeight: 900 };

  const THEMES = ["auto", "light", "dark"];

  function isPeekTrigger(event) {
    if (!event.shiftKey) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    return event.button === 0 || event.button === 1;
  }

  function linkHref(element) {
    const href = element.href;
    // SVG <a> exposes href as an SVGAnimatedString.
    if (href && typeof href === "object") return href.baseVal || "";
    return href || "";
  }

  // `path` is event.composedPath(), so links inside open shadow roots are found too.
  function findLink(path) {
    for (const node of path) {
      if (!node || typeof node.tagName !== "string") continue;
      if (node.tagName.toLowerCase() === "a" && linkHref(node)) return node;
    }
    return null;
  }

  // "overlay": preview it; "tab": open in a new tab instead; "ignore": let the browser handle it.
  function classifyUrl(url, pageUrl) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return "ignore";
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return "ignore";
    if (target.hash) {
      try {
        const page = new URL(pageUrl);
        page.hash = "";
        const bare = new URL(target.href);
        bare.hash = "";
        if (bare.href === page.href) return "ignore";
      } catch {
        // Unparseable page URL: fall through and preview.
      }
    }
    if (BLOCKED_HOSTS.includes(target.hostname)) return "tab";
    return "overlay";
  }

  // Extension pages are a secure context, so plain-http frames would be blocked as mixed content.
  function toFrameUrl(url) {
    return url.replace(/^http:/i, "https:");
  }

  // Would these response headers stop the page rendering in the overlay? `headers` has lower-case keys.
  // The frame's parent is the extension's frame page, never the site itself, so any
  // X-Frame-Options value (DENY or SAMEORIGIN) and any CSP frame-ancestors directive blocks it.
  function blocksFraming(headers) {
    if (headers["x-frame-options"]) return true;
    const csp = headers["content-security-policy"] || "";
    return csp
      .split(";")
      .some((directive) => directive.trim().toLowerCase().startsWith("frame-ancestors"));
  }

  // A peek-sized popup centered on the browser window it was opened from.
  function popupBounds(win) {
    const { width, height } = clampSize(
      { width: win.width * 0.7, height: win.height * 0.8 },
      SIZE_LIMITS,
      { width: win.width, height: win.height }
    );
    return {
      left: win.left + Math.round((win.width - width) / 2),
      top: win.top + Math.round((win.height - height) / 2),
      width,
      height,
    };
  }

  // Window bounds as reported by Safari can be off by a pixel or two.
  function sameBounds(a, b) {
    return ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) <= 2);
  }

  function normalizeThemePref(pref) {
    return THEMES.includes(pref) ? pref : "auto";
  }

  function resolveTheme(pref, prefersDark) {
    const theme = normalizeThemePref(pref);
    if (theme === "auto") return prefersDark ? "dark" : "light";
    return theme;
  }

  function clampSize(size, limits, viewport) {
    const maxWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth, viewport.width));
    const maxHeight = Math.max(limits.minHeight, Math.min(limits.maxHeight, viewport.height));
    return {
      width: Math.round(Math.min(maxWidth, Math.max(limits.minWidth, size.width))),
      height: Math.round(Math.min(maxHeight, Math.max(limits.minHeight, size.height))),
    };
  }

  // Resize `start` by pointer delta (dx, dy) along the dragged `edges`.
  // With limits/viewport, the size is clamped and the opposite edge stays anchored.
  function resizeRect(start, edges, dx, dy, limits, viewport) {
    let width = start.width + (edges.right ? dx : 0) - (edges.left ? dx : 0);
    let height = start.height + (edges.bottom ? dy : 0) - (edges.top ? dy : 0);
    if (limits && viewport) {
      ({ width, height } = clampSize({ width, height }, limits, viewport));
    }
    return {
      left: edges.left ? start.left + start.width - width : start.left,
      top: edges.top ? start.top + start.height - height : start.top,
      width,
      height,
    };
  }

  const PeekCore = {
    isPeekTrigger,
    linkHref,
    findLink,
    classifyUrl,
    toFrameUrl,
    blocksFraming,
    popupBounds,
    sameBounds,
    SIZE_LIMITS,
    normalizeThemePref,
    resolveTheme,
    clampSize,
    resizeRect,
  };

  root.PeekCore = PeekCore;
  if (typeof module !== "undefined" && module.exports) module.exports = PeekCore;
})(globalThis);
