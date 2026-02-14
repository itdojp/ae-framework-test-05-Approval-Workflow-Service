#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AE_FRAMEWORK_DIR="${AE_FRAMEWORK_DIR:-$PROJECT_ROOT/../ae-framework}"
PROFILE="${1:-full}"
RUN_ID="${RUN_ID:-$(date -u +%Y-%m-%d)-${PROFILE}}"
RUN_DIR="$PROJECT_ROOT/artifacts/runs/$RUN_ID"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$LOG_DIR" "$PROJECT_ROOT/.ae" "$PROJECT_ROOT/artifacts/spec" \
  "$PROJECT_ROOT/artifacts/sim" "$PROJECT_ROOT/artifacts/conformance" \
  "$PROJECT_ROOT/artifacts/formal" "$PROJECT_ROOT/artifacts/properties" \
  "$PROJECT_ROOT/artifacts/mutation"

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

check_ae_framework() {
  if [[ ! -d "$AE_FRAMEWORK_DIR" ]]; then
    log "ERROR: AE_FRAMEWORK_DIR not found: $AE_FRAMEWORK_DIR"
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    log "ERROR: pnpm is required"
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

write_manifest() {
  cat >"$RUN_DIR/manifest.json" <<EOF
{
  "runId": "$RUN_ID",
  "profile": "$PROFILE",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "aeFrameworkDir": "$AE_FRAMEWORK_DIR",
  "logDir": "artifacts/runs/$RUN_ID/logs",
  "notes": [
    "dev-fast: spec系中心",
    "pr-gate: spec + conformance + property",
    "nightly-deep: formal + mutation",
    "full: すべて実行"
  ]
}
EOF
}

main() {
  check_ae_framework

  case "$PROFILE" in
    dev-fast)
      phase_spec
      ;;
    pr-gate)
      phase_spec
      phase_conformance
      phase_property
      ;;
    nightly-deep)
      phase_formal
      phase_mutation
      ;;
    full)
      phase_spec
      phase_conformance
      phase_property
      phase_formal
      phase_mutation
      ;;
    *)
      log "ERROR: unknown profile: $PROFILE"
      exit 1
      ;;
  esac

  write_manifest
  log "DONE: profile=$PROFILE runId=$RUN_ID"
}

main "$@"
