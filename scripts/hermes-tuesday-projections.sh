#!/usr/bin/env bash
# Canonical projections are a required pre-run step, not an optional LLM call.
set -euo pipefail
ROOT=/home/jordan-stovik/Pardon_My_Trade
cd "$ROOT"
export TZ=America/New_York
exec "$ROOT/data/runtime/node-v26.11.1-linux-x64/bin/node" "$ROOT/scripts/refresh-tuesday-projections.mjs" "$@"
