#!/usr/bin/env bash
#
# AR2-020 — Cross-platform install-verification harness (macOS / darwin).
#
# Proves that a fresh macOS runner (git + Homebrew-available tooling) can
# bootstrap Node 24 + pnpm@10.33.2, install the Arena 2.0 workspace at an
# EXACT pinned SHA and run the frozen install batteries:
#   pnpm install --frozen-lockfile -> pnpm typecheck -> pnpm lint ->
#   pnpm architecture:check ->
#   arena-contracts corpus -> arena-capsule corpus -> arena-harness smoke.
#
# Usage:
#   bash scripts/install-verify/verify-macos.sh [pinned-sha]
#
#     pinned-sha   optional; default is the AR2-020 mandated base SHA
#                  c9b86d199d9fe95180de0e817b9af4c0b2d0055b (a SHA this
#                  harness family was run against end to end on Linux; the
#                  macOS leg executes the identical battery).
#
# Environment overrides (all optional):
#   INSTALL_VERIFY_MODE=auto|in-place|fresh
#       auto (default): use the checkout the script runs inside when its HEAD
#                       equals the pinned SHA; otherwise fresh-clone at the
#                       pinned SHA into a temp dir.
#       in-place:       require the CWD checkout to be at the pinned SHA.
#       fresh:          always clone into a temp dir at the pinned SHA.
#   INSTALL_VERIFY_ORIGIN=<git-url-or-local-path>
#       Source used for fresh-clone mode. Default: the `origin` remote of the
#       repo the script runs inside, else
#       https://github.com/payswapdotorg/Arena-2.0.git
#   INSTALL_VERIFY_OUT=<dir>
#       Output directory for install-evidence.json + install-transcript.txt.
#       Default: the directory the script is invoked from.
#   INSTALL_VERIFY_KEEP=1
#       Keep the fresh-clone temp dir after the run (post-mortem).
#   INSTALL_VERIFY_DISPOSITION_<STEP>=fixed-in-commit|platform-limitation|not-supported
#       Operator classification for a failed step (STEP in caps, '-' -> '_').
#       Without an override failures are recorded as `unclassified` and must
#       be dispositioned in the evidence report (docs/evidence/install/).
#
# Contract (work order AR2-020 §3.1): every command is echoed to the
# transcript; each step records {name, command, exit_code, duration_ms,
# notes} plus node:test summaries where applicable; capability gaps are
# recorded as typed not_supported dispositions — never silently skipped;
# install-evidence.json (schema arena-install-evidence/1.0) is emitted at the
# end. Exit 0 = overall PASS, exit 1 = FAIL.
#
# Written for the macOS system bash 3.2 (no bash-4 constructs) so it runs
# unmodified on stock darwin runners and Homebrew bash alike. Self-contained
# by design (no sourcing, no repo-private absolute paths) so the TL-wired
# GitHub Actions runners can execute it unmodified on macos-latest.

set -u -o pipefail

PINNED_SHA="${1:-c9b86d199d9fe95180de0e817b9af4c0b2d0055b}"
MODE="${INSTALL_VERIFY_MODE:-auto}"
KEEP="${INSTALL_VERIFY_KEEP:-0}"

INVOCATION_DIR="$(pwd)"
OUT_DIR="${INSTALL_VERIFY_OUT:-$INVOCATION_DIR}"
mkdir -p "$OUT_DIR" 2>/dev/null || OUT_DIR="$INVOCATION_DIR"
TRANSCRIPT="$OUT_DIR/install-transcript.txt"
EVIDENCE_JSON="$OUT_DIR/install-evidence.json"
: > "$TRANSCRIPT" 2>/dev/null || TRANSCRIPT="/tmp/install-transcript.$$.txt"

TMP_DIR="$(mktemp -d /tmp/arena-install-verify.XXXXXX)" || exit 1
META_DIR="$TMP_DIR/meta"; mkdir -p "$META_DIR"
STEPS_TSV="$META_DIR/steps.tsv"; : > "$STEPS_TSV"
FAILURES_TSV="$META_DIR/failures.tsv"; : > "$FAILURES_TSV"
CAPABILITIES_TSV="$META_DIR/capabilities.tsv"; : > "$CAPABILITIES_TSV"
mkdir -p "$META_DIR/env"

