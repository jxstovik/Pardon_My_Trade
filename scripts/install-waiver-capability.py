#!/usr/bin/env python3
"""Add waiver tools/policy to the existing scoped Hermes workflow; dry-run by default.

Does not change schedules, destinations, credentials, model pins or execution policy.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PARENT_ID = "38da0b12383e"
MARKER = "PMT WAIVER CAPABILITY (league 98806880/team 7):"
POLICY = """PMT WAIVER CAPABILITY (league 98806880/team 7):
Read pmt_espn_read_waivers for current rules and league rank. The selected team is Bored Man Gets Paid.
After projections/news refresh, use pmt_run_advisory_orchestration: waiver_claims are ranked by PMT's position-adjusted projected value, with priority 1 first; waiver_candidates are immediate free-agent moves. Do not invent a ranking in the prompt. Report exact add/conditional-drop IDs, preference, model rationale, read timestamp, and current league rank. Inspect the scoped queue before/after to avoid duplicate proposals. Unknown acquisition status is not authority to submit an add/drop.
Traditional waiver wins move a team to the back of the league order; weekly resets follow live settings. FAAB is disabled for this league as verified October 27, 2026; re-read rather than assuming it stays disabled. A pending claim is not an award. Do not infer the processing timezone from ESPN's raw hour or promise an exact award time.
Scheduled runs are advisory. Do not approve or execute waiver claims. Each exact add/drop, waiver or trade still needs individual human approval. At the human decision, pmt_prepare_waiver_claim accepts leagueId, teamId, addPlayerId, optional conditional dropPlayerId, and explicit priority. Refresh/reprepare expired 30-minute proposals before approval; an old scheduled proposal is not executable authority. Preview, approve and execute are separate calls. Inspect ESPN Pending Moves for existing claims before submission; this capability does not reorder/cancel them. Shared conditional drops represent fallback alternatives, not a guarantee every claim succeeds. An unknown receipt must be reconciled without retrying.
"""

def configure(text):
    for server, tool in [("pmt-read", "pmt_espn_read_waivers"), ("pmt-operator", "pmt_prepare_waiver_claim")]:
        match = re.search(rf"^  {server}:\n.*?(?=^  \S|\Z)", text, re.M | re.S)
        if not match: raise ValueError(f"Missing configured {server} connection")
        block = match.group()
        marker = "      include:\n"
        if marker not in block: raise ValueError("Missing tool allowlist")
        if f"        - {tool}\n" not in block:
            block = block.replace(marker, marker + f"        - {tool}\n", 1)
            text = text[:match.start()] + block + text[match.end():]
    return text

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    config = home / "config.yaml"
    before = config.read_text()
    after = configure(before)
    jobs = json.loads((home / "cron/jobs.json").read_text())["jobs"]
    job = next(j for j in jobs if j["id"] == PARENT_ID)
    if "mcp__pmt_read" not in job.get("enabled_toolsets", []): raise ValueError("Parent lacks PMT read tools")
    prompt = job["prompt"].split(MARKER)[0].rstrip() + "\n\n" + POLICY
    if args.apply:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(home / "hermes-agent"))
        from cron.jobs import update_job, list_jobs
        current = next(j for j in list_jobs(include_disabled=True) if j["id"] == PARENT_ID)
        if current["prompt"] != job["prompt"]: raise ValueError("Parent changed during preparation")
        backup = home / "backups" / ("pmt-waivers-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        backup.mkdir(parents=True, mode=0o700)
        for name, content in [("config.yaml", before), ("parent.json", json.dumps(current))]:
            p = backup / name
            p.write_text(content)
            p.chmod(0o600)
        fd, temp = tempfile.mkstemp(prefix=".pmt-waivers-", dir=home)
        with os.fdopen(fd, "w") as out:
            out.write(after)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temp, config.stat().st_mode & 0o777)
        os.replace(temp, config)
        updated = update_job(PARENT_ID, {"prompt": prompt})
        for key in ["schedule", "deliver", "next_run_at", "enabled_toolsets", "model", "provider", "reasoning_effort"]:
            if updated.get(key) != current.get(key): raise ValueError(f"Unexpected change: {key}")
        saved = next(j for j in list_jobs(include_disabled=True) if j["id"] == PARENT_ID)
        if MARKER not in saved["prompt"] or configure(config.read_text()) != config.read_text(): raise ValueError("Installation readback failed")
    print(json.dumps({"applied": args.apply, "parentId": PARENT_ID, "configChanged": before != after, "promptChanged": prompt != job["prompt"], "schedulePreserved": True, "platformWrites": 0}))

if __name__ == "__main__": main()
