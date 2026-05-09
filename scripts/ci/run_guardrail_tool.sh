#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 ]]; then
  cat >&2 <<'EOF'
Usage: scripts/ci/run_guardrail_tool.sh <tool> <python-package> [-- <args...>]

Runs Python guardrail tools through uvx when available, then falls back to
the tool already installed on PATH. Missing tools fail closed with an
Agent-friendly install prompt.
EOF
  exit 2
fi

TOOL="$1"
PACKAGE="$2"
shift 2

if [[ "${1:-}" == "--" ]]; then
  shift
fi

install_hint() {
  cat >&2 <<EOF
FATAL ARCH-TOOL-000: ${TOOL} is required for Agent guardrails.
Why dangerous: without ${TOOL}, unsafe finance code, hidden float flows, or
Agent-generated spaghetti code can enter review without the physical gate.
Agent fix: install uv once (\`brew install uv\` on macOS, or
\`curl -LsSf https://astral.sh/uv/install.sh | sh\`), then rerun the failing
command. If your environment already manages tools globally, install
\`${TOOL}\` on PATH and rerun.
EOF
}

if command -v uvx >/dev/null 2>&1; then
  EXTRA_UVX_ARGS=()
  if [[ "$PACKAGE" == "semgrep" ]]; then
    # Some semgrep uvx environments miss pkg_resources unless setuptools is
    # layered explicitly. Keep the guardrail runner self-healing.
    EXTRA_UVX_ARGS=(--with setuptools)
  fi
  if [[ ${#EXTRA_UVX_ARGS[@]} -gt 0 ]]; then
    exec uvx "${EXTRA_UVX_ARGS[@]}" --from "$PACKAGE" "$TOOL" "$@"
  fi
  exec uvx --from "$PACKAGE" "$TOOL" "$@"
fi

if command -v "$TOOL" >/dev/null 2>&1; then
  exec "$TOOL" "$@"
fi

install_hint
exit 1
