$ErrorActionPreference = "Stop"

$fixturePath = Join-Path (Get-Location) "tests/fixtures/sample-football-league.json"
if (!(Test-Path -LiteralPath $fixturePath)) {
  throw "Missing fixture: $fixturePath"
}

$fixture = Get-Content -Raw -LiteralPath $fixturePath | ConvertFrom-Json

if (!$fixture.league.league_id) { throw "Fixture league_id is required." }
if (!$fixture.league.scoring_settings.rules -or $fixture.league.scoring_settings.rules.Count -lt 1) {
  throw "Fixture scoring rules are required."
}
if (!$fixture.players -or $fixture.players.Count -lt 1) { throw "Fixture players are required." }
if (!$fixture.free_agents -or $fixture.free_agents.Count -lt 1) { throw "Fixture free agents are required." }

Write-Output "Fixture verification passed: $($fixture.league.name)"
