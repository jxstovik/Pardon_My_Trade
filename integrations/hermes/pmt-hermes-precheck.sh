#!/usr/bin/env bash

# Hermes runs this as a pre-run script from the configured absolute workdir.
# The script is copied to job-specific names by install-example-jobs.sh so the
# post-week gate can be distinguished without adding per-job environment state.
set -u

job_name="$(basename "$0")"
workdir="$(pwd -P 2>/dev/null || true)"

blocked() {
  local reason="$1"
  printf '{"wakeAgent":true,"context":{"precheck":"blocked","job":"%s","reason":"%s"}}\n' \
    "$job_name" "$reason"
  exit 0
}

if [[ -z "$workdir" || "$workdir" != /* ]]; then
  blocked "the Hermes workdir is not absolute"
fi

if [[ ! -f "$workdir/package.json" || ! -f "$workdir/dist/src/cli.js" ]]; then
  blocked "the PMT workdir is missing package.json or a built dist/src/cli.js"
fi

data_dir="${PMT_DATA_DIR:-$workdir/data}"
if [[ "$data_dir" != /* ]]; then
  data_dir="$workdir/$data_dir"
fi
if [[ ! -f "$data_dir/last-snapshot.json" ]]; then
  blocked "no imported PMT snapshot pointer was found"
fi

# Hermes must be the only scheduler for this integration. Do not silently run
# a second refresh if a PMT daemon was started elsewhere.
if command -v pgrep >/dev/null 2>&1 && pgrep -af '[d]ist/src/cli.js daemon' >/dev/null 2>&1; then
  blocked "a PMT daemon process is already running; stop it before enabling Hermes jobs"
fi

if [[ "$job_name" == *post-week* ]]; then
  observations_path="${HERMES_PMT_HISTORICAL_DATA_PATH:-${PMT_HISTORICAL_DATA_PATH:-}}"
  if [[ -z "$observations_path" || ! -f "$observations_path" ]]; then
    # No completed observations means no post-week model work is ready. This
    # is an intentional zero-token skip, not a failed PMT run.
    printf '{"wakeAgent":false}\n'
    exit 0
  fi
fi

printf '{"wakeAgent":true,"context":{"precheck":"pass","job":"%s","scheduler":"hermes-only"}}\n' \
  "$job_name"
