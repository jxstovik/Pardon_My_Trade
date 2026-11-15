#!/usr/bin/env python3
"""Scoped Hermes storage bridge. Dry-run by default; no platform actions or message delivery.

Run --install --apply with Hermes's environment Python after building PMT.
The MCP scheduler uses --reconcile --apply and supplies only verified schedule groups on stdin.
Job mutations use Hermes's locked native API; schedule, delivery and historical runs are preserved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PARENT_ID = "38da0b12383e"
TOOLS = ["pmt_get_nfl_kickoff_schedule", "pmt_schedule_kickoff_reviews", "pmt_run_kickoff_review", "pmt_finalize_kickoff_report"]
PINS = {"model": "gpt-6.1-sol", "provider": "openai-codex", "reasoning_effort": "low", "workdir": str(ROOT)}


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("An explicit UTC offset is required.")
    return parsed


def prompt_for(season, week, kickoff):
    node = ROOT / "data/runtime/node-v26.11.1-linux-x64/bin/node"
    code = "import {kickoffPrompt} from './dist/src/mcp/kickoff-review.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(kickoffPrompt(JSON.parse(s)));"
    result = subprocess.run([str(node), "--input-type=module", "-e", code], input=json.dumps({"season": season, "nflWeek": week, "kickoff": kickoff}), text=True, cwd=ROOT, capture_output=True, check=True)
    return result.stdout


def parent_prompt(old):
    start = old.index("Pre-kick scheduling:")
    end = old.index("Weekly model and recommendations:", start)
    replacement = ("Pre-kick scheduling: Independently determine the upcoming NFL week from the published NFL schedule. "
                   "Call pmt_schedule_kickoff_reviews with season and nflWeek. This deterministic tool reads THIS parent job's current weekly-thread destination, "
                   "groups the published schedule, creates/updates exactly one future T-60 job per kickoff, pins gpt-6.1-sol/openai-codex/low, "
                   "and verifies timestamps and delivery. Do not create these jobs through cronjob_manage or terminal/Python. Report created/updated/skipped and any unresolved schedule entries.\n\n")
    text = old[:start] + replacement + old[end:]
    text = text.split("SCOPED NEWS WORKFLOW OVERRIDE:")[0].split("Inline scoped-news policy (no terminal file read is required):")[0]
    policy = (ROOT / "docs/hermes/scoped-news-workflow.md").read_text()
    return text.rstrip() + "\n\nInline scoped-news policy (no terminal file read is required):\n" + policy


def config_with_tools(text):
    start = text.index("  pmt-read:")
    end = text.find("\n  pmt-operator:", start)
    if end == -1:
        raise ValueError("Expected separate pmt-read/pmt-operator config blocks.")
    block = text[start:end]
    marker = "      include:\n"
    if marker not in block:
        raise ValueError("pmt-read tool allowlist is missing.")
    missing = [name for name in TOOLS if f"        - {name}\n" not in block]
    block = block.replace(marker, marker + "".join(f"        - {name}\n" for name in missing), 1)
    text = text[:start] + block + text[end:]
    start = text.index("  pmt-operator:")
    end = text.find("\n  ", start + 1)
    # Operate only on the operator's allowlist, preserving every other service and setting.
    match = re.search(r"^  [^ ].*:", text[start + len("  pmt-operator:\n"):], re.MULTILINE)
    end = start + len("  pmt-operator:\n") + match.start() if match else len(text)
    operator = text[start:end]
    if "        - pmt_prepare_kickoff_lineup\n" not in operator:
        operator = operator.replace(marker, marker + "        - pmt_prepare_kickoff_lineup\n", 1)
    if "        - pmt_prepare_kickoff_lineup\n" not in operator:
        raise ValueError("Operator kickoff preparation allowlist is unavailable.")
    return text[:start] + operator + text[end:]


def install_plan(jobs, now):
    updates = []
    for job in jobs:
        if job["id"] == PARENT_ID:
            updates.append((job, {**PINS, "prompt": parent_prompt(job["prompt"])}))
            continue
        match = re.match(r"NFL (20\d\d) Week (\d+) pre-kickoff", job.get("name", ""))
        if not match or not job.get("enabled") or job.get("state") != "scheduled":
            continue
        if job.get("schedule", {}).get("kind") != "once":
            raise ValueError("Kickoff review must be a one-shot.")
        run_at = instant(job["schedule"]["run_at"])
        if run_at <= now:
            continue
        season, week = match[1], int(match[2])
        kickoff = (run_at + dt.timedelta(hours=1)).astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        updates.append((job, {**PINS, "prompt": prompt_for(season, week, kickoff), "enabled_toolsets": ["mcp__pmt_read", "mcp__pmt_operator"], "skills": [], "skill": None, "pmt_parent_job_id": PARENT_ID, "pmt_kickoff_key": f"{season}:W{week}:{kickoff}"}))
    if not any(job["id"] == PARENT_ID for job, _ in updates):
        raise ValueError("Configured Tuesday parent job is missing.")
    return updates


def validate_groups(plan, now):
    season, week = str(plan["season"]), int(plan["nfl_week"])
    if not re.fullmatch(r"20\d\d", season) or not 1 <= week <= 18:
        raise ValueError("Invalid NFL season/week.")
    groups = []
    seen = set()
    for group in plan["groups"]:
        kickoff, run_at = instant(group["kickoff"]), instant(group["run_at"])
        key = f"{season}:W{week}:{kickoff.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}"
        if group["key"] != key or key in seen or kickoff - run_at != dt.timedelta(hours=1):
            raise ValueError("Duplicate/mismatched kickoff key or non-T-60 timestamp.")
        seen.add(key)
        if run_at > now:
            groups.append({**group, "key": key})
    return groups


def reconcile(plan, jobs, api, now, apply):
    parent = next((j for j in jobs if j["id"] == PARENT_ID), None)
    if not parent or "98806880" not in parent.get("prompt", "") or "team" not in parent.get("prompt", ""):
        raise ValueError("Configured PMT scheduling parent is missing or has changed scope.")
    delivery = parent.get("deliver")
    if not delivery or delivery == "origin":
        raise ValueError("Parent requires an explicit resolved weekly-thread delivery target.")
    groups = validate_groups(plan, now)
    prefix = f"{plan['season']}:W{plan['nfl_week']}:"
    children = [j for j in jobs if j.get("pmt_parent_job_id") == PARENT_ID and j.get("pmt_kickoff_key", "").startswith(prefix) and j.get("enabled")]
    results = []
    for group in groups:
        existing = [j for j in jobs if j.get("enabled") and (j.get("pmt_kickoff_key") == group["key"] or j.get("name") == group["name"])]
        if len(existing) > 1:
            raise ValueError("Duplicate active kickoff jobs require operator reconciliation.")
        updates = {**PINS, "name": group["name"], "prompt": prompt_for(str(plan["season"]), int(plan["nfl_week"]), group["kickoff"]), "deliver": delivery, "enabled_toolsets": ["mcp__pmt_read", "mcp__pmt_operator"], "pmt_parent_job_id": PARENT_ID, "pmt_kickoff_key": group["key"]}
        if existing:
            job = api["update_job"](existing[0]["id"], updates) if apply else existing[0]
            state = "updated"
        elif apply:
            created = api["create_job"](prompt=updates["prompt"], schedule=group["run_at"], name=updates["name"], deliver=delivery, model=PINS["model"], provider=PINS["provider"], reasoning_effort=PINS["reasoning_effort"], workdir=str(ROOT), enabled_toolsets=updates["enabled_toolsets"], repeat=1)
            job = api["update_job"](created["id"], {"pmt_parent_job_id": PARENT_ID, "pmt_kickoff_key": group["key"]})
            state = "created"
        else:
            job, state = {"id": "dry-run"}, "would_create"
        if apply and (instant(job["next_run_at"]) != instant(group["run_at"]) or job["deliver"] != delivery or any(job.get(k) != v for k, v in PINS.items())):
            raise ValueError("Stored kickoff schedule/delivery/model verification failed.")
        results.append({"id": job["id"], "key": group["key"], "run_at": group["run_at"], "status": state})
    keys = {g["key"] for g in groups}
    for job in children:
        if job["pmt_kickoff_key"] not in keys and instant(job["schedule"]["run_at"]) > now:
            if apply:
                api["pause_job"](job["id"], "Published kickoff changed; replaced by verified T-60 group.")
            results.append({"id": job["id"], "status": "paused_obsolete_future_group"})
    return results


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--install", action="store_true")
    modes.add_argument("--reconcile", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    hermes_home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    jobs = json.loads((hermes_home / "cron/jobs.json").read_text())["jobs"]
    now = dt.datetime.now(dt.timezone.utc)
    plan = install_plan(jobs, now) if args.install else json.load(sys.stdin)
    api = {}
    if args.apply:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(hermes_home / "hermes-agent"))
        # Import storage directly, avoiding unrelated launcher update/repair side effects.
        from cron.jobs import update_job, create_job, list_jobs, pause_job
        api = dict(update_job=update_job, create_job=create_job, pause_job=pause_job)
        jobs = list_jobs(include_disabled=True)
    if args.reconcile:
        print(json.dumps({"applied": args.apply, "jobs": reconcile(plan, jobs, api, now, args.apply)}))
        return
    if args.apply:
        backup = hermes_home / "backups" / f"pmt-kickoff-{now.strftime('%Y%m%dT%H%M%SZ')}"
        backup.mkdir(parents=True, mode=0o700)
        for name, content in [("jobs.json", json.dumps([j for j, _ in plan], indent=2)), ("config.yaml", (hermes_home / "config.yaml").read_text())]:
            p = backup / name
            p.write_text(content)
            p.chmod(0o600)
        config_path = hermes_home / "config.yaml"
        content = config_with_tools(config_path.read_text())
        fd, path = tempfile.mkstemp(prefix=".pmt-kickoff-", dir=hermes_home)
        with os.fdopen(fd, "w") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(path, config_path.stat().st_mode & 0o777)
        os.replace(path, config_path)
        for original, updates in plan:
            updated = api["update_job"](original["id"], updates)
            if updated["schedule"] != original["schedule"] or updated.get("deliver") != original.get("deliver") or updated.get("next_run_at") != original.get("next_run_at"):
                raise ValueError("Existing schedule or delivery changed unexpectedly.")
        runtime = ROOT / "data/hermes-kickoff-runtime.json"
        runtime.write_text(json.dumps({"python": sys.executable}))
        runtime.chmod(0o600)
    print(json.dumps({"applied": args.apply, "jobs": [{"id": j["id"], "name": j["name"], "next_run_at": j.get("next_run_at"), **PINS} for j, _ in plan], "tool_allowlist": TOOLS}))


if __name__ == "__main__":
    main()
