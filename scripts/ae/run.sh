#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AE_FRAMEWORK_DIR="${AE_FRAMEWORK_DIR:-$PROJECT_ROOT/../ae-framework}"
AE_FRAMEWORK_REF_FILE="$PROJECT_ROOT/configs/ae-framework/ref.txt"
PROFILE="${1:-full}"
RUN_ID="${RUN_ID:-$(date -u +%Y-%m-%d)-${PROFILE}}"
RUN_DIR="$PROJECT_ROOT/artifacts/runs/$RUN_ID"
LOG_DIR="$RUN_DIR/logs"
SNAPSHOT_DIR="$RUN_DIR/snapshots"
SPEC_LINT_MAX_WARNINGS="${SPEC_LINT_MAX_WARNINGS:-3}"

mkdir -p "$LOG_DIR" "$PROJECT_ROOT/.ae" "$PROJECT_ROOT/artifacts/spec" \
  "$PROJECT_ROOT/artifacts/sim" "$PROJECT_ROOT/artifacts/conformance" \
  "$PROJECT_ROOT/artifacts/formal" "$PROJECT_ROOT/artifacts/properties" \
  "$PROJECT_ROOT/artifacts/mutation" "$PROJECT_ROOT/artifacts/mbt" \
  "$PROJECT_ROOT/artifacts/verify-lite" "$PROJECT_ROOT/artifacts/trends" \
  "$PROJECT_ROOT/artifacts/framework-gaps"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

run_hard() {
  local name="$1"
  shift
  log "RUN(hard): $name"
  "$@" 2>&1 | tee "$LOG_DIR/$name.log"
}

run_soft() {
  local name="$1"
  shift
  log "RUN(soft): $name"
  if "$@" 2>&1 | tee "$LOG_DIR/$name.log"; then
    return 0
  fi
  log "WARN: non-blocking step failed: $name"
  return 0
}

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    log "COPIED: $src -> $dst"
  fi
}

copy_dir_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -d "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    rm -rf "$dst"
    cp -R "$src" "$dst"
    log "COPIED: $src -> $dst"
  fi
}

check_ae_framework() {
  if [[ ! -d "$AE_FRAMEWORK_DIR" ]]; then
    log "ERROR: AE_FRAMEWORK_DIR not found: $AE_FRAMEWORK_DIR"
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    log "ERROR: pnpm is required"
    exit 1
  fi
  if ! [[ "$SPEC_LINT_MAX_WARNINGS" =~ ^[0-9]+$ ]]; then
    log "ERROR: SPEC_LINT_MAX_WARNINGS must be a non-negative integer (current=$SPEC_LINT_MAX_WARNINGS)"
    exit 1
  fi
}

phase_spec() {
  local spec_file="$PROJECT_ROOT/spec/approval-workflow.md"
  if [[ ! -f "$spec_file" ]]; then
    log "SKIP: spec file not found ($spec_file)"
    return 0
  fi

  run_hard spec-validate \
    pnpm --dir "$AE_FRAMEWORK_DIR" exec tsx src/cli/index.ts \
    spec validate -i "$spec_file" --output "$PROJECT_ROOT/.ae/ae-ir.json"

  run_hard spec-lint \
    pnpm --dir "$AE_FRAMEWORK_DIR" exec tsx src/cli/index.ts \
    spec lint -i "$PROJECT_ROOT/.ae/ae-ir.json"

  run_hard spec-lint-gate \
    node "$PROJECT_ROOT/scripts/testing/spec-lint-warning-gate.mjs" \
    --log "$LOG_DIR/spec-lint.log" \
    --max-warnings "$SPEC_LINT_MAX_WARNINGS" \
    --out "$PROJECT_ROOT/artifacts/spec/lint-gate.json"

  if [[ -f "$PROJECT_ROOT/.ae/ae-ir.json" ]]; then
    run_soft generate-contracts \
      node "$AE_FRAMEWORK_DIR/scripts/spec/generate-contracts.mjs" \
      --in "$PROJECT_ROOT/.ae/ae-ir.json" \
      --out "$PROJECT_ROOT/artifacts/spec/contracts.json"

    run_soft generate-replay \
      node "$AE_FRAMEWORK_DIR/scripts/spec/generate-replay-fixtures.mjs" \
      --in "$PROJECT_ROOT/artifacts/spec/contracts.json" \
      --out "$PROJECT_ROOT/artifacts/spec/replay.json"

    run_soft deterministic-sim \
      node "$AE_FRAMEWORK_DIR/scripts/simulation/deterministic-runner.mjs" \
      --in "$PROJECT_ROOT/artifacts/spec/replay.json" \
      --out "$PROJECT_ROOT/artifacts/sim/sim.json"
  fi
}