STEP_TOTAL=11
STEP_INDEX=0
OVERALL="PASS"
SKIP_REST=0

log() { printf '%s\n' "$*" | tee -a "$TRANSCRIPT" 2>/dev/null || printf '%s\n' "$*"; }

now_ms() {
  # macOS BSD date has no %N — perl (always present on darwin) is the
  # millisecond source; GNU date is used when present.
  local t
  t="$(perl -MTime::HiRes -e 'printf("%d", Time::HiRes::time()*1000)' 2>/dev/null || true)"
  case "$t" in
    ''|*[!0-9]*) t="$(date +%s%3N 2>/dev/null || true)" ;;
  esac
  case "$t" in
    ''|*[!0-9]*) t="$(date +%s)000" ;;
  esac
  printf '%s' "$t"
}

iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

tsv_sanitize() { tr '\t\r\n' '   ' 2>/dev/null || cat; }

meta_write() { printf '%s\n' "$2" > "$META_DIR/$1" 2>/dev/null || true; }

append_step() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" >> "$STEPS_TSV"
}

record_failure() {
  # step \t disposition \t reason (only the reason field is sanitized; the
  # separators must survive)
  printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "$3" | tsv_sanitize)" >> "$FAILURES_TSV"
  OVERALL="FAIL"
}

record_capability() {
  # name \t status \t reason (only the reason field is sanitized)
  printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "$3" | tsv_sanitize)" >> "$CAPABILITIES_TSV"
}

summary_val() {
  local val
  val="$(sed -n "s/^[^0-9A-Za-z]*$2 \([0-9][0-9]*\)\$/\1/p" "$1" 2>/dev/null | tail -1)"
  printf '%s' "$val"
}

disposition_for() {
  local env_name="INSTALL_VERIFY_DISPOSITION_$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"
  local d
  d="$(printenv "$env_name" 2>/dev/null || true)"
  case "$d" in
    fixed-in-commit|platform-limitation|not-supported) printf '%s' "$d" ;;
    *) printf 'unclassified' ;;
  esac
}

run_step() {
  # run_step <name> <workdir> <command...>
  local name="$1" workdir="$2"; shift 2
  local cmd_str out_file start_ms end_ms dur exit_code
  local t_pass="" t_fail="" t_cancelled="" t_skipped="" notes=""
  cmd_str="$*"
  out_file="$TMP_DIR/step-$name.out"
  STEP_INDEX=$((STEP_INDEX + 1))
  log ""
  log "### STEP $STEP_INDEX/$STEP_TOTAL: $name"
  if [ "$workdir" != "." ]; then log "\$ cd $workdir"; fi
  log "\$ $cmd_str"
  if [ "$SKIP_REST" = "1" ]; then
    log "### SKIPPED (prior chain failure) exit=- duration_ms=0"
    append_step "$name" "$cmd_str" "-1" "0" "skipped (prior chain failure)" "" "" "" ""
    return 0
  fi
  start_ms="$(now_ms)"
  ( cd "$workdir" && "$@" ) > "$out_file" 2>&1
  exit_code=$?
  end_ms="$(now_ms)"
  dur=$(( end_ms - start_ms ))
  tee -a "$TRANSCRIPT" < "$out_file" 2>/dev/null || cat "$out_file"
  log "### exit=$exit_code duration_ms=$dur"
  t_pass="$(summary_val "$out_file" pass)"
  t_fail="$(summary_val "$out_file" fail)"
  t_cancelled="$(summary_val "$out_file" cancelled)"
  t_skipped="$(summary_val "$out_file" skipped)"
  case "$name" in
    contracts-corpus|capsule-corpus|harness-smoke)
      notes="node:test summary: tests=$(summary_val "$out_file" tests) pass=${t_pass:-?} fail=${t_fail:-?}"
      ;;
    install)
      local warn_lines done_line
      warn_lines="$(grep -ci 'warn' "$out_file" 2>/dev/null || echo 0)"
      done_line="$(grep -E '^Done in ' "$out_file" 2>/dev/null | tail -1 | tsv_sanitize)"
      notes="pnpm summary: ${done_line:-<no Done line>}; lines matching /warn/i: $warn_lines; node_modules pre-existed: ${MODULES_PREEXISTED:-n/a}"
      ;;
    lint)
      notes="$(grep -E 'Found [0-9]+ warnings? and [0-9]+ errors?' "$out_file" 2>/dev/null | tail -1 | tsv_sanitize)"
      ;;
    architecture-check)
      notes="$(grep -E '^(architecture|violations|baseline|new):' "$out_file" 2>/dev/null | tr '\n' ';' | tsv_sanitize)"
      ;;
  esac
  append_step "$name" "$cmd_str" "$exit_code" "$dur" "$notes" "$t_pass" "$t_fail" "$t_cancelled" "$t_skipped"
  if [ "$exit_code" != "0" ]; then
    record_failure "$name" "$(disposition_for "$name")" "exit_code=$exit_code (see install-transcript.txt for full output)"
    case "$name" in
      env|bootstrap|resolve-source|install) SKIP_REST=1 ;;
    esac
  fi
}

