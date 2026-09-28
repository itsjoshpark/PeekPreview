#!/bin/bash
# Reads and writes PeekPreview's version, which lives in two places that must agree:
# Config/Shared.xcconfig (app + extension bundles) and Extension/manifest.json (Safari).
#
#   project-version.sh read  Config/Shared.xcconfig Extension/manifest.json
#   project-version.sh write Config/Shared.xcconfig Extension/manifest.json 1.2.0 57
#
# Each setting must appear exactly once; anything else means the files no longer
# match what this assumes, and writing would be a guess.

set -euo pipefail

die() {
  echo "project-version: $1" >&2
  exit 1
}

xcconfig_line() {
  local xcconfig="$1" setting="$2"
  local count
  count="$(grep -c "^$setting = " "$xcconfig" || true)"
  (( count == 1 )) || die "expected 1 $setting in $xcconfig, found $count"
}

manifest_line() {
  local manifest="$1"
  local count
  count="$(grep -c '^  "version": "[^"]*",$' "$manifest" || true)"
  (( count == 1 )) || die "expected 1 top-level \"version\" line in $manifest, found $count"
}

read_version() {
  local xcconfig="$1" manifest="$2"
  xcconfig_line "$xcconfig" MARKETING_VERSION
  manifest_line "$manifest"

  local marketing extension
  marketing="$(sed -n 's/^MARKETING_VERSION = \(.*\)$/\1/p' "$xcconfig")"
  extension="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$manifest")"
  [[ "$marketing" == "$extension" ]] ||
    die "$xcconfig has $marketing but $manifest has $extension — they must match"
  echo "$marketing"
}

command="${1-}"
xcconfig="${2-}"
manifest="${3-}"

case "$command" in
  read | write)
    [[ -f "$xcconfig" ]] || die "xcconfig not found: $xcconfig"
    [[ -f "$manifest" ]] || die "manifest not found: $manifest"
    ;;
  "") die "a command is required (read or write)" ;;
  *) die "unknown command '$command'" ;;
esac

case "$command" in
  read)
    read_version "$xcconfig" "$manifest"
    ;;

  write)
    marketing="${4-}"
    build="${5-}"
    [[ "$marketing" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
      die "marketing version must be X.Y.Z, got '$marketing'"
    [[ "$build" =~ ^[0-9]+$ ]] || die "build number must be a whole number, got '$build'"

    xcconfig_line "$xcconfig" MARKETING_VERSION
    xcconfig_line "$xcconfig" CURRENT_PROJECT_VERSION
    manifest_line "$manifest"

    # Write to temp files and move both into place only once both succeed, so a
    # failure cannot leave the two out of step.
    xc_tmp="$(mktemp)"
    manifest_tmp="$(mktemp)"
    trap 'rm -f "$xc_tmp" "$manifest_tmp"' EXIT

    sed -e "s/^MARKETING_VERSION = .*$/MARKETING_VERSION = $marketing/" \
      -e "s/^CURRENT_PROJECT_VERSION = .*$/CURRENT_PROJECT_VERSION = $build/" \
      "$xcconfig" >"$xc_tmp"
    sed -e "s/^  \"version\": \"[^\"]*\",$/  \"version\": \"$marketing\",/" "$manifest" >"$manifest_tmp"

    mv "$xc_tmp" "$xcconfig"
    mv "$manifest_tmp" "$manifest"
    trap - EXIT

    echo "Set $xcconfig and $manifest to $marketing ($build)"
    ;;
esac
