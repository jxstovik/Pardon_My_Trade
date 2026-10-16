import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from build_bundle import load_scoring_snapshot


class BundleTests(unittest.TestCase):
    def test_latest_scoring_snapshot_is_extracted_without_roster_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "league.db"
            db = sqlite3.connect(path)
            db.execute("create table league_snapshots(snapshot_id text, data text, created_at text)")
            data = {"league": {"scoring_settings": {"scoring_type": "custom", "rules": [
                {"stat": "receptions", "points": 1}]}}, "players": [{"player_id": "private"}]}
            db.execute("insert into league_snapshots values(?, ?, ?)", ("snapshot-1", json.dumps(data), "2025-01-01T00:00:00Z"))
            db.commit()
            db.close()
            scoring = load_scoring_snapshot(path)
            self.assertEqual(scoring["snapshot_id"], "snapshot-1")
            self.assertEqual(scoring["scoring"]["rules"][0]["stat"], "receptions")
            self.assertNotIn("players", scoring)


if __name__ == "__main__":
    unittest.main()