record_only_step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  append_step "$1" "$2" "$3" "$4" "$5" "" "" "" ""
}

corpus_drift_note() {
  local dir="$1"; shift
  [ "$SKIP_REST" = "1" ] && return 0
  local found frozen
  found="$(ls "$REPO_DIR/$dir"/test/*.test.ts 2>/dev/null | xargs -n1 basename 2>/dev/null | sort | tr '\n' ' ' | tsv_sanitize)"
  frozen="$(printf '%s ' "$@" | tsv_sanitize)"
  if [ "$found" != "$frozen" ]; then
    log "### NOTE corpus drift: test/*.test.ts at pinned SHA = [$found] vs frozen harness corpus [$frozen] — harness corpus frozen per AR2-020; re-freeze requires the owning work order"
  fi
}

log "================================================================================"
log "AR2-020 install-verification harness — macOS"
log "pinned_sha=$PINNED_SHA mode=$MODE started=$(iso_now)"
log "invocation_dir=$INVOCATION_DIR out_dir=$OUT_DIR"
log "================================================================================"

# ---------------------------------------------------------------- STEP 1: env
ENV_CMD="(environment capture: sw_vers, uname, arch, shell, tools, cpu/mem/disk)"
log ""
log "### STEP 1/$STEP_TOTAL: env"
log "\$ $ENV_CMD"
start_ms="$(now_ms)"
{
  echo "uname -a: $(uname -a 2>/dev/null)"
  echo "kernel: $(uname -s 2>/dev/null) $(uname -r 2>/dev/null)"
  echo "arch: $(uname -m 2>/dev/null)"
  echo "shell: $SHELL (bash $(bash --version 2>/dev/null | head -1 | sed 's/,.*//'))"
  echo "sw_vers productName: $(sw_vers -productName 2>/dev/null || echo unavailable)"
  echo "sw_vers productVersion: $(sw_vers -productVersion 2>/dev/null || echo unavailable)"
  echo "sw_vers buildVersion: $(sw_vers -buildVersion 2>/dev/null || echo unavailable)"
  echo "cpu: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
  echo "cpu_count: $(sysctl -n hw.ncpu 2>/dev/null || echo unknown)"
  echo "mem_total: $(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GiB", $1/1073741824}' || echo unknown)"
  echo "disk_free: $(df -h . 2>/dev/null | tail -1 | awk '{print $4 " free on " $9}')"
  echo "brew: $(brew --version 2>/dev/null | head -1 || echo absent)"
  echo "node: $(node --version 2>/dev/null || echo absent)"
  echo "pnpm: $(pnpm --version 2>/dev/null || echo absent)"
  echo "git: $(git --version 2>/dev/null || echo absent)"
} 2>&1 | tee -a "$TRANSCRIPT"
env_exit=$?
end_ms="$(now_ms)"
meta_write platform "darwin"
meta_write platform_label "macOS $(sw_vers -productVersion 2>/dev/null || echo unknown) $(uname -m 2>/dev/null) ($(sw_vers -productName 2>/dev/null || echo macOS))"
meta_write os_name "$(sw_vers -productName 2>/dev/null || echo macOS)"
meta_write os_version "$(sw_vers -productVersion 2>/dev/null || echo unknown) build $(sw_vers -buildVersion 2>/dev/null || echo unknown)"
meta_write os_arch "$(uname -m 2>/dev/null)"
meta_write os_kernel "$(uname -s 2>/dev/null) $(uname -r 2>/dev/null)"
meta_write shell "bash"
meta_write cpu_count "$(sysctl -n hw.ncpu 2>/dev/null || echo unknown)"
meta_write mem_total "$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GiB", $1/1073741824}' || echo unknown)"
meta_write disk_free "$(df -h . 2>/dev/null | tail -1 | awk '{print $4 " free on " $9}')"
meta_write generated_at "$(iso_now)"
log "### exit=$env_exit duration_ms=$(( end_ms - start_ms ))"
record_only_step "env" "$ENV_CMD" "$env_exit" "$(( end_ms - start_ms ))" "see transcript environment block"
if [ "$env_exit" != "0" ]; then record_failure "env" "$(disposition_for env)" "environment capture failed"; fi