phase_conformance() {
  local input_file="$PROJECT_ROOT/configs/conformance/input.json"
  local rules_file="$PROJECT_ROOT/configs/conformance/rules.json"
  local context_file="$PROJECT_ROOT/configs/conformance/context.json"
  local rule_ids_file="$PROJECT_ROOT/configs/conformance/rule-ids.txt"
  if [[ ! -f "$input_file" || ! -f "$rules_file" ]]; then
    log "SKIP: conformance input/rules not found"
    return 0
  fi

  local context_args=()
  local rule_args=()
  if [[ -f "$context_file" ]]; then
    context_args=(--context-file "$context_file")
  fi
  if [[ -f "$rule_ids_file" ]]; then
    local ids=""
    ids="$(
      sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$rule_ids_file" \
        | paste -sd ',' -
    )"
    if [[ -n "$ids" ]]; then
      rule_args=(--rule-ids "$ids")
      log "INFO: conformance rule-ids=$ids"
    fi
  fi

  run_soft conformance-verify \
    pnpm --dir "$AE_FRAMEWORK_DIR" exec tsx src/cli/index.ts \
    conformance verify --input "$input_file" --rules "$rules_file" \
    "${context_args[@]}" "${rule_args[@]}" \
    --format json --output "$PROJECT_ROOT/artifacts/conformance/result.json"

  run_hard conformance-negative \
    env AE_FRAMEWORK_DIR="$AE_FRAMEWORK_DIR" \
    pnpm --dir "$PROJECT_ROOT" run test:conformance:negative
}

phase_verify_lite() {
  if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    log "SKIP: package.json not found; verify-lite skipped"
    return 0
  fi

  run_hard verify-lite \
    pnpm --dir "$PROJECT_ROOT" run verify:lite:report
}

phase_property() {
  if [[ ! -d "$PROJECT_ROOT/tests/property" ]]; then
    log "SKIP: tests/property not found"
    return 0
  fi

  run_soft property-tests \
    pnpm --dir "$PROJECT_ROOT" run test:property

  run_soft property-harness \
    node "$AE_FRAMEWORK_DIR/scripts/testing/property-harness.mjs"
}

phase_mbt() {
  if [[ ! -d "$PROJECT_ROOT/tests/mbt" ]]; then
    log "SKIP: tests/mbt not found"
    return 0
  fi

  run_soft mbt-quick \
    pnpm --dir "$PROJECT_ROOT" run test:mbt:quick
}

phase_formal() {
  local tla_file="$PROJECT_ROOT/spec/formal/ApprovalAnyAll.tla"
  local csp_file="$PROJECT_ROOT/spec/formal/approval-any-all.cspm"
  local tla_target="$tla_file"
  local csp_target="$csp_file"
  if [[ ! -f "$tla_target" ]]; then
    tla_target="$AE_FRAMEWORK_DIR/spec/tla/DomainSpec.tla"
  fi
  if [[ ! -f "$csp_target" ]]; then
    csp_target="$AE_FRAMEWORK_DIR/spec/csp/sample.cspm"
  fi

  local tla_cmd=(node "$AE_FRAMEWORK_DIR/scripts/formal/verify-tla.mjs" --file "$tla_target")
  local csp_cmd=(node "$AE_FRAMEWORK_DIR/scripts/formal/verify-csp.mjs" --file "$csp_target" --mode typecheck)

  run_soft verify-tla \
    "${tla_cmd[@]}"
  copy_if_exists \
    "$PROJECT_ROOT/artifacts/hermetic-reports/formal/tla-summary.json" \
    "$PROJECT_ROOT/artifacts/formal/${RUN_ID}-tla-summary.json"

  run_soft verify-csp \
    "${csp_cmd[@]}"
  copy_if_exists \
    "$PROJECT_ROOT/artifacts/hermetic-reports/formal/csp-summary.json" \
    "$PROJECT_ROOT/artifacts/formal/${RUN_ID}-csp-summary.json"
}

