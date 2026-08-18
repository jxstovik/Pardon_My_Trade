import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { WebSocket } from "ws";

const root = process.cwd();
const dataDir = await mkdtemp(join(tmpdir(), "pmt-draft-harness-") );
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(root, "dist/src/cli.js"), "draft-harness"], {
  cwd: root,
  env: {
    ...process.env,
    PMT_PORT: String(port),
    PMT_DATA_DIR: dataDir,
    PMT_DRAFT_FEED: "manual",
    PMT_DRAFT_STORE: join(dataDir, "manual.jsonl"),
    OLLAMA_BASE_URL: "http://127.0.0.1:1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let outputBuffer = "";
child.stdout.on("data", (chunk) => { outputBuffer += chunk; process.stdout.write(`[harness] ${chunk}`); });
child.stderr.on("data", (chunk) => { outputBuffer += chunk; process.stderr.write(`[harness] ${chunk}`); });

const stop = async () => {
  if (!child.killed) child.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
};

try {
  await waitForServer();
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  };

  const page = await fetch(`${base}/draft`);
  const html = await page.text();
  check("draft page loads", page.status === 200 && html.includes("Best Available"));
  check("all dashboard panels are present", ["panel-board", "panel-best", "panel-roster", "panel-chat"].every((id) => html.includes(id)));
  const cssResponse = await fetch(`${base}/draft.css`);
  const css = await cssResponse.text();
  check("responsive layout is defined", cssResponse.status === 200 && css.includes("@media") && css.includes("max-width: 900px") && css.includes("grid-template-areas"));

  const initial = await json(`${base}/api/draft/state`);
  check("state endpoint returns a ranked board", initial.status === 200 && initial.body.bestAvailable?.length > 0);
  const wsSnapshot = await nextWebSocketMessage();
  check("WebSocket sends the initial snapshot", wsSnapshot?.nextPick === initial.body.nextPick);

  const player = initial.body.bestAvailable[0];
  const pick = await json(`${base}/api/draft/pick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ round: 1, roundPick: 1, teamId: "team-001", playerExternalId: player.playerId })
  });
  check("record-pick endpoint accepts a real player", pick.status === 200 && pick.body.ok === true && pick.body.snapshot.board.length === 1);
  check("pick changes recommendation state", pick.body.snapshot.bestAvailable[0]?.playerId !== player.playerId);

  const chat = await json(`${base}/api/draft/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "What position should I prioritize next?" }] })
  });
  check("chat failure is isolated and reported", chat.status === 502 && String(chat.body.error).includes("ollama chat failed"));

  console.log("\nBrowser check: open this exact URL while this terminal remains running:");
  console.log(`  ${base}/draft`);
  console.log("Verify desktop: board, best available, roster/needs, and chat are visible without overlap.");
  console.log("Verify mobile: resize below 900px and confirm panels stack in board, best, roster, chat order.");
  console.log("Verify output: the recorded player appears on the board and disappears from best available.");
  const rl = createInterface({ input, output });
  await rl.question("Press Enter only after the browser check is complete (Ctrl+C aborts): ");
  rl.close();
  console.log(`\n${checks.every(Boolean) ? "Automated checks passed." : "Some automated checks failed."}`);
  process.exitCode = checks.every(Boolean) ? 0 : 1;
} finally {
  await stop();
}

async function json(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Harness did not start. ${outputBuffer}`);
}

function nextWebSocketMessage() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/draft`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WebSocket timeout")); }, 5000);
    ws.once("message", (data) => { clearTimeout(timer); ws.close(); resolve(JSON.parse(data)); });
    ws.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));
      server.close(() => resolve(address.port));
    });
  });
}
