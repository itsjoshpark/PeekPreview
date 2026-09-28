const test = require("node:test");
const assert = require("node:assert/strict");
const PeekCore = require("../Extension/lib/peek-core.js");

function click(overrides = {}) {
  return {
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    button: 0,
    ...overrides,
  };
}

test("isPeekTrigger: Shift + primary or middle click", () => {
  assert.equal(PeekCore.isPeekTrigger(click()), true);
  assert.equal(PeekCore.isPeekTrigger(click({ button: 1 })), true);
});

test("isPeekTrigger: rejects no shift, right click, other modifiers", () => {
  assert.equal(PeekCore.isPeekTrigger(click({ shiftKey: false })), false);
  assert.equal(PeekCore.isPeekTrigger(click({ button: 2 })), false);
  assert.equal(PeekCore.isPeekTrigger(click({ metaKey: true })), false);
  assert.equal(PeekCore.isPeekTrigger(click({ ctrlKey: true })), false);
  assert.equal(PeekCore.isPeekTrigger(click({ altKey: true })), false);
});

test("findLink: returns first anchor with href in the composed path", () => {
  const span = { tagName: "SPAN" };
  const anchor = { tagName: "A", href: "https://example.com/" };
  const body = { tagName: "BODY" };
  assert.equal(PeekCore.findLink([span, anchor, body]), anchor);
});

test("findLink: handles SVG anchors and ignores anchors without href", () => {
  const empty = { tagName: "A", href: "" };
  const svgAnchor = { tagName: "a", href: { baseVal: "https://example.com/svg" } };
  assert.equal(PeekCore.findLink([empty]), null);
  assert.equal(PeekCore.findLink([svgAnchor]), svgAnchor);
  assert.equal(PeekCore.linkHref(svgAnchor), "https://example.com/svg");
});

test("findLink: ignores non-element path entries", () => {
  assert.equal(PeekCore.findLink([{}, null, undefined]), null);
});

test("classifyUrl: http(s) links are peekable", () => {
  assert.equal(PeekCore.classifyUrl("https://github.com/a", "https://x.com/"), "overlay");
  assert.equal(PeekCore.classifyUrl("http://example.com", "https://x.com/"), "overlay");
});

test("classifyUrl: blocked short-link hosts open in a tab", () => {
  assert.equal(PeekCore.classifyUrl("https://t.co/abc", "https://x.com/"), "tab");
});

test("classifyUrl: non-http schemes and same-page anchors are ignored", () => {
  assert.equal(PeekCore.classifyUrl("javascript:void(0)", "https://x.com/"), "ignore");
  assert.equal(PeekCore.classifyUrl("mailto:a@b.c", "https://x.com/"), "ignore");
  assert.equal(PeekCore.classifyUrl("https://x.com/page#top", "https://x.com/page"), "ignore");
  assert.equal(PeekCore.classifyUrl("not a url", "https://x.com/"), "ignore");
});

test("classifyUrl: same page with different query is peekable", () => {
  assert.equal(PeekCore.classifyUrl("https://x.com/page?a=1", "https://x.com/page"), "overlay");
});

test("blocksFraming: any X-Frame-Options blocks (the frame's parent is the extension page)", () => {
  assert.equal(PeekCore.blocksFraming({ "x-frame-options": "DENY" }), true);
  assert.equal(PeekCore.blocksFraming({ "x-frame-options": "SAMEORIGIN" }), true);
  assert.equal(PeekCore.blocksFraming({ "x-frame-options": "sameorigin, sameorigin" }), true);
  assert.equal(PeekCore.blocksFraming({}), false);
});

test("blocksFraming: any CSP frame-ancestors blocks, other CSP does not", () => {
  const csp = (v) => ({ "content-security-policy": v });
  assert.equal(PeekCore.blocksFraming(csp("default-src 'self'; frame-ancestors 'none'")), true);
  assert.equal(PeekCore.blocksFraming(csp("frame-ancestors 'self' https://a.com")), true);
  assert.equal(PeekCore.blocksFraming(csp("FRAME-ANCESTORS *")), true);
  assert.equal(PeekCore.blocksFraming(csp("script-src 'self'; frame-src *")), false);
});

test("popupBounds: peek-sized and centered on the browser window", () => {
  const win = { left: 100, top: 50, width: 1600, height: 1000 };
  const b = PeekCore.popupBounds(win);
  assert.ok(b.width < win.width && b.height < win.height);
  assert.equal(b.left, win.left + Math.round((win.width - b.width) / 2));
  assert.equal(b.top, win.top + Math.round((win.height - b.height) / 2));
});

test("popupBounds: respects min and max sizes", () => {
  const huge = PeekCore.popupBounds({ left: 0, top: 0, width: 5000, height: 3000 });
  assert.deepEqual([huge.width, huge.height], [1400, 900]);
  const tiny = PeekCore.popupBounds({ left: 0, top: 0, width: 300, height: 200 });
  assert.deepEqual([tiny.width, tiny.height], [400, 300]);
});

test("resolveTheme", () => {
  assert.equal(PeekCore.resolveTheme("auto", true), "dark");
  assert.equal(PeekCore.resolveTheme("auto", false), "light");
  assert.equal(PeekCore.resolveTheme("light", true), "light");
  assert.equal(PeekCore.resolveTheme("dark", false), "dark");
  assert.equal(PeekCore.resolveTheme("bogus", false), "light");
  assert.equal(PeekCore.normalizeThemePref("bogus"), "auto");
});

test("clampSize: respects min, max and viewport", () => {
  const limits = { minWidth: 400, minHeight: 300, maxWidth: 1400, maxHeight: 900 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(PeekCore.clampSize({ width: 100, height: 100 }, limits, viewport), { width: 400, height: 300 });
  assert.deepEqual(PeekCore.clampSize({ width: 5000, height: 5000 }, limits, viewport), { width: 1200, height: 800 });
  assert.deepEqual(PeekCore.clampSize({ width: 600, height: 500 }, limits, viewport), { width: 600, height: 500 });
});

test("resizeRect: edges move the right sides", () => {
  const start = { left: 100, top: 100, width: 600, height: 400 };
  assert.deepEqual(PeekCore.resizeRect(start, { right: true }, 50, 50), { left: 100, top: 100, width: 650, height: 400 });
  assert.deepEqual(PeekCore.resizeRect(start, { left: true }, 50, 0), { left: 150, top: 100, width: 550, height: 400 });
  assert.deepEqual(PeekCore.resizeRect(start, { top: true, left: true }, -20, -30), { left: 80, top: 70, width: 620, height: 430 });
  assert.deepEqual(PeekCore.resizeRect(start, { bottom: true }, 0, 25), { left: 100, top: 100, width: 600, height: 425 });
});

test("toFrameUrl: upgrades http to https, leaves https alone", () => {
  assert.equal(PeekCore.toFrameUrl("http://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(PeekCore.toFrameUrl("https://example.com/"), "https://example.com/");
});

test("sameBounds: equal within a couple of pixels", () => {
  const want = { left: 288, top: 131, width: 1344, height: 844 };
  assert.equal(PeekCore.sameBounds(want, { ...want }), true);
  assert.equal(PeekCore.sameBounds(want, { ...want, width: 1345, top: 130 }), true);
  assert.equal(PeekCore.sameBounds(want, { left: 0, top: 25, width: 1920, height: 1055 }), false);
});