phase_mutation() {
  if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    log "SKIP: package.json not found; mutation skipped"
    return 0
  fi

  run_soft mutation-quick \
    pnpm --dir "$PROJECT_ROOT" run test:mutation:quick
}

phase_trend() {
  if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    log "SKIP: package.json not found; trend report skipped"
    return 0
  fi

  run_soft trend-report \
    pnpm --dir "$PROJECT_ROOT" run trend:report
}

phase_framework_gaps() {
  if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    log "SKIP: package.json not found; framework gap status skipped"
    return 0
  fi

  run_soft framework-gap-status \
    pnpm --dir "$PROJECT_ROOT" run framework:gaps:status
}

phase_artifact_audit() {
  run_hard artifact-audit \
    node "$PROJECT_ROOT/scripts/testing/run-artifact-audit.mjs" \
    --run-id "$RUN_ID" --profile "$PROFILE"
}

phase_ae_framework_ref_guard() {
  run_hard ae-framework-ref-guard \
    node "$PROJECT_ROOT/scripts/testing/ae-framework-ref-guard.mjs" \
    --expected-ref-file "$AE_FRAMEWORK_REF_FILE" \
    --actual-dir "$AE_FRAMEWORK_DIR" \
    --out "$PROJECT_ROOT/artifacts/spec/ae-framework-ref-check.json"
}

phase_run_index() {
  run_hard run-index \
    pnpm --dir "$PROJECT_ROOT" run runs:index
}

snapshot_spec_outputs() {
  copy_if_exists "$PROJECT_ROOT/.ae/ae-ir.json" \
    "$SNAPSHOT_DIR/.ae/ae-ir.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/spec/contracts.json" \
    "$SNAPSHOT_DIR/spec/contracts.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/spec/lint-gate.json" \
    "$SNAPSHOT_DIR/spec/lint-gate.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/spec/replay.json" \
    "$SNAPSHOT_DIR/spec/replay.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/sim/sim.json" \
    "$SNAPSHOT_DIR/sim/sim.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/contracts/contracts-summary.json" \
    "$SNAPSHOT_DIR/contracts/contracts-summary.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/domain/replay-fixtures.sample.json" \
    "$SNAPSHOT_DIR/domain/replay-fixtures.sample.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/simulation/deterministic-summary.json" \
    "$SNAPSHOT_DIR/simulation/deterministic-summary.json"
}

snapshot_ref_guard_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/spec/ae-framework-ref-check.json" \
    "$SNAPSHOT_DIR/spec/ae-framework-ref-check.json"
}

snapshot_verify_lite_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/verify-lite/summary.json" \
    "$SNAPSHOT_DIR/verify-lite/summary.json"
}

snapshot_conformance_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/conformance/result.json" \
    "$SNAPSHOT_DIR/conformance/result.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/conformance/negative-summary.json" \
    "$SNAPSHOT_DIR/conformance/negative-summary.json"
  copy_dir_if_exists "$PROJECT_ROOT/artifacts/conformance/negative" \
    "$SNAPSHOT_DIR/conformance/negative"
}

snapshot_mbt_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/mbt/summary.json" \
    "$SNAPSHOT_DIR/mbt/summary.json"
}

snapshot_property_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/properties/summary.json" \
    "$SNAPSHOT_DIR/properties/summary.json"
}

snapshot_formal_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/formal/${RUN_ID}-tla-summary.json" \
    "$SNAPSHOT_DIR/formal/${RUN_ID}-tla-summary.json"
  copy_if_exists "$PROJECT_ROOT/artifacts/formal/${RUN_ID}-csp-summary.json" \
    "$SNAPSHOT_DIR/formal/${RUN_ID}-csp-summary.json"
  copy_dir_if_exists "$PROJECT_ROOT/artifacts/hermetic-reports/formal" \
    "$SNAPSHOT_DIR/hermetic-reports/formal"
}

