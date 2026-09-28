# PeekPreview

Preview links in an overlay with **Shift+Click** in Safari, without leaving the page — a Safari port
of [BerryPeek](https://github.com/Kain-90/BerryPeek), inspired by Arc's Peek.

Requires **Safari 27** or later (macOS 15 Sequoia or later).

## Features

- Shift+Click (or Shift+middle-click) any link to open it in an overlay.
- Refresh, copy link, and Auto / Light / Dark theme in the header.
- Open in a new tab or close (Esc, or click outside) from the side buttons.
- Drag the window by its header; resize from any edge or corner.
- Sites that forbid embedding (GitHub, many news and login-protected sites) open in a peek-sized
  popup window instead; close it with ⌘W.

## Build and run

1. Optional: copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig` and set your
   `DEVELOPMENT_TEAM`.
2. Open `PeekPreview/PeekPreview.xcodeproj` in Xcode 26.3 or later and run the **PeekPreview**
   scheme.
3. In Safari: **Settings → Advanced → Show features for web developers**, then
   **Develop → Developer Settings… → Allow unsigned extensions** (only needed for unsigned local
   builds).
4. **Safari Settings → Extensions**: turn on PeekPreview and allow it on **All Websites**.

## Development

| Path | What |
| --- | --- |
| `Extension/` | Web extension source (manifest, background, content script, overlay frame) |
| `Extension/lib/peek-core.js` | Pure logic shared by the scripts, unit tested |
| `PeekPreview/` | Xcode project: container app + Safari extension target |
| `PeekPreview/PeekPreview/AppIcon.icon` | App icon — open in Icon Composer |
| `Config/Shared.xcconfig` | Bundle ID prefix, team, deployment target, version |

```sh
node --test tests/*.test.js      # unit tests
scripts/export-icons.sh          # after editing AppIcon.icon: re-export the extension PNGs
xcodebuild -project PeekPreview/PeekPreview.xcodeproj -scheme PeekPreview build
```

## Notes

- Shift+Click normally adds a link to Safari's Reading List; PeekPreview replaces that on links
  it previews.
- Safari doesn't apply `declarativeNetRequest` rules that remove response headers such as
  `X-Frame-Options` (tested on Safari 27), so blocked sites can't be forced into the overlay.
- Some sites detect being framed with JavaScript or block cookies in third-party frames, so they
  may not work fully in the overlay — use **Open in new tab**.

## License

GPL-3.0 — see [LICENSE](LICENSE). Portions derived from BerryPeek are MIT-licensed — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Privacy: [PRIVACY.md](PRIVACY.md).