# ---------------------------------------------------------- STEP 2: bootstrap
BOOT_START_MS="$(now_ms)"
# Self-bootstrap Node 24 + pnpm@10.33.2 (fresh-runner contract). Node via
# Homebrew (keg-only node@24 needs PATH additions on both bottle prefixes),
# pnpm via npm. Every bootstrap command is recorded verbatim.
BOOTSTRAP_CMDS=""
BOOTSTRAP_NOTES=""
BOOTSTRAP_EXIT=0
node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0'
}
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 24 ]; then
  BOOTSTRAP_NOTES="node $(node --version 2>/dev/null) already present (>=24) — no node bootstrap required"
  BOOTSTRAP_CMDS="(none — node $(node --version 2>/dev/null) present)"
else
  log ""
  log "### node >=24 absent — bootstrap via Homebrew"
  if command -v brew >/dev/null 2>&1; then
    BOOTSTRAP_CMDS="brew install node@24 && export PATH=\"/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:\$PATH\""
    log "\$ brew install node@24"
    if brew install node@24 > "$TMP_DIR/step-bootstrap-node.out" 2>&1; then
      tee -a "$TRANSCRIPT" < "$TMP_DIR/step-bootstrap-node.out"
      export PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:$PATH"
      log "\$ export PATH=\"/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:\$PATH\""
    else
      tee -a "$TRANSCRIPT" < "$TMP_DIR/step-bootstrap-node.out"
      BOOTSTRAP_NOTES="node bootstrap FAILED (brew install node@24)"
      BOOTSTRAP_EXIT=1
    fi
  else
    BOOTSTRAP_NOTES="node >=24 absent and Homebrew not available — cannot bootstrap (runner contract requires git + Homebrew-available tooling; TL-wired CI provisions Node 24 via actions/setup-node)"
    BOOTSTRAP_EXIT=1
  fi
fi
meta_write node_version "$(node --version 2>/dev/null || echo absent)"
meta_write git_version "$(git --version 2>/dev/null | awk '{print $3}')"
PNPM_BOOT_CMD=""
if [ "$(pnpm --version 2>/dev/null || echo absent)" != "10.33.2" ]; then
  PNPM_BOOT_CMD="npm install -g pnpm@10.33.2"
  log ""
  log "\$ $PNPM_BOOT_CMD"
  if npm install -g pnpm@10.33.2 > "$TMP_DIR/step-bootstrap-pnpm.out" 2>&1; then
    tee -a "$TRANSCRIPT" < "$TMP_DIR/step-bootstrap-pnpm.out"
  else
    tee -a "$TRANSCRIPT" < "$TMP_DIR/step-bootstrap-pnpm.out"
    BOOTSTRAP_NOTES="$BOOTSTRAP_NOTES; pnpm bootstrap FAILED"
    BOOTSTRAP_EXIT=1
  fi
else
  BOOTSTRAP_NOTES="$BOOTSTRAP_NOTES; pnpm $(pnpm --version 2>/dev/null) already pinned — no pnpm bootstrap required"
  PNPM_BOOT_CMD="(none — pnpm $(pnpm --version 2>/dev/null) present)"
