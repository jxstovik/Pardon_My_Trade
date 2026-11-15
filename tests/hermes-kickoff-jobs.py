import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("kickoff_jobs", Path(__file__).parents[1] / "scripts/hermes-kickoff-jobs.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW = dt.datetime(2026, 10, 18, 16, tzinfo=dt.timezone.utc)


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.parent = {"id": module.PARENT_ID, "prompt": "league 98806880 team 7", "deliver": "discord:existing-weekly-thread", "enabled": True}
        self.jobs = [copy.deepcopy(self.parent)]
        self.group = {"key": "2026:W6:2026-10-18T20:05:00.000Z", "kickoff": "2026-10-18T20:05:00.000Z", "run_at": "2026-10-18T15:05:00-04:00", "name": "NFL 2026 Week 6 pre-kickoff — canonical group"}
        self.plan = {"season": "2026", "nfl_week": 6, "groups": [self.group]}
        self.calls = []
        self.api = {"create_job": self.create, "update_job": self.update, "pause_job": self.pause}

    def create(self, *, prompt, schedule, **fields):
        self.calls.append("create")
        job = {"id": "created", "prompt": prompt, "schedule": {"kind": "once", "run_at": schedule}, "next_run_at": schedule, "enabled": True, **fields}
        self.jobs.append(job)
        return copy.deepcopy(job)

    def update(self, job_id, fields):
        self.calls.append("update")
        job = next(j for j in self.jobs if j["id"] == job_id)
        job.update(fields)
        return copy.deepcopy(job)

    def pause(self, job_id, reason):
        self.calls.append("pause")
        next(j for j in self.jobs if j["id"] == job_id)["enabled"] = False

    def test_create_verify_repeat_no_duplicate_and_current_thread(self):
        result = module.reconcile(self.plan, self.jobs, self.api, NOW, True)
        self.assertEqual(result[0]["status"], "created")
        child = self.jobs[-1]
        self.assertEqual(child["model"], "gpt-6-luna")
        self.assertEqual(child["reasoning_effort"], "xhigh")
        self.assertEqual(child["provider"], "openai-codex")
        self.assertEqual(child["deliver"], self.parent["deliver"])
        self.assertEqual(module.reconcile(self.plan, self.jobs, self.api, NOW, True)[0]["status"], "updated")
        self.assertEqual(self.calls.count("create"), 1)
        self.jobs[0]["deliver"] = "discord:rotated-thread"
        module.reconcile(self.plan, self.jobs, self.api, NOW, True)
        self.assertEqual(self.jobs[-1]["deliver"], "discord:rotated-thread")

    def test_partial_create_recovers_by_canonical_name(self):
        self.create(prompt="prior", schedule=self.group["run_at"], name=self.group["name"])
        result = module.reconcile(self.plan, self.jobs, self.api, NOW, True)
        self.assertEqual(result[0]["status"], "updated")
        self.assertEqual(self.calls.count("create"), 1)

    def test_obsolete_only_future_children_are_paused(self):
        module.reconcile(self.plan, self.jobs, self.api, NOW, True)
        self.jobs.append({"id": "unrelated", "enabled": True, "name": "Fitness", "schedule": {"run_at": self.group["run_at"]}})
        result = module.reconcile({**self.plan, "groups": []}, self.jobs, self.api, NOW, True)
        self.assertEqual(result[0]["status"], "paused_obsolete_future_group")
        self.assertTrue(self.jobs[-1]["enabled"])

    def test_duplicate_bad_offset_and_wrong_t60_are_rejected_before_mutation(self):
        for groups in [[self.group, self.group], [{**self.group, "run_at": "2026-10-18T15:05:00"}], [{**self.group, "run_at": "2026-10-18T15:25:00-04:00"}]]:
            with self.assertRaises(ValueError):
                module.reconcile({**self.plan, "groups": groups}, self.jobs, self.api, NOW, True)
        self.assertEqual(self.calls, [])

    def test_past_group_never_created_and_dry_run_has_no_mutations(self):
        self.assertEqual(module.reconcile(self.plan, self.jobs, self.api, NOW + dt.timedelta(days=1), True), [])
        module.reconcile(self.plan, self.jobs, {}, NOW, False)
        self.assertEqual(self.calls, [])

    def test_install_does_not_touch_completed_jobs_or_destinations(self):
        parent = {**self.parent, "prompt": "league 98806880 team 7. Pre-kick scheduling: old terminal step. Weekly model and recommendations: refresh.\nSCOPED NEWS WORKFLOW OVERRIDE: read file"}
        child = {"id": "future", "name": "NFL 2026 Week 6 pre-kickoff — existing", "enabled": True, "state": "scheduled", "schedule": {"kind": "once", "run_at": self.group["run_at"]}, "deliver": "discord:keep-this"}
        completed = {**child, "id": "completed", "enabled": False, "state": "completed"}
        updates = module.install_plan([parent, child, completed], NOW)
        self.assertEqual([j["id"] for j, _ in updates], [module.PARENT_ID, "future"])
        for _, update in updates:
            self.assertNotIn("schedule", update)
            self.assertNotIn("deliver", update)
        new_parent = updates[0][1]["prompt"]
        self.assertEqual(module.parent_prompt(new_parent), new_parent)
        self.assertIn("pmt_schedule_kickoff_reviews", new_parent)


if __name__ == "__main__":
    unittest.main()
