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

// Trimmed from the live headers (2026-09).
const GITHUB_CSP =
  "default-src 'none'; frame-ancestors 'none'; " +
  "frame-src viewscreen.githubusercontent.com notebooks.githubusercontent.com www.youtube-nocookie.com";
const TIKTOK_CSP =
  "upgrade-insecure-requests; default-src 'self' *.tiktok.com; " +
  "frame-ancestors tea-va.bytedance.net www.tiktok.com; frame-src bytedance: *.kakao.com *.tiktok.com";

test("isSameOrigin: scheme, host and port must all match", () => {
  assert.equal(PeekCore.isSameOrigin("https://a.com/x", "https://a.com/y?z"), true);
  assert.equal(PeekCore.isSameOrigin("https://a.com:443/", "https://a.com/"), true);
  assert.equal(PeekCore.isSameOrigin("http://a.com/", "https://a.com/"), false);
  assert.equal(PeekCore.isSameOrigin("https://www.a.com/", "https://a.com/"), false);
  assert.equal(PeekCore.isSameOrigin("https://a.com:8443/", "https://a.com/"), false);
  assert.equal(PeekCore.isSameOrigin("not a url", "https://a.com/"), false);
});

test("parsePolicies: splits policies and directives, first duplicate wins", () => {
  const [one, two] = PeekCore.parsePolicies("Frame-Src a.com b.com; frame-src c.com, default-src 'none'");
  assert.deepEqual(one.get("frame-src"), ["a.com", "b.com"]);
  assert.deepEqual(two.get("default-src"), ["'none'"]);
  assert.deepEqual(PeekCore.parsePolicies(""), []);
});

test("matchesSource: keywords and scheme sources", () => {
  const self = "https://site.com/page";
  assert.equal(PeekCore.matchesSource("*", "https://other.com/", self), true);
  assert.equal(PeekCore.matchesSource("'self'", "https://site.com/x", self), true);
  assert.equal(PeekCore.matchesSource("'SELF'", "https://site.com/x", self), true);
  assert.equal(PeekCore.matchesSource("'self'", "https://www.site.com/", self), false);
  assert.equal(PeekCore.matchesSource("'self'", "https://site.com/", "http://site.com/"), true);
  assert.equal(PeekCore.matchesSource("'none'", "https://site.com/", self), false);
  assert.equal(PeekCore.matchesSource("'unsafe-inline'", "https://site.com/", self), false);
  assert.equal(PeekCore.matchesSource("https:", "https://other.com/", self), true);
  assert.equal(PeekCore.matchesSource("http:", "https://other.com/", self), true);
  assert.equal(PeekCore.matchesSource("bytedance:", "https://other.com/", self), false);
});

test("matchesSource: host sources with wildcards, schemes, ports and paths", () => {
  const self = "https://site.com/";
  assert.equal(PeekCore.matchesSource("*.tiktok.com", "https://www.tiktok.com/@x", self), true);
  assert.equal(PeekCore.matchesSource("*.tiktok.com", "https://tiktok.com/", self), false);
  assert.equal(PeekCore.matchesSource("www.tiktok.com", "https://www.tiktok.com/", self), true);
  assert.equal(PeekCore.matchesSource("WWW.TikTok.com", "https://www.tiktok.com/", self), true);
  assert.equal(PeekCore.matchesSource("tiktok.com", "https://www.tiktok.com/", self), false);
  // No scheme: the protected resource's scheme, or an upgrade to https.
  assert.equal(PeekCore.matchesSource("a.com", "http://a.com/", self), false);
  assert.equal(PeekCore.matchesSource("a.com", "https://a.com/", "http://site.com/"), true);
  assert.equal(PeekCore.matchesSource("http://a.com", "https://a.com/", self), true);
  assert.equal(PeekCore.matchesSource("https://a.com", "http://a.com/", self), false);
  assert.equal(PeekCore.matchesSource("a.com", "https://a.com:8443/", self), false);
  assert.equal(PeekCore.matchesSource("a.com:8443", "https://a.com:8443/", self), true);
  assert.equal(PeekCore.matchesSource("a.com:*", "https://a.com:8443/", self), true);
  assert.equal(PeekCore.matchesSource("a.com:443", "https://a.com/", self), true);
  assert.equal(PeekCore.matchesSource("http://a.com:80", "http://a.com/", self), true);
  assert.equal(PeekCore.matchesSource("a.com:8443", "https://a.com/", self), false);
  assert.equal(PeekCore.matchesSource("a.com/docs/", "https://a.com/docs/x", self), true);
  assert.equal(PeekCore.matchesSource("a.com/docs/", "https://a.com/blog", self), false);
  assert.equal(PeekCore.matchesSource("a.com/docs", "https://a.com/docs/x", self), false);
  assert.equal(PeekCore.matchesSource("a.com/docs/", "https://a.com/blog", self, true), true);
});

