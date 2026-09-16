"""Export the latest league snapshot from pmt.db into a fixture JSON for weekly-report."""
import json
import sqlite3

con = sqlite3.connect("/opt/data/workspace/Pardon_My_Trade/data/pmt.db")
row = con.execute(
    "SELECT data FROM league_snapshots ORDER BY created_at DESC LIMIT 1"
).fetchone()
snap = json.loads(row[0])
out = "/opt/data/workspace/Pardon_My_Trade/data/real-snapshot.json"
with open(out, "w") as f:
    json.dump(snap, f)
teams = snap["league"]["teams"]
print("wrote", out)
print("teams:", [(t.get("external_id"), t.get("name")) for t in teams])
