import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifactDir = resolve(root, "artifacts/week5-2026-scout");
const forecasts = JSON.parse(await readFile(resolve(artifactDir, "week5-player-forecasts.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(artifactDir, "manifest.json"), "utf8"));

const currentLineups = {
  "Bored Man Gets Paid": [
    ["QB", "Josh Allen"], ["RB1", "Ashton Jeanty"], ["RB2", "Tony Pollard"],
    ["WR1", "Malik Nabers"], ["WR2", "Wan'Dale Robinson"], ["TE", "George Kittle"],
    ["FLEX", "Michael Wilson"], ["D/ST", "Bills D/ST"], ["K", "Eddy Pineiro"]
  ],
  "23andMe": [
    ["QB", "Sam Darnold"], ["RB1", "Bucky Irving"], ["RB2", "Tyler Allgeier"],
    ["WR1", "Ja'Marr Chase"], ["WR2", "Matthew Golden"], ["TE", "Trey McBride"],
    ["FLEX", "Keon Coleman"], ["D/ST", "Texans D/ST"], ["K", "Harrison Mevis"]
  ]
};

const scoring = {
  source: "ESPN League Settings",
  sourceUrl: "https://fantasy.espn.com/football/league/settings?leagueId=98806880&view=summary",
  scoringType: "Head to Head Points, Point Per Reception (PPR)",
  positions: [
    { slot: "QB", label: "Quarterback", starters: 1, maximum: 4 },
    { slot: "RB", label: "Running Back", starters: 2, maximum: 8 },
    { slot: "WR", label: "Wide Receiver", starters: 2, maximum: 8 },
    { slot: "TE", label: "Tight End", starters: 1, maximum: 3 },
    { slot: "FLEX", label: "RB/WR/TE Flex", starters: 1 },
    { slot: "D/ST", label: "Team Defense/Special Teams", starters: 1, maximum: 3 },
    { slot: "K", label: "Place Kicker", starters: 1, maximum: 3 },
    { slot: "BE", label: "Bench", starters: 7 }
  ],
  categories: [
    { group: "Passing", rows: [["Passing yards", "+0.04 / yard"], ["Passing TD", "+4"], ["Interception thrown", "−2"], ["2-point passing conversion", "+2"]] },
    { group: "Rushing", rows: [["Rushing yards", "+0.1 / yard"], ["Rushing TD", "+6"], ["2-point rushing conversion", "+2"]] },
    { group: "Receiving", rows: [["Receiving yards", "+0.1 / yard"], ["Reception", "+1"], ["Receiving TD", "+6"], ["2-point receiving conversion", "+2"]] },
    { group: "Kicking", rows: [["FG made, 0–39 yards", "+3"], ["FG made, 40–49 yards", "+4"], ["FG made, 50–59 yards", "+5"], ["FG made, 60+ yards", "+5"], ["PAT made / missed", "+1 / −1"], ["FG missed", "−1"]] },
    { group: "D/ST", rows: [["Sack", "+1"], ["Interception / fumble recovery", "+2 each"], ["Safety", "+2"], ["Blocked punt, PAT, or FG", "+2"], ["Kickoff / punt / defensive return TD", "+6"], ["2-point return / 1-point safety", "+2 / +1"], ["Points allowed: 0 / 1–6 / 7–13 / 14–17", "+5 / +4 / +3 / +1"], ["Points allowed: 18–27 / 28–34 / 35–45 / 46+", "0 / −1 / −3 / −5"], ["Total yards allowed: <100 / 100–199 / 200–299", "+5 / +3 / +2"], ["Total yards allowed: 300–349 / 350–399 / 400–449", "0 / −1 / −3"], ["Total yards allowed: 450–499 / 500–549 / 550+", "−5 / −6 / −7"], ["Fumble lost", "−2"]] }
  ],
  transactionRules: [
    ["Lineup changes", "Lock individually at scheduled game time"],
    ["Acquisitions", "Waivers; one-day waiver period; order resets weekly to inverse standings"],
    ["Season acquisition limit", "No limit"],
    ["Roster", "16 total: 9 starters, 7 bench; no IR slot"]
  ]
};

const news = [
  {
    headline: "Ja’Marr Chase remains a Week 5 concussion risk",
    detail: "Chase left Week 4 with a concussion and is listed questionable for Cincinnati at Miami. His model projection is conditional on playing; compare both active and out scenarios before Sunday.",
    date: "2026-10-07",
    source: "CBS Sports injury report",
    url: "https://www.cbssports.com/nfl/injuries/",
    impact: "Moves 23andMe’s model mean by his full player projection when switched out; it does not assume a made-up play probability."
  },
  {
    headline: "Baker Mayfield is out for Tampa Bay at Dallas",
    detail: "The Week 5 injury report lists Mayfield out with a thumb injury. Dallas is available on waivers, but its model projection remains below the Bears, Chargers, and Raiders among the shown D/ST options.",
    date: "2026-10-07",
    source: "CBS Sports injury report",
    url: "https://www.cbssports.com/nfl/injuries/",
    impact: "Use the model-ranked streamers rather than treating the Cowboys matchup narrative as a projection."
  },
  {
    headline: "Keenan Allen and Rachaad White carry questionable tags",
    detail: "Both available-player forecasts are conditional on playing. Keep their active-state model distributions separate from the healthy waiver alternatives.",
    date: "2026-10-07",
    source: "NFL.com injury report",
    url: "https://amp.nfl.com/injuries/",
    impact: "Neither is a clean replacement for Michael Wilson at FLEX under the current model mean."
  }
];

const data = {
  meta: {
    leagueName: "The Smaracko",
    leagueId: "98806880",
    season: 2026,
    week: 5,
    owner: "Bored Man Gets Paid",
    opponent: "23andMe",
    asOf: manifest.built_at,
    statsCutoff: manifest.data_cutoff,
    statsSha256: manifest.source_files.stats_sha256,
    source: "NFLverse player-game statistics and schedule; player/lineup identities from the user-provided ESPN screenshots",
    modelStatus: "Candidate models · not promoted to PMT production",
    modelNote: "All six position models were retrained against the scoring weights from these ESPN settings, including missed-kick penalties and the D/ST points- and yards-allowed tiers. NFLverse does not separately identify the rare 1-point-safety event, so that D/ST event is not reflected in the model target.",
    distributionNote: "Per-player model quantiles are interpolated into distributions. Team simulations use independent player draws and do not model shared game-script correlation. Q-tagged player forecasts are conditional on playing.",
    validation: manifest.metrics,
    scoring,
    news
  },
  teams: Object.entries(currentLineups).map(([name, slots], index) => ({
    id: index === 0 ? "7" : "6",
    name,
    record: index === 0 ? "1–3" : "2–2",
    currentLineup: Object.fromEntries(slots),
    players: forecasts.filter((player) => player.club === name)
  })),
  freeAgents: forecasts.filter((player) => player.club === "available")
};

// Apply an explicitly requested authenticated live overlay; absent flag keeps fixtures reproducible.
if (process.argv.includes("--live")) {
  const live = JSON.parse(await readFile(resolve(root, "data/week5-scout-live-overlay.json"), "utf8"));
  Object.assign(data.meta, live.meta);
  data.teams = live.teams;
  data.freeAgents = live.freeAgents;
}
await writeFile(resolve(root, "public/scout-data.json"), `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${data.teams.reduce((sum, team) => sum + team.players.length, 0)} roster forecasts and ${data.freeAgents.length} free-agent forecasts.`);