snapshot_mutation_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/mutation/summary.json" \
    "$SNAPSHOT_DIR/mutation/summary.json"
}

snapshot_trend_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/trends/summary.json" \
    "$SNAPSHOT_DIR/trends/summary.json"
}

snapshot_framework_gap_outputs() {
  copy_if_exists "$PROJECT_ROOT/artifacts/framework-gaps/status.json" \
    "$SNAPSHOT_DIR/framework-gaps/status.json"
}

snapshot_outputs() {
  mkdir -p "$SNAPSHOT_DIR"
  snapshot_ref_guard_outputs

  case "$PROFILE" in
    dev-fast)
      snapshot_spec_outputs
      snapshot_verify_lite_outputs
      ;;
    pr-gate)
      snapshot_spec_outputs
      snapshot_verify_lite_outputs
      snapshot_conformance_outputs
      snapshot_mbt_outputs
      snapshot_property_outputs
      ;;
    nightly-deep)
      snapshot_formal_outputs
      snapshot_mutation_outputs
      ;;
    full)
      snapshot_spec_outputs
      snapshot_verify_lite_outputs
      snapshot_conformance_outputs
      snapshot_mbt_outputs
      snapshot_property_outputs
      snapshot_formal_outputs
      snapshot_mutation_outputs
      ;;
  esac
}

write_manifest() {
  local ae_framework_ref="unknown"
  local ae_framework_ref_expected="unknown"
  if git -C "$AE_FRAMEWORK_DIR" rev-parse HEAD >/dev/null 2>&1; then
    ae_framework_ref="$(git -C "$AE_FRAMEWORK_DIR" rev-parse HEAD)"
  fi
  if [[ -f "$AE_FRAMEWORK_REF_FILE" ]]; then
    ae_framework_ref_expected="$(tr -d '[:space:]' < "$AE_FRAMEWORK_REF_FILE")"
  fi

  cat >"$RUN_DIR/manifest.json" <<EOF
{
  "runId": "$RUN_ID",
  "profile": "$PROFILE",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "aeFrameworkDir": "$AE_FRAMEWORK_DIR",
  "aeFrameworkRefExpected": "$ae_framework_ref_expected",
  "aeFrameworkRef": "$ae_framework_ref",
  "aeFrameworkRefCheckFile": "artifacts/spec/ae-framework-ref-check.json",
  "specLintMaxWarnings": $SPEC_LINT_MAX_WARNINGS,
  "logDir": "artifacts/runs/$RUN_ID/logs",
  "snapshotDir": "artifacts/runs/$RUN_ID/snapshots",
  "auditFile": "artifacts/runs/$RUN_ID/audit.json",
  "notes": [
    "dev-fast: spec + verify-lite",
    "pr-gate: spec + verify-lite + conformance + mbt + property",
    "nightly-deep: formal + mutation + trend",
    "full: verify-lite を含む全フェーズ実行"
  ]
}
EOF
}

main() {
  check_ae_framework
  phase_ae_framework_ref_guard

  case "$PROFILE" in
    dev-fast)
      phase_spec
      phase_verify_lite
      ;;
    pr-gate)
      phase_spec
      phase_verify_lite
      phase_conformance
      phase_mbt
      phase_property
      ;;
    nightly-deep)
      phase_formal
      phase_mutation
      ;;
    full)
      phase_spec
      phase_verify_lite
      phase_conformance
      phase_mbt
      phase_property
      phase_formal
      phase_mutation
      ;;
    *)
      log "ERROR: unknown profile: $PROFILE"
      exit 1
      ;;
  esac

  snapshot_outputs
  write_manifest

  if [[ "$PROFILE" == "nightly-deep" || "$PROFILE" == "full" ]]; then
    phase_trend
    snapshot_trend_outputs
    phase_framework_gaps
    snapshot_framework_gap_outputs
  fi

  phase_artifact_audit
  phase_run_index
  log "DONE: profile=$PROFILE runId=$RUN_ID"
}

main "$@"