fi
meta_write pnpm_version "$(pnpm --version 2>/dev/null || echo absent)"
meta_write tsx_version "resolved at install via workspace devDependency tsx@^4.19.4 (root package.json)"
meta_write bootstrap_commands "node: $BOOTSTRAP_CMDS
pnpm: $PNPM_BOOT_CMD"
STEP_INDEX=$((STEP_INDEX + 1))
log ""
log "### STEP 2/$STEP_TOTAL: bootstrap — node=$(node --version 2>/dev/null || echo absent) pnpm=$(pnpm --version 2>/dev/null || echo absent) git=$(git --version 2>/dev/null | awk '{print $3}')"
append_step "bootstrap" "ensure node>=24 + pnpm@10.33.2 ($BOOTSTRAP_CMDS; $PNPM_BOOT_CMD)" "$BOOTSTRAP_EXIT" "$(( $(now_ms) - BOOT_START_MS ))" "$BOOTSTRAP_NOTES" "" "" "" ""
if [ "$BOOTSTRAP_EXIT" != "0" ]; then
  record_failure "bootstrap" "$(disposition_for bootstrap)" "$BOOTSTRAP_NOTES"
  SKIP_REST=1
fi

# ---------------------------------------------------- STEP 3: resolve-source
ORIGIN_DEFAULT="$(git -C "$INVOCATION_DIR" remote get-url origin 2>/dev/null || true)"
[ -n "$ORIGIN_DEFAULT" ] || ORIGIN_DEFAULT="https://github.com/payswapdotorg/Arena-2.0.git"
ORIGIN="${INSTALL_VERIFY_ORIGIN:-$ORIGIN_DEFAULT}"
RESOLVE_EXIT=0
RESOLVE_NOTES=""
if [ "$SKIP_REST" = "1" ]; then
  REPO_DIR="$INVOCATION_DIR"
  RESOLVE_NOTES="skipped (bootstrap failure)"
  STEP_INDEX=$((STEP_INDEX + 1))
  append_step "resolve-source" "skipped" "-1" "0" "$RESOLVE_NOTES" "" "" "" ""
else
  log ""
  log "### STEP 3/$STEP_TOTAL: resolve-source (pinned_sha=$PINNED_SHA mode=$MODE origin=$ORIGIN)"
  CWD_SHA="$(git -C "$INVOCATION_DIR" rev-parse HEAD 2>/dev/null || true)"
  CWD_IS_REPO=0
  [ -n "$CWD_SHA" ] && CWD_IS_REPO=1
  USE_INPLACE=0
  if [ "$MODE" = "in-place" ]; then
    if [ "$CWD_IS_REPO" = "1" ] && [ "$CWD_SHA" = "$PINNED_SHA" ]; then
      USE_INPLACE=1
    else
      RESOLVE_EXIT=1
      RESOLVE_NOTES="mode=in-place forced but CWD HEAD (${CWD_SHA:-not-a-repo}) != pinned SHA"
    fi
  elif [ "$MODE" = "fresh" ]; then
    USE_INPLACE=0
  else
    if [ "$CWD_IS_REPO" = "1" ] && [ "$CWD_SHA" = "$PINNED_SHA" ]; then
      USE_INPLACE=1
    else
      USE_INPLACE=0
    fi
  fi
  start_ms="$(now_ms)"
  if [ "$RESOLVE_EXIT" = "0" ]; then
    if [ "$USE_INPLACE" = "1" ]; then
      REPO_DIR="$INVOCATION_DIR"
      DIRTY="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
      if [ "$DIRTY" = "0" ]; then
        RESOLVE_NOTES="in-place checkout at pinned SHA; working tree clean"
      else
        RESOLVE_NOTES="in-place checkout at pinned SHA; WARNING: $DIRTY uncommitted path(s) present (recorded repo_clean=false)"
      fi
      log "\$ git -C . rev-parse HEAD  # => $PINNED_SHA (in-place)"
      log "### resolve: in-place at $PINNED_SHA ($RESOLVE_NOTES)"
    else
      REPO_DIR="$TMP_DIR/arena"
      log "\$ git clone --quiet $ORIGIN $REPO_DIR && git -C $REPO_DIR checkout $PINNED_SHA"
      if git clone --quiet "$ORIGIN" "$REPO_DIR" > "$TMP_DIR/step-resolve.out" 2>&1 \
         && git -C "$REPO_DIR" checkout --quiet "$PINNED_SHA" >> "$TMP_DIR/step-resolve.out" 2>&1; then
        GOT_SHA="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null)"
        if [ "$GOT_SHA" = "$PINNED_SHA" ]; then
          RESOLVE_NOTES="fresh clone from $ORIGIN at pinned SHA $PINNED_SHA (verified rev-parse HEAD)"
        else
          RESOLVE_EXIT=1
          RESOLVE_NOTES="fresh clone HEAD $GOT_SHA != pinned $PINNED_SHA"
        fi
        cat "$TMP_DIR/step-resolve.out" | tee -a "$TRANSCRIPT"
      else
        cat "$TMP_DIR/step-resolve.out" | tee -a "$TRANSCRIPT"
        RESOLVE_EXIT=1
        RESOLVE_NOTES="git clone/checkout failed for origin=$ORIGIN sha=$PINNED_SHA"
      fi
    fi
  else
    REPO_DIR="$INVOCATION_DIR"
  fi
  end_ms="$(now_ms)"
  log "### exit=$RESOLVE_EXIT duration_ms=$(( end_ms - start_ms ))"
  STEP_INDEX=$((STEP_INDEX + 1))
  if [ "$USE_INPLACE" = "1" ]; then
    meta_write source_mode "in-place-checkout"
    meta_write repo_clean "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ' | sed 's/^0$/true/;s/^[1-9].*/false/')"
  else
    meta_write source_mode "fresh-clone"
    meta_write repo_clean "true"
  fi
  meta_write origin "$ORIGIN"
  meta_write pinned_sha "$PINNED_SHA"
  append_step "resolve-source" "git clone $ORIGIN && git checkout $PINNED_SHA (or in-place checkout at same SHA)" "$RESOLVE_EXIT" "$(( end_ms - start_ms ))" "$RESOLVE_NOTES" "" "" "" ""
  if [ "$RESOLVE_EXIT" != "0" ]; then
    record_failure "resolve-source" "$(disposition_for resolve-source)" "$RESOLVE_NOTES"
    SKIP_REST=1
  fi