test("allowsParent: X-Frame-Options", () => {
  const xfo = (v) => ({ "x-frame-options": v });
  const url = "https://example.com/a";
  assert.equal(PeekCore.allowsParent(xfo("SAMEORIGIN"), url, "https://example.com/b"), true);
  assert.equal(PeekCore.allowsParent(xfo("sameorigin"), url, "https://www.example.com/"), false);
  assert.equal(PeekCore.allowsParent(xfo("SAMEORIGIN, sameorigin"), url, "https://example.com/"), true);
  assert.equal(PeekCore.allowsParent(xfo("SAMEORIGIN, DENY"), url, "https://example.com/"), false);
  assert.equal(PeekCore.allowsParent(xfo("DENY"), url, "https://example.com/"), false);
  assert.equal(PeekCore.allowsParent(xfo("ALLOWALL"), url, "https://other.com/"), true);
  assert.equal(PeekCore.allowsParent({}, url, "https://other.com/"), true);
});

test("allowsParent: frame-ancestors wins over X-Frame-Options", () => {
  const github = { "x-frame-options": "deny", "content-security-policy": GITHUB_CSP };
  assert.equal(PeekCore.allowsParent(github, "https://github.com/a", "https://github.com/"), false);

  const tiktok = { "x-frame-options": "SAMEORIGIN", "content-security-policy": TIKTOK_CSP };
  const video = "https://www.tiktok.com/@x/video/1";
  assert.equal(PeekCore.allowsParent(tiktok, video, "https://www.tiktok.com/explore"), true);
  assert.equal(PeekCore.allowsParent(tiktok, video, "https://tiktok.com/"), false);
  // Not same-origin, but listed: X-Frame-Options is ignored.
  assert.equal(PeekCore.allowsParent(tiktok, video, "https://tea-va.bytedance.net/"), true);

  const self = { "content-security-policy": "frame-ancestors 'self'" };
  assert.equal(PeekCore.allowsParent(self, "https://a.com/x", "https://a.com/y/z"), true);
  assert.equal(PeekCore.allowsParent(self, "https://a.com/x", "https://b.a.com/"), false);
});

test("allowsParent: every policy with frame-ancestors must allow the parent", () => {
  const headers = { "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" };
  assert.equal(PeekCore.allowsParent(headers, "https://a.com/", "https://a.com/"), false);
});

test("allowsFrame: the host page's frame-src, child-src, then default-src", () => {
  const page = "https://www.tiktok.com/explore";
  assert.equal(PeekCore.allowsFrame("", "https://a.com/", "https://a.com/"), true);
  assert.equal(PeekCore.allowsFrame("script-src 'self'", "https://a.com/", "https://a.com/"), true);
  assert.equal(PeekCore.allowsFrame(TIKTOK_CSP, "https://www.tiktok.com/@x", page), true);
  assert.equal(PeekCore.allowsFrame(GITHUB_CSP, "https://github.com/a", "https://github.com/"), false);
  assert.equal(PeekCore.allowsFrame("default-src 'self'", "https://a.com/x", "https://a.com/"), true);
  assert.equal(PeekCore.allowsFrame("default-src 'none'", "https://a.com/x", "https://a.com/"), false);
  assert.equal(
    PeekCore.allowsFrame("default-src 'none'; child-src 'self'", "https://a.com/x", "https://a.com/"),
    true
  );
  assert.equal(
    PeekCore.allowsFrame("frame-src 'self', frame-src other.com", "https://a.com/x", "https://a.com/"),
    false
  );
});

test("popupBounds: 90% wide, full height less a fixed gap, centered on the browser window", () => {
  const win = { left: 100, top: 50, width: 1600, height: 1000 };
  assert.deepEqual(PeekCore.popupBounds(win), { left: 180, top: 114, width: 1440, height: 872 });
});

test("popupBounds: no maximum, but a minimum size", () => {
  const huge = PeekCore.popupBounds({ left: 0, top: 0, width: 5000, height: 3000 });
  assert.deepEqual([huge.width, huge.height], [4500, 2872]);
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

test("clampSize: respects min and viewport", () => {
  const min = { width: 400, height: 300 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(PeekCore.clampSize({ width: 100, height: 100 }, min, viewport), { width: 400, height: 300 });
  assert.deepEqual(PeekCore.clampSize({ width: 5000, height: 5000 }, min, viewport), { width: 1200, height: 800 });
  assert.deepEqual(PeekCore.clampSize({ width: 600, height: 500 }, min, viewport), { width: 600, height: 500 });
  assert.deepEqual(PeekCore.clampSize({ width: 600, height: 500 }, min, { width: 300, height: 200 }), { width: 400, height: 300 });
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
