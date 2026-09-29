// Pure helpers shared by the content script and background page.
// Plain script (no modules): exposes globalThis.PeekCore, and module.exports for Node tests.
(function (root) {
  "use strict";

  // Short-link hosts that never render usefully in a frame.
  const BLOCKED_HOSTS = ["t.co"];

  // The popup window's size relative to the browser window it opens from: a share of its width,
  // its full height less a fixed gap (split above and below), and its smallest size.
  const POPUP_SCALE = 0.9;
  const POPUP_HEIGHT_GAP = 128;
  const POPUP_MIN = { width: 400, height: 300 };

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

  /**
   * @param {EventTarget[]} path event.composedPath(), so links inside open shadow roots are found.
   * @returns {Element | null} The first link with an href.
   */
  function findLink(path) {
    for (const node of path) {
      if (!node || typeof node.tagName !== "string") continue;
      if (node.tagName.toLowerCase() === "a" && linkHref(node)) return node;
    }
    return null;
  }

  /**
   * @param {string} url
   * @param {string} pageUrl
   * @returns {"overlay" | "tab" | "ignore"} Preview it, open it in a new tab instead, or let the
   *   browser handle it.
   */
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

  /**
   * Would these response headers stop the page rendering in the overlay? The frame's parent is
   * the extension's frame page, never the site itself, so any X-Frame-Options value (DENY or
   * SAMEORIGIN) and any CSP frame-ancestors directive blocks it. A blocked link on the page's own
   * origin may still be framed in the page (`allowsParent`).
   * @param {Record<string, string>} headers Lower-case keys.
   * @returns {boolean}
   */
  function blocksFraming(headers) {
    if (headers["x-frame-options"]) return true;
    const csp = headers["content-security-policy"] || "";
    return csp
      .split(";")
      .some((directive) => directive.trim().toLowerCase().startsWith("frame-ancestors"));
  }

  function parseUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function isSameOrigin(a, b) {
    const first = parseUrl(a);
    const second = parseUrl(b);
    return first !== null && second !== null && first.origin === second.origin;
  }

  /**
   * @param {string} csp CSP header value(s). `fetch` joins repeated headers with ", ", which is
   *   also how several policies are written in one value.
   * @returns {Map<string, string[]>[]} Directive (lower case) → sources, one Map per policy.
   */
  function parsePolicies(csp) {
    return csp
      .split(",")
      .map((policy) => {
        const directives = new Map();
        for (const directive of policy.split(";")) {
          const [name, ...sources] = directive.trim().split(/\s+/);
          const key = name.toLowerCase();
          if (key && !directives.has(key)) directives.set(key, sources);
        }
        return directives;
      })
      .filter((directives) => directives.size > 0);
  }

  // Scheme `to` is allowed by scheme `from`: the same, or an upgrade from http to https.
  function schemeAllows(from, to) {
    return from === to || (from === "http:" && to === "https:");
  }

  const DEFAULT_PORTS = { "http:": "80", "https:": "443" };

  const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[^/:*]+)(?::(\d+|\*))?(\/.*)?$/i;

  /**
   * Does CSP source expression `source` allow `url`?
   * @param {string} source
   * @param {string} url
   * @param {string} selfUrl The protected resource, for 'self' and scheme-less sources.
   * @param {boolean} [ignorePath] For frame-ancestors, where browsers match only the origin.
   * @returns {boolean}
   */
  function matchesSource(source, url, selfUrl, ignorePath = false) {
    const target = parseUrl(url);
    const self = parseUrl(selfUrl);
    if (!target || !self) return false;
    const expression = source.toLowerCase();

    if (expression === "*") return target.protocol === "http:" || target.protocol === "https:";
    if (expression === "'self'") {
      return target.host === self.host && schemeAllows(self.protocol, target.protocol);
    }
    if (/^[a-z][a-z0-9+.-]*:$/.test(expression)) return schemeAllows(expression, target.protocol);

    const match = HOST_SOURCE.exec(source);
    if (!match) return false;
    const [, scheme, host, port, path] = match;
    const from = scheme ? `${scheme.toLowerCase()}:` : self.protocol;
    if (!schemeAllows(from, target.protocol)) return false;

    const hostname = host.toLowerCase();
    if (hostname.startsWith("*.")) {
      if (!target.hostname.endsWith(hostname.slice(1))) return false;
    } else if (hostname !== "*" && hostname !== target.hostname) {
      return false;
    }

    const targetPort = target.port || DEFAULT_PORTS[target.protocol];
    if (port === undefined ? target.port !== "" : port !== "*" && port !== targetPort) {
      return false;
    }

    if (path && !ignorePath) {
      return path.endsWith("/") ? target.pathname.startsWith(path) : target.pathname === path;
    }
    return true;
  }

  function sourcesAllow(sources, url, selfUrl, ignorePath) {
    return sources.some((source) => matchesSource(source, url, selfUrl, ignorePath));
  }

  /**
   * Would the site render in a frame whose only ancestor is `parentUrl`? CSP frame-ancestors,
   * when present, replaces X-Frame-Options; conflicting X-Frame-Options values block.
   * @param {Record<string, string>} headers The site's response headers, lower-case keys.
   * @param {string} url The site's URL after redirects.
   * @param {string} parentUrl
   * @returns {boolean}
   */
  function allowsParent(headers, url, parentUrl) {
    const ancestors = parsePolicies(headers["content-security-policy"] || "")
      .map((policy) => policy.get("frame-ancestors"))
      .filter((sources) => sources !== undefined);
    if (ancestors.length > 0) {
      return ancestors.every((sources) => sourcesAllow(sources, parentUrl, url, true));
    }

    const values = new Set(
      (headers["x-frame-options"] || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    if (values.size > 1 || values.has("deny")) return false;
    if (values.has("sameorigin")) return isSameOrigin(url, parentUrl);
    return true;
  }

  /**
   * Would the page let `url` load in an <iframe>? Each policy is checked against frame-src, else
   * child-src, else default-src.
   * @param {string} csp The page's CSP policies, joined with ", ".
   * @param {string} url
   * @param {string} pageUrl
   * @returns {boolean}
   */
  function allowsFrame(csp, url, pageUrl) {
    return parsePolicies(csp).every((policy) => {
      const sources =
        policy.get("frame-src") ?? policy.get("child-src") ?? policy.get("default-src");
      return sources === undefined || sourcesAllow(sources, url, pageUrl, false);
    });
  }

  // A peek-sized popup centered on the browser window it was opened from.
  function popupBounds(win) {
    const { width, height } = clampSize(
      { width: win.width * POPUP_SCALE, height: win.height - POPUP_HEIGHT_GAP },
      POPUP_MIN,
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

  /**
   * Fit `size` inside `viewport`, but no smaller than `min` (which wins if the viewport is smaller).
   * @param {{ width: number, height: number }} size
   * @param {{ width: number, height: number }} min
   * @param {{ width: number, height: number }} viewport
   * @returns {{ width: number, height: number }}
   */
  function clampSize(size, min, viewport) {
    const maxWidth = Math.max(min.width, viewport.width);
    const maxHeight = Math.max(min.height, viewport.height);
    return {
      width: Math.round(Math.min(maxWidth, Math.max(min.width, size.width))),
      height: Math.round(Math.min(maxHeight, Math.max(min.height, size.height))),
    };
  }

  const PeekCore = {
    isPeekTrigger,
    linkHref,
    findLink,
    classifyUrl,
    toFrameUrl,
    blocksFraming,
    isSameOrigin,
    parsePolicies,
    matchesSource,
    allowsParent,
    allowsFrame,
    popupBounds,
    sameBounds,
    POPUP_SCALE,
    POPUP_HEIGHT_GAP,
    POPUP_MIN,
    normalizeThemePref,
    resolveTheme,
    clampSize,
  };

  root.PeekCore = PeekCore;
  if (typeof module !== "undefined" && module.exports) module.exports = PeekCore;
})(globalThis);