fi
[ -n "${REPO_DIR:-}" ] || REPO_DIR="$INVOCATION_DIR"

# -------------------------------------------------- STEP 4: install (frozen)
MODULES_PREEXISTED="no"
[ -d "$REPO_DIR/node_modules" ] && MODULES_PREEXISTED="yes"
run_step "install" "$REPO_DIR" pnpm install --frozen-lockfile

# ------------------------------------------------------------- STEP 5-7: gates
run_step "typecheck" "$REPO_DIR" pnpm typecheck
run_step "lint" "$REPO_DIR" pnpm lint
run_step "architecture-check" "$REPO_DIR" pnpm architecture:check

# ------------------------------------------------- STEP 8: contracts corpus
corpus_drift_note "packages/arena-contracts" vectors.test.ts transitions.test.ts completeness.test.ts ownership.test.ts contracts.test.ts
run_step "contracts-corpus" "$REPO_DIR/packages/arena-contracts" ../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts

# --------------------------------------------------- STEP 9: capsule corpus
corpus_drift_note "packages/arena-capsule" capsule.test.ts synthetic-provider.test.ts
run_step "capsule-corpus" "$REPO_DIR/packages/arena-capsule" ../../node_modules/.bin/tsx --test test/capsule.test.ts test/synthetic-provider.test.ts

# -------------------------------------------------- STEP 10: harness smoke
corpus_drift_note "packages/arena-harness" vertical-p0.test.ts next-expert.test.ts p2-review.test.ts two-instance-recovery.test.ts
run_step "harness-smoke" "$REPO_DIR/packages/arena-harness" ../../node_modules/.bin/tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts

# --------------------------------- STEP 11: isolation-runtime probe (typed)
log ""
log "### STEP 11/$STEP_TOTAL: isolation-runtime-probe"
log "\$ (probe) AR2-019 OS-level capsule isolation runtime is registered Linux-only (bwrap); no equivalent runtime exists on darwin at pinned SHA"
log "### probe: not_supported — AR2-019 bwrap-based isolation runtime is Linux-only; macOS has no bwrap; recorded as typed not_supported (never a silent skip)"
record_capability "os-level-isolation-runtime" "not_supported" "AR2-019 OS-level capsule isolation runtime is registered Linux-only (bwrap); no bwrap equivalent on darwin at pinned SHA $PINNED_SHA"
STEP_INDEX=$((STEP_INDEX + 1))
append_step "isolation-runtime-probe" "(typed probe — AR2-019 isolation runtime is Linux-only)" "0" "0" "not_supported on darwin; see capabilities[] in install-evidence.json" "" "" "" ""

