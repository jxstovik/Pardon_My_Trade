import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("run_training.py")
spec = importlib.util.spec_from_file_location("run_training", MODULE_PATH)
run_training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_training)


class ProgressTrackerTests(unittest.TestCase):
    def test_publish_writes_current_snapshot_and_append_only_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            tracker = run_training.ProgressTracker(Path(tmp), total=2)
            tracker.publish("started", script="plan26_ingest.py", index=1)
            tracker.publish("completed", script="plan26_ingest.py", index=1, returncode=0)

            current = json.loads((Path(tmp) / "progress.json").read_text())
            history = (Path(tmp) / "progress.jsonl").read_text().splitlines()

            self.assertEqual(current["status"], "completed")
            self.assertEqual(current["script"], "plan26_ingest.py")
            self.assertEqual(current["completed"], 1)
            self.assertEqual(current["total"], 2)
            self.assertEqual(len(history), 2)
            self.assertEqual(json.loads(history[0])["status"], "started")

    def test_stage_log_path_is_inside_run_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            tracker = run_training.ProgressTracker(Path(tmp), total=1)
            self.assertEqual(tracker.log_path("plan26_models.py"), Path(tmp) / "plan26_models.log")


if __name__ == "__main__":
    unittest.main()
