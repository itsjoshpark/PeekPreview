// Guards the Xcode project's handling of Extension/.
// Extension/ is a synchronized folder (top-level files are picked up automatically), but Xcode
// flattens synchronized subfolders, so lib/, static/, images/ and _locales/ are folder references
// instead, and every file inside them must be listed in the synchronized folder's
// membershipExceptions. Otherwise it's also copied flat into the bundle root.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pbxproj = fs.readFileSync(
  path.join(root, "PeekPreview/PeekPreview.xcodeproj/project.pbxproj"),
  "utf8"
);
const FOLDER_REFERENCES = ["_locales", "images", "lib", "static"];

function extensionExceptions() {
  const block = pbxproj.match(
    /Exceptions for "Extension" folder[^{]*\{[^}]*?membershipExceptions = \(([^)]*)\)/
  );
  assert.ok(block, "Extension folder exception set not found");
  return block[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function filesUnder(dir) {
  return fs.readdirSync(path.join(root, "Extension", dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => path.relative(path.join(root, "Extension"), path.join(entry.parentPath, entry.name)));
}

test("every file in an Extension folder reference is excluded from the synchronized folder", () => {
  const exceptions = new Set(extensionExceptions());
  const missing = FOLDER_REFERENCES.flatMap(filesUnder).filter((file) => !exceptions.has(file));
  assert.deepEqual(missing, [], "add these to membershipExceptions in project.pbxproj");
});

test("every Extension folder reference exists in the project", () => {
  for (const dir of FOLDER_REFERENCES) {
    assert.match(pbxproj, new RegExp(`path = \\.\\./Extension/${dir};`), dir);
  }
});

test("exceptions don't list files that no longer exist", () => {
  const stale = extensionExceptions().filter((file) => !fs.existsSync(path.join(root, "Extension", file)));
  assert.deepEqual(stale, []);
});
