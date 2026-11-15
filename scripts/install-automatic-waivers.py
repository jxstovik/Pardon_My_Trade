#!/usr/bin/env python3
"""Update ONLY the existing Tuesday Hermes/Codex job. Dry-run is default.

Never creates a job, enables general writes, or sends a message.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
JOB_ID = '38da0b12383e'

def updates():
    return {'prompt': (ROOT/'docs/hermes/automatic-waivers-job.txt').read_text(),
            'schedule': '0 2 * * 2', 'model': 'gpt-6.1-sol',
            'provider': 'openai-codex', 'reasoning_effort': 'medium', 'script': None,
            'workdir': str(ROOT)}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    home=Path(os.environ.get('HERMES_HOME',str(Path.home()/'.hermes')))
    jobs=json.loads((home/'cron/jobs.json').read_text())['jobs']
    original=next(j for j in jobs if j['id']==JOB_ID)
    change=updates()
    if original.get('provider')!='openai-codex' or not original.get('enabled') or original.get('state')=='paused':
        raise ValueError('Expected enabled existing Codex-provider Tuesday job')
    changed=any(original.get(k)!=v for k,v in change.items() if k!='schedule') or original['schedule'].get('expr')!='0 2 * * 2'
    if args.apply:
        sys.dont_write_bytecode=True
        sys.path.insert(0,str(home/'hermes-agent'))
        from cron.jobs import list_jobs,update_job
        current=next(j for j in list_jobs(include_disabled=True) if j['id']==JOB_ID)
        if current['prompt']!=original['prompt'] or current['schedule']!=original['schedule']:
            raise ValueError('Job changed during preparation')
        if changed:
            backup=home/'backups'/('automatic-waivers-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            backup.mkdir(parents=True,mode=0o700)
            path=backup/'parent.json';path.write_text(json.dumps(current,indent=2));path.chmod(0o600)
            update_job(JOB_ID,change)
        saved=next(j for j in list_jobs(include_disabled=True) if j['id']==JOB_ID)
        for key in ['deliver','origin','enabled','skills','skill','enabled_toolsets','repeat','created_at']:
            if saved.get(key)!=current.get(key):raise ValueError('Unexpected unrelated change: '+key)
        if saved['schedule']['expr']!='0 2 * * 2' or any(saved.get(k)!=v for k,v in change.items() if k!='schedule'):
            raise ValueError('Updated policy/model/schedule readback failed')
        instant=dt.datetime.fromisoformat(saved['next_run_at'])
        from zoneinfo import ZoneInfo
        local=instant.astimezone(ZoneInfo('America/New_York'))
        if local.weekday()!=1 or local.hour!=2 or local.minute!=0:raise ValueError('Next trigger is not Tuesday 02:00 New York')
        # Pinned routes disable runtime and agent fallbacks in the installed scheduler.
        from cron.scheduler import _job_fallback_chain, _job_route_pinned
        # A deliberately weaker fallback must be suppressed for this pinned job.
        config={"fallback_providers":[{"provider":"openai-codex","model":"gpt-6-luna"}]}
        if not _job_route_pinned(saved) or _job_fallback_chain(saved,config):raise ValueError('Pinned job unexpectedly has a fallback chain')
        original=saved
    print(json.dumps({'applied':args.apply,'changed':changed,'jobId':JOB_ID,'model':'gpt-6.1-sol','provider':'openai-codex','reasoningEffort':'medium','schedule':'Tuesday 02:00 America/New_York','nextRunAt':original.get('next_run_at'),'existingJobOnly':True,'platformWrites':0}))

if __name__=='__main__':main()
