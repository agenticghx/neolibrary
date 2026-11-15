#!/bin/sh
# Runs TLC, the TLA+ model checker, at pinned versions (TLC 1.7.4, Java Temurin 25), for the formal checks in
# .claude/skills/verify-*/. Usage: sh scripts/tlc.sh <Spec.tla> [Spec.cfg] [more TLC options]
# The config defaults to the spec's name with .cfg. Exit 0: every rule holds; TLC's own codes otherwise
# (12 a rule broken, 11 a deadlock, 13 a property broken, 150+ the model itself is wrong).
# Needs mise (brew install mise); the first run downloads Java and TLC (checked against TLC's sha256).
set -eu
TLC_TOOL='http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4'
JAVA_TOOL='java@temurin-25'
command -v mise >/dev/null || { echo "scripts/tlc.sh needs mise: brew install mise" >&2; exit 127; }
[ $# -ge 1 ] || { echo "usage: sh scripts/tlc.sh <Spec.tla> [Spec.cfg] [more TLC options]" >&2; exit 2; }
spec=$1
shift
cfg=${spec%.tla}.cfg
case ${1:-} in *.cfg) cfg=$1; shift ;; esac
mise install --quiet "$JAVA_TOOL" "$TLC_TOOL" >/dev/null
jar="$(mise where "$TLC_TOOL")/tla2tools.jar"
java="$(mise where "$JAVA_TOOL")/bin/java"
[ -x "$java" ] || java="$(mise where "$JAVA_TOOL")/Contents/Home/bin/java"
meta=$(mktemp -d "${TMPDIR:-/tmp}/tlc.XXXXXX")
trap 'rm -r "$meta"' EXIT
cd "$(dirname "$spec")"
"$java" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 -fp 0 -metadir "$meta" -config "$(basename "$cfg")" "$(basename "$spec")" "$@"