# ------------------------------------------------------- emit JSON evidence
meta_write overall "$OVERALL"
cat > "$TMP_DIR/assembler.cjs" <<'ASSEMBLER_EOF'
"use strict";
const fs = require("fs");
const path = require("path");
const metaDir = process.argv[2];
const outFile = process.argv[3];
const read = (n, d) => { try { return fs.readFileSync(path.join(metaDir, n), "utf8").trim(); } catch { return d === undefined ? "" : d; } };
const lines = (n) => { try { return fs.readFileSync(path.join(metaDir, n), "utf8").split("\n").map((s) => s.trim()).filter((s) => s.length > 0); } catch { return []; } };
const tsv = (n) => lines(n).map((l) => l.split("\t"));
const num = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);
const steps = tsv("steps.tsv").map((f) => {
  const step = { name: f[0], command: f[1], exit_code: num(f[2]), duration_ms: num(f[3]), notes: f[4] || "" };
  if (f[5] !== undefined && f[5] !== "") {
    step.tests = { pass: num(f[5]), fail: num(f[6]), cancelled: num(f[7]), skipped: num(f[8]) };
  }
  return step;
});
const failures = tsv("failures.tsv").map((f) => ({ step: f[0], disposition: f[1], reason: f[2] }));
const capabilities = tsv("capabilities.tsv").map((f) => ({ name: f[0], status: f[1], reason: f[2] }));
const evidence = {
  schema: "arena-install-evidence/1.0",
  work_order: "AR2-020",
  harness: "scripts/install-verify/verify-macos.sh",
  platform: read("platform"),
  platform_label: read("platform_label"),
  os: {
    name: read("os_name"),
    version: read("os_version"),
    arch: read("os_arch"),
    kernel: read("os_kernel"),
    shell: read("shell"),
  },
  resources: { cpu_count: read("cpu_count"), mem_total: read("mem_total"), disk_free: read("disk_free") },
  pinned_sha: read("pinned_sha"),
  source_mode: read("source_mode"),
  origin: read("origin"),
  repo_clean: read("repo_clean", "unknown"),
  tools: {
    node: read("node_version"),
    pnpm: read("pnpm_version"),
    git: read("git_version"),
    tsx: read("tsx_version"),
  },
  bootstrap: { commands: read("bootstrap_commands"), notes: read("bootstrap_notes") },
  steps,
  capabilities,
  failures,
  verdict: { overall: read("overall"), generated_at: read("generated_at") },
};
fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2) + "\n");
console.log("install-evidence.json written to " + outFile);
ASSEMBLER_EOF
if command -v node >/dev/null 2>&1; then
  node "$TMP_DIR/assembler.cjs" "$META_DIR" "$EVIDENCE_JSON" | tee -a "$TRANSCRIPT"
else
  printf '{"schema":"arena-install-evidence/1.0","work_order":"AR2-020","platform":"darwin","pinned_sha":"%s","verdict":{"overall":"FAIL","generated_at":"%s"},"failures":[{"step":"bootstrap","disposition":"platform-limitation","reason":"node unavailable — no battery could run"}]}\n' "$PINNED_SHA" "$(iso_now)" > "$EVIDENCE_JSON"
  log "install-evidence.json (minimal fallback) written to $EVIDENCE_JSON"
fi

log ""
log "================================================================================"
log "AR2-020 macOS install verification: $OVERALL"
log "transcript: $TRANSCRIPT"
log "evidence:   $EVIDENCE_JSON"
log "================================================================================"

if [ "$KEEP" = "1" ]; then
  log "KEEP=1 — fresh-clone workdir retained at $TMP_DIR"
else
  rm -rf "$TMP_DIR" 2>/dev/null || true
fi
[ "$OVERALL" = "PASS" ] && exit 0 || exit 1
