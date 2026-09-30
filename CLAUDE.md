# PeekPreview

macOS Safari Web Extension (MV3) that opens Shift+Clicked links in a peek overlay. Targets the Mac App Store.

## Layout

- `Extension/` — the web extension; **single source of truth**. The Xcode project references these
  files in place (no copies).
  - `lib/peek-core.js` — pure helpers (trigger detection, URL classification, framing check, popup bounds, theme,
    geometry). Plain script that sets `globalThis.PeekCore` and `module.exports`; loaded before
    `background.js` and `content.js`.
  - `background.js` — header check (overlay vs popup window), `windows.create`, `tabs.create`.
  - `content.js` / `content.css` — link interception and the overlay (closed shadow root,
    constructed stylesheet, inlined SVG icons, CSS-sized to the viewport).
  - `frame.html/js/css` — extension page that hosts the remote `<iframe>` inside the overlay.
  - `popup.html/js/css` — toolbar popup: Shift+Click reminder and a per-site on/off switch
    (`peek_disabled_sites` in `storage.local`, turned-off sites only; see `PeekCore.siteKey`).
- `PeekPreview/PeekPreview.xcodeproj` — container app (`PeekPreview/`, SwiftUI welcome window) and
  `PeekPreview Extension/` target.
- `PeekPreview/PeekPreview/AppIcon.icon` — Icon Composer icon.
- `Config/Shared.xcconfig` — bundle ID prefix, team, deployment target, version; overridden by
  git-ignored `Config/Local.xcconfig`.
- `tests/` — Node tests: `peek-core.js` logic and the Xcode project's `Extension/` wiring.
- `scripts/` — `export-icons.sh`; release helpers `bump-version.sh` and `project-version.sh`, each
  with a `.test.sh`.
- `.github/workflows/` — `ci.yml` (lint, tests, build + bundle-layout check) and `release.yml`
  (manual: archive, cloud-signed export, App Store Connect upload, tag, GitHub release).
- `release-notes/` — `next.md` is published by the next release, then archived as `<version>.md`.

## Commands

```sh
node --test tests/*.test.js
for t in scripts/*.test.sh; do "$t"; done
xcrun swift-format lint -s -p -r PeekPreview/   # uses .swift-format; `format -i -r` to fix
xcodebuild -project PeekPreview/PeekPreview.xcodeproj -scheme PeekPreview build
scripts/export-icons.sh   # re-render Extension/images/*.png from AppIcon.icon
```

## Rules

- Minimum Safari 27 (`browser_specific_settings.safari.strict_min_version`) and macOS 15.0
  (`MACOSX_DEPLOYMENT_TARGET` in `Config/Shared.xcconfig`). Don't add checks for older versions.
- Use the `browser.*` promise API, not `chrome.*` callbacks.
- Sites whose headers forbid framing (`PeekCore.blocksFraming`) open in a popup window, not the
  overlay. The exception is a link on the page's own origin that the site lets that page frame
  (`PeekCore.allowsParent`: `SAMEORIGIN`, or `frame-ancestors` matching the page, which overrides
  `X-Frame-Options`) and the page's `<meta>` CSP lets it frame (`PeekCore.allowsFrame`; the
  header CSP isn't re-fetched): its `<iframe>` goes straight into the shadow root instead of via
  `frame.html`, sandboxed without `allow-top-navigation`. If it doesn't load, the content script
  falls back to the popup via `peek:popup`.
- Don't reintroduce `declarativeNetRequest` header stripping: Safari 27 accepts `modifyHeaders`
  response-header rules (session or static) but doesn't apply them, and rejects the whole rule if
  any header name is unrecognised.
- Safari ignores `width/height/left/top` in `windows.create`, and on a site's first peek resizes
  the popup to fill the screen ~50 ms after it opens. `openPopup` creates it unfocused, re-applies
  the bounds until they hold, then focuses it — keep that sequence.
- No remote code and no third-party JS libraries (App Store review).
- All overlay UI lives inside the shadow root; nothing may style or leak into the host page.
  The one accepted gap: a same-origin in-page frame (and so the host page) can reach the overlay
  through `frameElement`; they're the same site.
- The Xcode project uses synchronized folders: new files in `PeekPreview/PeekPreview/`,
  `PeekPreview/PeekPreview Extension/` and the top level of `Extension/` are picked up
  automatically. Xcode flattens synchronized subfolders, so `Extension/lib`, `static`, `images`
  and `_locales` are folder references instead, and every file inside them must also be listed in
  the `Extension` folder's `membershipExceptions` in `project.pbxproj` (`tests/project.test.js`
  fails until it is). A new subfolder needs a folder reference plus exceptions, or Safari won't
  find its files. Web-accessible files also need an entry in `manifest.json`.
- The version lives in both `Config/Shared.xcconfig` (`MARKETING_VERSION`) and
  `Extension/manifest.json` (`version`) and must match; the release workflow bumps both via
  `scripts/project-version.sh`. Don't bump versions by hand.
- Put testable logic in `peek-core.js` with a test in `tests/`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): summary` in the imperative, lower case, no trailing period — types `feat`, `fix`,
  `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`; optional scopes
  `extension`, `app`, `project`, `icon`. Mark breaking changes with `!` or a `BREAKING CHANGE:`
  footer.

## Manual test checklist (Safari)

Shift+Click a link → overlay, not Reading List · github.com links open a centered popup window
80% as wide and 128 px shorter than the Safari window · on a site that sends
`X-Frame-Options: SAMEORIGIN`, a same-origin link opens in the overlay and a link to another
subdomain opens in the popup · on tiktok.com (`frame-ancestors` listing `www.tiktok.com`), a
same-origin link opens in the overlay · refresh / copy / theme persists / open-in-tab / Esc /
backdrop click · overlay is 32 px shorter than the page, 80% wide, centered, and follows Safari
window resizes · `t.co` link opens a tab · unreachable host shows the error card after 10 s ·
overlay works on a strict-CSP host page (e.g. github.com) · toolbar popup shows the reminder and a
switch for the current site; turned off, Shift+Click no longer opens a peek (no reload needed), and
turning it back on removes the site from `peek_disabled_sites`; on a Favorites page the switch is
disabled.
