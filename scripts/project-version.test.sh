#!/bin/bash
# Tests for project-version.sh. Run directly: ./scripts/project-version.test.sh

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tool="$script_dir/project-version.sh"

failures=0
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

check() {
  if [[ "$2" == "pass" ]]; then
    echo "ok       $1"
  else
    echo "FAIL     $1"
    failures=$((failures + 1))
  fi
}

expect_equal() {
  local got="$1" want="$2" description="$3"
  if [[ "$got" == "$want" ]]; then
    check "$description" pass
  else
    check "$description (got '$got', want '$want')" fail
  fi
}

expect_failure() {
  local description="$1"
  shift
  if "$tool" "$@" >/dev/null 2>&1; then
    check "$description" fail
  else
    check "$description" pass
  fi
}

# Mirrors the real files: versions in the shared xcconfig and the manifest.
make_fixtures() {
  cat >"$workdir/Shared.xcconfig" <<'XC'
PEEK_BUNDLE_ID_PREFIX = dev.joshuapark
MACOSX_DEPLOYMENT_TARGET = 15.0

MARKETING_VERSION = 1.4.0
CURRENT_PROJECT_VERSION = 12

#include? "Local.xcconfig"
XC
  cat >"$workdir/manifest.json" <<'JSON'
{
  "manifest_version": 3,
  "name": "__MSG_extension_name__",
  "version": "1.4.0",
  "permissions": [
    "storage"
  ]
}
JSON
}

xc="$workdir/Shared.xcconfig"
manifest="$workdir/manifest.json"
make_fixtures

# --- read -------------------------------------------------------------------
expect_equal "$("$tool" read "$xc" "$manifest")" "1.4.0" "reads the marketing version"

# --- write ------------------------------------------------------------------
if "$tool" write "$xc" "$manifest" 1.5.0 40 >/dev/null 2>&1; then
  check "exits zero on write" pass
else
  check "exits zero on write" fail
fi
expect_equal "$("$tool" read "$xc" "$manifest")" "1.5.0" "writes the marketing version"
expect_equal "$(grep -c '^MARKETING_VERSION = 1.5.0$' "$xc")" "1" "updates MARKETING_VERSION"
expect_equal "$(grep -c '^CURRENT_PROJECT_VERSION = 40$' "$xc")" "1" "updates CURRENT_PROJECT_VERSION"
expect_equal "$(grep -c '"version": "1.5.0",' "$manifest")" "1" "updates the manifest version"
expect_equal "$(grep -c '"manifest_version": 3,' "$manifest")" "1" "leaves manifest_version alone"
expect_equal "$(grep -c 'PEEK_BUNDLE_ID_PREFIX' "$xc")" "1" "leaves neighbouring settings alone"
if python3 -m json.tool "$manifest" >/dev/null 2>&1; then
  check "manifest is still valid JSON" pass
else
  check "manifest is still valid JSON" fail
fi

# --- guards -----------------------------------------------------------------
make_fixtures
expect_failure "rejects a missing xcconfig" read "$workdir/nope.xcconfig" "$manifest"
expect_failure "rejects a missing manifest" read "$xc" "$workdir/nope.json"

# The two must agree, or the extension would ship with a different version than the app.
sed -i '' 's/"version": "1.4.0"/"version": "1.3.0"/' "$manifest"
expect_failure "rejects a manifest version that differs from the xcconfig" read "$xc" "$manifest"

make_fixtures
printf 'MARKETING_VERSION = 1.4.0\nMARKETING_VERSION = 1.4.0\nCURRENT_PROJECT_VERSION = 1\n' >"$xc"
expect_failure "rejects a duplicated MARKETING_VERSION" read "$xc" "$manifest"
expect_failure "refuses to write when MARKETING_VERSION is duplicated" write "$xc" "$manifest" 1.5.0 40

make_fixtures
for bad in "" "1.5" "1.5.0;" "1.5.0 extra" "01.5.0"; do
  expect_failure "rejects marketing version '$bad'" write "$xc" "$manifest" "$bad" 40
done
for bad in "" "abc" "4.0" "-1"; do
  expect_failure "rejects build number '$bad'" write "$xc" "$manifest" 1.5.0 "$bad"
done
expect_equal "$("$tool" read "$xc" "$manifest")" "1.4.0" "leaves files untouched when validation fails"

# The real files, which is what a release reads.
root="$script_dir/.."
if "$tool" read "$root/Config/Shared.xcconfig" "$root/Extension/manifest.json" >/dev/null 2>&1; then
  check "reads the real project" pass
else
  check "reads the real project" fail
fi

echo
if (( failures > 0 )); then
  echo "$failures test(s) failed"
  exit 1
fi
echo "all tests passed"
