// Intercepts Shift+Click on links and shows the page in a peek overlay.
(function () {
  "use strict";

  if (window.__peekPreviewLoaded) return;
  window.__peekPreviewLoaded = true;

  const THEME_KEY = "peek_theme";
  const THEME_LABELS = { auto: "Auto", light: "Light", dark: "Dark" };
  const SIZE_LIMITS = PeekCore.SIZE_LIMITS;
  // Width of the side button column plus the gap beside the window.
  const SIDE_COLUMN = 66;
  const VIEWPORT_MARGIN = 16;
  const RESIZE_EDGES = {
    top: { top: true },
    right: { right: true },
    bottom: { bottom: true },
    left: { left: true },
    "top-left": { top: true, left: true },
    "top-right": { top: true, right: true },
    "bottom-left": { bottom: true, left: true },
    "bottom-right": { bottom: true, right: true },
  };

  const extensionOrigin = new URL(browser.runtime.getURL("")).origin;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  let themePref = "auto";
  let current = null;
  let stylesheetPromise = null;
  const iconCache = new Map();

  browser.storage.local.get(THEME_KEY).then((stored) => {
    themePref = PeekCore.normalizeThemePref(stored[THEME_KEY]);
  });

  darkQuery.addEventListener("change", () => {
    if (current && themePref === "auto") applyTheme();
  });

  // --- Resources ---------------------------------------------------------

  // Constructed stylesheets are unaffected by the host page's CSP.
  function loadStylesheet() {
    stylesheetPromise ??= fetch(browser.runtime.getURL("content.css"))
      .then((response) => response.text())
      .then((css) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        return sheet;
      });
    return stylesheetPromise;
  }

  // Icons are inlined so they inherit `currentColor` from the theme.
  function loadIcon(name) {
    if (!iconCache.has(name)) {
      iconCache.set(
        name,
        fetch(browser.runtime.getURL(`static/${name}.svg`))
          .then((response) => response.text())
          .then((text) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement)
      );
    }
    return iconCache.get(name);
  }

  function setIcon(button, name) {
    loadIcon(name).then((svg) => {
      const icon = document.importNode(svg, true);
      icon.setAttribute("aria-hidden", "true");
      button.replaceChildren(icon);
    });
  }

  // --- DOM helpers ------------------------------------------------------

  function el(tag, className, props = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.assign(node, props);
    return node;
  }

  function iconButton(className, label, icon, onClick) {
    const button = el("button", className, { type: "button", title: label });
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }

  // --- Theme ------------------------------------------------------------

  function applyTheme() {
    if (!current) return;
    const theme = PeekCore.resolveTheme(themePref, darkQuery.matches);
    current.overlay.dataset.theme = theme;
    current.frame?.contentWindow?.postMessage({ type: "peek:theme", theme }, extensionOrigin);
    setIcon(current.themeButton, `theme-${themePref}`);
    current.themeButton.title = `Theme: ${THEME_LABELS[themePref]}`;
    for (const option of current.themeMenu.children) {
      const active = option.dataset.value === themePref;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
    }
  }

  function setTheme(pref) {
    themePref = PeekCore.normalizeThemePref(pref);
    browser.storage.local.set({ [THEME_KEY]: themePref });
    applyTheme();
  }

  // --- Clipboard --------------------------------------------------------

  async function copyText(text, shadow) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API is unavailable on insecure (http) pages.
      const field = el("textarea", "peek-clipboard", { value: text });
      shadow.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      return ok;
    }
  }

  // --- Geometry ---------------------------------------------------------

  function viewportFor() {
    return {
      width: window.innerWidth - SIDE_COLUMN - VIEWPORT_MARGIN * 2,
      height: window.innerHeight - VIEWPORT_MARGIN * 2,
    };
  }

  function initialRect() {
    const viewport = viewportFor();
    const size = PeekCore.clampSize(
      { width: window.innerWidth * 0.9 - SIDE_COLUMN, height: window.innerHeight * 0.9 },
      SIZE_LIMITS,
      viewport
    );
    return {
      left: Math.round((window.innerWidth - size.width - SIDE_COLUMN) / 2),
      top: Math.round((window.innerHeight - size.height) / 2),
      ...size,
    };
  }

  // Keep at least the header reachable when dragging.
  function clampPosition(rect) {
    const minVisible = 120;
    return {
      ...rect,
      left: Math.min(Math.max(rect.left, minVisible - rect.width), window.innerWidth - minVisible),
      top: Math.min(Math.max(rect.top, 0), window.innerHeight - 48),
    };
  }

  function applyRect() {
    const { wrapper, container, rect } = current;
    wrapper.style.left = `${rect.left}px`;
    wrapper.style.top = `${rect.top}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
  }

  // Drag/resize with pointer capture. `onMove(dx, dy, startRect)` returns the new rect.
  function trackPointer(handle, onMove) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !current) return;
      if (event.target.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      const peek = current;
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = { ...peek.rect };
      handle.setPointerCapture(event.pointerId);
      peek.overlay.classList.add("peek-interacting");

      const move = (moveEvent) => {
        peek.rect = onMove(moveEvent.clientX - startX, moveEvent.clientY - startY, startRect);
        applyRect();
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        peek.overlay.classList.remove("peek-interacting");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  // --- Overlay ----------------------------------------------------------

  function buildOverlay(url) {
    const host = el("div");
    host.id = "peek-preview-host";
    host.style.cssText =
      "all: initial !important; position: fixed !important; inset: 0 !important; " +
      "z-index: 2147483647 !important; display: block !important;";
    const shadow = host.attachShadow({ mode: "closed" });

    const overlay = el("div", "peek-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Preview of ${url}`);

    const wrapper = el("div", "peek-wrapper");
    const container = el("div", "peek-container");

    for (const edge of Object.keys(RESIZE_EDGES)) {
      const handle = el("div", `peek-resize peek-resize-${edge}`);
      container.appendChild(handle);
      trackPointer(handle, (dx, dy, start) =>
        PeekCore.resizeRect(start, RESIZE_EDGES[edge], dx, dy, SIZE_LIMITS, viewportFor())
      );
    }

    // Header: refresh, copy, theme, URL.
    const header = el("div", "peek-header");
    const headerButtons = el("div", "peek-header-buttons");

    const refreshButton = iconButton("peek-header-button", "Refresh", "refresh", () => {
      refreshButton.classList.remove("peek-spin");
      void refreshButton.offsetWidth;
      refreshButton.classList.add("peek-spin");
      current?.frame?.contentWindow?.postMessage({ type: "peek:refresh" }, extensionOrigin);
    });

    const copyButton = iconButton("peek-header-button", "Copy link", "link", async () => {
      if (await copyText(url, shadow)) {
        setIcon(copyButton, "check");
        setTimeout(() => setIcon(copyButton, "link"), 1000);
      }
    });

    const themeWrap = el("div", "peek-theme");
    const themeMenu = el("div", "peek-theme-menu");
    themeMenu.setAttribute("role", "menu");
    const themeButton = iconButton("peek-header-button", "Theme", "theme-auto", () => {
      themeMenu.classList.toggle("show");
    });
    themeButton.setAttribute("aria-haspopup", "menu");
    for (const [value, label] of Object.entries(THEME_LABELS)) {
      const option = el("button", "peek-theme-option", { type: "button", textContent: label });
      option.dataset.value = value;
      option.setAttribute("role", "menuitemradio");
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        themeMenu.classList.remove("show");
        setTheme(value);
      });
      themeMenu.appendChild(option);
    }
    themeWrap.append(themeButton, themeMenu);

    headerButtons.append(refreshButton, copyButton, themeWrap);
    const urlLabel = el("div", "peek-url", { textContent: url, title: url });
    header.append(headerButtons, urlLabel);
    trackPointer(header, (dx, dy, start) =>
      clampPosition({ ...start, left: start.left + dx, top: start.top + dy })
    );

    const body = el("div", "peek-body");
    const loading = el("div", "peek-loading");
    loading.append(el("div", "peek-spinner"));
    body.append(loading);

    container.append(header, body);

    // Side buttons: open in tab, close.
    const sideButtons = el("div", "peek-side-buttons");
    sideButtons.append(
      iconButton("peek-side-button", "Open in new tab", "open", () => openInTab(url)),
      iconButton("peek-side-button", "Close (Esc)", "close", () => closePeek())
    );

    wrapper.append(container, sideButtons);
    overlay.append(wrapper);
    shadow.append(overlay);

    // Close on a click that starts and ends on the backdrop (not the end of a drag).
    let downOnBackdrop = false;
    // Capture phase: drag/resize handles stop propagation, which would leave a stale value.
    overlay.addEventListener(
      "pointerdown",
      (event) => {
        downOnBackdrop = event.target === overlay;
      },
      true
    );
    overlay.addEventListener("click", (event) => {
      themeMenu.classList.remove("show");
      if (downOnBackdrop && event.target === overlay) closePeek();
    });

    return { host, shadow, overlay, wrapper, container, body, loading, themeButton, themeMenu };
  }

  function mountFrame(url) {
    if (!current) return;
    const frameUrl = new URL(browser.runtime.getURL("frame.html"));
    frameUrl.searchParams.set("url", PeekCore.toFrameUrl(url));
    frameUrl.searchParams.set("theme", current.overlay.dataset.theme);
    const frame = el("iframe", "peek-frame", { src: frameUrl.href, title: url });
    frame.setAttribute("allow", "clipboard-write; fullscreen");
    current.frame = frame;
    current.body.append(frame);
    frame.addEventListener("load", () => current?.loading.remove(), { once: true });
  }

  function onFrameMessage(event) {
    if (!current?.frame || event.source !== current.frame.contentWindow) return;
    if (event.origin !== extensionOrigin) return;
    if (event.data?.type === "peek:openTab") openInTab(current.url);
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && current) {
      event.preventDefault();
      event.stopPropagation();
      closePeek();
    }
  }

  async function openPeek(url) {
    closePeek();

    const parts = buildOverlay(url);
    current = { url, rect: initialRect(), frame: null, ...parts };
    applyRect();
    applyTheme();
    loadStylesheet().then(
      (sheet) => {
        if (current?.host !== parts.host) return;
        parts.shadow.adoptedStyleSheets = [sheet];
        document.documentElement.appendChild(parts.host);
      },
      () => {
        if (current?.host === parts.host) closePeek();
      }
    );
    window.addEventListener("message", onFrameMessage);
    document.addEventListener("keydown", onKeyDown, true);

    const peek = current;
    let reply;
    try {
      reply = await browser.runtime.sendMessage({ type: "peek:open", url, pageUrl: location.href });
    } catch (error) {
      console.warn("PeekPreview: background unavailable", error);
      reply = { mode: "overlay" };
    }
    if (current !== peek) return;
    if (reply?.mode === "overlay") {
      mountFrame(url);
    } else if (reply?.mode === "popup") {
      // The site can't be framed; the background opened it in a popup window instead.
      closePeek();
    } else {
      openInTab(url);
    }
  }

  function openInTab(url) {
    browser.runtime.sendMessage({ type: "peek:openTab", url });
    closePeek();
  }

  function closePeek() {
    if (!current) return;
    current.host.remove();
    current = null;
    window.removeEventListener("message", onFrameMessage);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  // --- Link interception ------------------------------------------------

  function onClick(event) {
    if (!PeekCore.isPeekTrigger(event)) return;
    const link = PeekCore.findLink(event.composedPath());
    if (!link) return;
    const url = PeekCore.linkHref(link);
    const mode = PeekCore.classifyUrl(url, location.href);
    if (mode === "ignore") return;

    // Also stops Safari's Shift+Click "Add to Reading List".
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode === "tab") {
      browser.runtime.sendMessage({ type: "peek:openTab", url });
    } else {
      openPeek(url);
    }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
})();
