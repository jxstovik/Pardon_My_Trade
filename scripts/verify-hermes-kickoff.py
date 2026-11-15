#!/usr/bin/env python3
"""Run one local read-only Luna/xhigh canary through the installed Hermes agent.

Use Hermes's environment Python. Does not register/fire a cron job or deliver a message.
Terminal approval policy is left intact. Automatic dependency updates are disabled for this check.
"""
import argparse
import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import sys
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--season")
parser.add_argument("--week", type=int)
parser.add_argument("--kickoff")
parser.add_argument("--verify-saved", action="store_true")
args = parser.parse_args()
os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path.home() / ".hermes/hermes-agent"))
os.chdir(ROOT)
output = ROOT / "data/kickoff-verification"
output.mkdir(parents=True, exist_ok=True)


def canonical_comparison(final, evaluated_at):
    # Hermes can wrap/defer MCP results in multiple tool-call layers. Compare with the
    # saved immutable PMT report through its actual finalizer instead of relying on that envelope.
    code = """
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {finalizeKickoffReport} from './dist/src/mcp/kickoff-review.js';
let input='';for await(const c of process.stdin)input+=c;
const request=JSON.parse(input);
const deps={dataDir:resolve('data'),leagueExternalId:'98806880',teamId:'7',clock:()=>new Date(request.at)};
let match=null;
for(const name of await readdir('data/kickoff-reviews')){
 if(!/^[a-f0-9]{64}\\.json$/.test(name))continue;
 const id=name.slice(0,-5);const result=await finalizeKickoffReport(deps,id);
 if(result.report.trim()===request.final.trim()){match=id;break;}
}
process.stdout.write(JSON.stringify({verbatimVerified:match!==null,reportId:match}));
"""
    node = ROOT / "data/runtime/node-v26.11.1-linux-x64/bin/node"
    result = subprocess.run([str(node), "--input-type=module", "-e", code], input=json.dumps({"final": final, "at": evaluated_at}), text=True, cwd=ROOT, capture_output=True, check=True)
    return json.loads(result.stdout)


if args.verify_saved:
    summary = json.loads((output / "hermes-canary.json").read_text())
    summary.update(canonical_comparison((output / "hermes-canary.md").read_text(), summary.get("verificationTime", dt.datetime.now(dt.timezone.utc).isoformat())))
    (output / "hermes-canary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    sys.exit(0 if summary["verbatimVerified"] else 1)
if not all([args.season, args.week, args.kickoff]):
    parser.error("Use --season, --week and --kickoff, or --verify-saved.")
request = {"season": args.season, "nflWeek": args.week, "kickoff": args.kickoff}
prompt = ("This is a local read-only acceptance test for the repaired kickoff workflow. "
          "Call pmt_run_kickoff_review with " + json.dumps(request) + ". Then call pmt_finalize_kickoff_report with its reportId. "
          "Return the finalizer's report verbatim as your entire final answer. "
          "Do not prepare, approve, execute, schedule, send messages, or use terminal tools. "
          "Do not reinterpret empty coverage as health clearance. If incomplete, return the failure report unchanged.")
summary = {}
try:
    with (output / "hermes-canary.log").open("w") as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        from tools.mcp_tool_discovery import discover_mcp_tools
        discovered = discover_mcp_tools(allowed_mcp_names=["pmt-read"])
        if not all(any(name.endswith(t) for name in discovered) for t in ["pmt_run_kickoff_review", "pmt_finalize_kickoff_report"]):
            raise RuntimeError("Installed Hermes did not discover the kickoff tools.")
        from hermes_cli.oneshot import _run_agent
        final, result = _run_agent(prompt, model="gpt-6-luna", provider="openai-codex", toolsets=["pmt-read"], use_config_toolsets=False, reasoning="xhigh")
        calls, finalized = [], None
        def envelopes(value, depth=0):
            if depth > 12:
                return
            if isinstance(value, str):
                try:
                    yield from envelopes(json.loads(value), depth + 1)
                except (ValueError, TypeError):
                    pass
            elif isinstance(value, dict):
                if value.get("tool") == "pmt_finalize_kickoff_report" and value.get("ok"):
                    yield value
                for nested in value.values():
                    yield from envelopes(nested, depth + 1)
            elif isinstance(value, list):
                for nested in value:
                    yield from envelopes(nested, depth + 1)
        for message in result.get("messages", []):
            for call in message.get("tool_calls", []) or []:
                calls.append(call.get("function", {}).get("name"))
            if message.get("role") == "tool" and isinstance(message.get("content"), str):
                for envelope in envelopes(message["content"]):
                    finalized = envelope["data"]["report"]
        summary = {"requestedModel": "gpt-6-luna", "reasoning": "xhigh", "completed": result.get("completed"), "actualModel": result.get("model"), "toolCalls": calls, "verbatimVerified": finalized is not None and final.strip() == finalized.strip(), "platformWrites": 0, "messageDeliveries": 0}
        summary["verificationTime"] = dt.datetime.now(dt.timezone.utc).isoformat()
        summary.update(canonical_comparison(final, summary["verificationTime"]))
        (output / "hermes-canary.md").write_text(final)
        (output / "hermes-canary.json").write_text(json.dumps(summary, indent=2))
        if not summary["verbatimVerified"]:
            raise RuntimeError("Luna did not return the finalizer report verbatim; inspect canary log.")
finally:
    try:
        from tools.mcp_tool_lifecycle import shutdown_mcp_servers
        shutdown_mcp_servers()
    except Exception:
        pass
print(json.dumps(summary, indent=2))
