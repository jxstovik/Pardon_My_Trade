#!/usr/bin/env python3
"""PMT overnight workflow — run this on your laptop nightly (post-Monday-night).

What it does, in order:
  1. Fetch the latest COMPLETED fantasy week's per-player points from ESPN
     (league rosters + matchup scores) using ESPN_S2/SWID from the repo .env.
  2. Write data/historical-observations.json (backup kept in data/outcomes/).
  3. Start the PMT MCP stdio server and call pmt_update_post_week_outcomes
     (Bayesian model update + governance manifest). No predictions are attached
     because no weekly-scale archived predictions exist yet — this is recorded
     as a limitation, never fabricated.
  4. Run `pmt season-refresh <season> <nextWeek> --force` to pull fresh
     multi-source projections for the upcoming week.
  5. Verify per-source projection counts in data/pmt.db.
  6. Export data/real-snapshot.json and run the team-7 weekly report
     (starters-scoped, full PPR).
  7. Call pmt_run_advisory_orchestration (execution disabled) for team 7.
  8. Write a dated markdown report to reports/overnight/.

Stdlib only. Exit code 0 = full success; 1 = any step failed (steps run
independently and failures are recorded in the report, not swallowed).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LEAGUE_ID = os.environ.get("PMT_LEAGUE_ID", "98806880")
TEAM_ID = os.environ.get("PMT_TEAM_ID", "7")  # Bored Man Gets Paid
SEASON = os.environ.get("PMT_SEASON", "2026")
READ_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
LEAGUE_VIEWS = ["mTeam", "mRoster", "mMatchupScore", "mSettings"]


def load_env() -> dict:
    env = dict(os.environ)
    p = REPO / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k, v)
    return env


def espn_get(env: dict, path: str, timeout: int = 90) -> dict:
    url = f"{READ_BASE}/seasons/{SEASON}/segments/0/leagues/{LEAGUE_ID}{path}"
    headers = {
        "Cookie": f"espn_s2={env.get('ESPN_S2', '')}; SWID={env.get('SWID', '')}",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def completed_week_points(env: dict) -> tuple[int, list[dict]]:
    """Return (completed_week, [{playerId, name, points, proTeam, pos}])."""
    data = espn_get(env, "?" + "&".join(f"view={v}" for v in LEAGUE_VIEWS))
    sp = data.get("scoringPeriodId")
    if not sp or sp < 2:
        raise SystemExit(f"No completed week yet (scoringPeriodId={sp}).")
    week = sp - 1
    out: dict[str, dict] = {}
    for g in data.get("schedule", []):
        if g.get("matchupPeriodId") != week:
            continue
        for side in ("home", "away"):
            for entry in (g.get(side) or {}).get("roster", {}).get("entries", []) or []:
                pe = (entry.get("playerPoolEntry") or {}).get("player") or {}
                pid = str(pe.get("id") or "")
                if not pid:
                    continue
                w1 = [
                    s
                    for s in pe.get("stats", [])
                    if s.get("scoringPeriodId") == week and s.get("seasonId") == int(SEASON)
                ]
                applied = next(
                    (s["appliedTotal"] for s in w1 if s.get("appliedTotal") is not None),
                    None,
                )
                rec = out.setdefault(
                    pid, {"playerId": pid, "name": pe.get("fullName"), "points": applied}
                )
                if rec["points"] is None and applied is not None:
                    rec["points"] = applied
    # Roster view is authoritative; also walk data['teams'] rosters in case a
    # player sat out a matchup payload but has stats.
    for team in data.get("teams", []):
        for entry in team.get("roster", {}).get("entries", []) or []:
            pe = (entry.get("playerPoolEntry") or {}).get("player") or {}
            pid = str(pe.get("id") or "")
            if not pid or pid in out:
                continue
            w1 = [
                s
                for s in pe.get("stats", [])
                if s.get("scoringPeriodId") == week and s.get("seasonId") == int(SEASON)
            ]
            applied = next(
                (s["appliedTotal"] for s in w1 if s.get("appliedTotal") is not None),
                None,
            )
            out[pid] = {"playerId": pid, "name": pe.get("fullName"), "points": applied}
    return week, list(out.values())


# ---------------------------------------------------------------- MCP client


class McpClient:
    """Minimal JSON-RPC client for the PMT MCP stdio server."""

    def __init__(self, env: dict):
        self.proc = subprocess.Popen(
            [env.get("PMT_NODE", "node"), str(REPO / "dist/src/mcp/stdio.js")],
            cwd=REPO,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self._id = 0
        self._call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "pmt-overnight", "version": "1.0.0"},
        })
        self._notify("notifications/initialized", {})

    def _send(self, payload: dict):
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _read(self) -> dict:
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("MCP server closed stdout")
            line = line.strip()
            if not line:
                continue
            msg = json.loads(line)
            if "id" in msg or "result" in msg or "error" in msg:
                return msg

    def _call(self, method: str, params: dict) -> dict:
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        while True:
            msg = self._read()
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError(f"MCP {method} error: {msg['error']}")
                return msg.get("result", {})

    def _notify(self, method: str, params: dict):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def tool(self, name: str, arguments: dict) -> dict:
        result = self._call("tools/call", {"name": name, "arguments": arguments})
        content = result.get("content") or []
        text = "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"raw": text}

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=15)
        except Exception:
            self.proc.kill()


# ------------------------------------------------------------------- steps


def run_step(name: str, fn, results: dict) -> dict:
    try:
        value = fn()
        results[name] = {"ok": True, "value": value}
        print(f"[ok] {name}", flush=True)
    except Exception as exc:  # noqa: BLE001 — record, don't swallow
        results[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(f"[FAIL] {name}: {exc}", flush=True)
    return results[name]


def main() -> int:
    now = datetime.now(timezone.utc)
    env = load_env()
    for required in ("ESPN_S2", "SWID"):
        if not env.get(required):
            print(f"Missing {required} in repo .env — cannot read ESPN.", file=sys.stderr)
            return 1
    out_dir = REPO / "data" / "outcomes"
    report_dir = REPO / "reports" / "overnight"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    results: dict = {}

    def step_fetch():
        week, players = completed_week_points(env)
        have = [p for p in players if p["points"] is not None]
        if not have:
            raise RuntimeError(f"Week {week} returned zero player points (games may not be final).")
        payload = {
            "season": SEASON,
            "week": week,
            "scoringPeriod": f"{SEASON}-W{week}",
            "fetchedAt": now.isoformat(),
            "players": players,
        }
        f = out_dir / f"{SEASON}-W{week:02d}-points.json"
        f.write_text(json.dumps(payload, indent=2))
        obs = [
            {
                "playerId": p["playerId"],
                "season": SEASON,
                "week": week,
                "scoringPeriod": f"{SEASON}-W{week}",
                "points": p["points"],
                "observedAt": now.isoformat().replace("+00:00", "Z"),
            }
            for p in have
        ]
        obs_file = REPO / "data" / "historical-observations.json"
        prev = None
        if obs_file.exists():
            try:
                prev = json.loads(obs_file.read_text())
            except json.JSONDecodeError:
                prev = None
        all_obs = list(prev.get("observations", [])) if prev else []
        seen = {(o["scoringPeriod"], o["playerId"]) for o in all_obs}
        new = [o for o in obs if (o["scoringPeriod"], o["playerId"]) not in seen]
        all_obs.extend(new)
        obs_file.write_text(json.dumps({"observations": all_obs}, indent=2))
        return {"week": week, "playersWithPoints": len(have), "file": str(f),
                "observationsWritten": len(new), "observationsTotal": len(all_obs)}

    run_step("fetch-week1-outcomes", step_fetch, results)
    completed = results.get("fetch-week1-outcomes", {}).get("value", {})
    week = completed.get("week")

    def step_refresh():
        week_arg = (week or 0) + 1
        if not week_arg:
            raise RuntimeError("no completed week")
        cmd = ["npm", "run", "--silent", "pmt", "--", "season-refresh", SEASON, str(week_arg), "--force"]
        proc = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=1800)
        return {"returncode": proc.returncode, "tail": (proc.stdout or "")[-1500:] + (proc.stderr or "")[-800:]}

    run_step("season-refresh", step_refresh, results)

    def step_model_update():
        if not week:
            raise RuntimeError("no completed week")
        obs = json.loads((REPO / "data" / "historical-observations.json").read_text())["observations"]
        batch = [o for o in obs if o["scoringPeriod"] == f"{SEASON}-W{week}"]
        # The Bayesian update requires an existing PlayerModel per row; DST team
        # ids (negative ESPN ids) are absent from the model store. Exclude them
        # and record, never fabricate a model.
        model_ids = {
            m["playerId"] for m in json.loads((REPO / "data" / "models.json").read_text())["models"]
        }
        known = [o for o in batch if o["playerId"] in model_ids]
        excluded = sorted({o["playerId"] for o in batch if o["playerId"] not in model_ids})
        # The weekly loop is intentionally rerunnable. If every known model is
        # already at this scoring period, do not submit the batch again: the
        # update tool correctly rejects same-or-earlier observations.
        models = json.loads((REPO / "data" / "models.json").read_text())["models"]
        model_by_id = {m["playerId"]: m for m in models}
        period = f"{SEASON}-W{week}"
        pending = [o for o in known if model_by_id.get(o["playerId"], {}).get("lastUpdatedScoringPeriod") != period]
        if not pending:
            return {
                "ok": True,
                "idempotent": True,
                "scoringPeriod": period,
                "observationsSkipped": len(known),
                "_excludedNoModel": excluded,
            }
        mcp = McpClient(env)
        try:
            res = mcp.tool("pmt_update_post_week_outcomes", {
                "season": SEASON,
                "week": week,
                "causalCutoff": now.isoformat().replace("+00:00", "Z"),
                "observations": known,
            })
        finally:
            mcp.close()
        if isinstance(res, dict):
            res["_excludedNoModel"] = excluded
        if res.get("ok") is False:
            raise RuntimeError(f"update_post_week_outcomes failed: {res.get('error')}")
        return res

    run_step("model-update", step_model_update, results)

    def step_verify_projections():
        import sqlite3
        nxt = f"{SEASON}-W{(week or 0) + 1}"
        con = sqlite3.connect(REPO / "data" / "pmt.db")
        try:
            rows = con.execute(
                "select source, count(*) from projections where scoring_period=? group by source",
                (nxt,),
            ).fetchall()
        finally:
            con.close()
        return {"scoringPeriod": nxt, "bySource": rows}

    run_step("verify-projections", step_verify_projections, results)

    def step_snapshot_report():
        subprocess.run(
            [sys.executable, str(REPO / "python/chatpft_modeling/export_snapshot.py")],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=600, check=True,
        )
        cmd = ["npm", "run", "--silent", "pmt", "--", "weekly-report", LEAGUE_ID, TEAM_ID]
        proc = subprocess.run(
            cmd, cwd=REPO, env={**env, "PMT_FIXTURE_PATH": "data/real-snapshot.json"},
            capture_output=True, text=True, timeout=900,
        )
        return {"returncode": proc.returncode, "report": (proc.stdout or "")[-6000:]}

    run_step("weekly-report-team-7", step_snapshot_report, results)

    def step_advisory():
        mcp = McpClient(env)
        try:
            return mcp.tool("pmt_run_advisory_orchestration", {"teamId": TEAM_ID})
        finally:
            mcp.close()

    run_step("advisory-orchestration", step_advisory, results)

    report = {
        "generatedAt": now.isoformat(),
        "league": LEAGUE_ID,
        "team": TEAM_ID,
        "completedWeek": week,
        "steps": {k: {"ok": v["ok"], **({"error": v["error"]} if not v["ok"] else {})} for k, v in results.items()},
    }
    md = ["# PMT overnight run — " + now.strftime("%Y-%m-%d %H:%M UTC"), ""]
    md.append(f"- League {LEAGUE_ID}, team {TEAM_ID}, completed week: {week}")
    md.append(f"- Week-1 outcomes ingested: {completed.get('playersWithPoints', 0)} players"
              f" (observations total: {completed.get('observationsTotal', 0)})")
    md.append("")
    for name, r in results.items():
        md.append(f"## {name} — {'OK' if r['ok'] else 'FAILED'}")
        if not r["ok"]:
            md.append(f"```\n{r['error']}\n```")
        else:
            v = r.get("value")
            if name == "season-refresh":
                md.append("```\n" + (v.get("tail", "")[-1200:]) + "\n```")
            elif name == "weekly-report-team-7":
                md.append("```\n" + (v.get("report", "")[-4000:]) + "\n```")
            elif name == "advisory-orchestration":
                md.append("```json\n" + json.dumps(v, indent=2)[:4000] + "\n```")
            else:
                md.append("```json\n" + json.dumps(v, indent=2)[:2000] + "\n```")
        md.append("")
    md.append("## Limitations")
    md.append("- Model update ran WITHOUT archived predictions: no weekly-scale archived "
              "predictions exist (probabilistic-projections.json stores season-scale means; "
              "SQLite projections are season-scale too). Calibration scoring is deferred.")
    md.append("- KNOWN UPSTREAM BUG: `season-refresh` rebuilds models.json from season-scale "
              "Razzball ROS projections, so `historyMean`/`mu` are season-scale while weekly "
              "observations are weekly-scale (EWMA barely moves mu). Weekly-scale priors "
              "should be re-established in `build-models` before calibration is meaningful.")
    md.append("- DST team rows are excluded from the model update (no DST PlayerModels in the store).")
    md.append("- Waiver/drop decisions still require human approval via the action queue.")
    rpath = report_dir / f"{now.strftime('%Y-%m-%d')}-W{week or 0}-overnight.md"
    rpath.write_text("\n".join(md))
    summary = {"reportPath": str(rpath), "steps": report["steps"]}
    print(json.dumps(summary, indent=2))
    return 0 if all(v["ok"] for v in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
