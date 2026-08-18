const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

let latestSnapshot = null;

async function loadState() {
  try {
    const res = await fetch("/api/draft/state");
    const snapshot = await res.json();
    renderSnapshot(snapshot);
    $("meta").textContent = "Connected (REST)";
  } catch (err) {
    $("status").textContent = "Failed to load draft state: " + err.message;
  }
}

function connectWs() {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/draft");
  ws.addEventListener("message", (ev) => {
    try {
      const snapshot = JSON.parse(ev.data);
      renderSnapshot(snapshot);
      $("meta").textContent = "Live (WS)";
    } catch (err) {
      $("status").textContent = "WS parse error: " + err.message;
    }
  });
  ws.addEventListener("error", () => {
    $("meta").textContent = "WS error — using REST";
  });
}

function renderSnapshot(snapshot) {
  latestSnapshot = snapshot;
  renderBoard(snapshot);
  renderBest(snapshot);
  renderRoster(snapshot);
  renderStatus(snapshot);
}

function renderStatus(snapshot) {
  $("board-status").innerHTML =
    `Next pick: <strong>${escapeHtml(snapshot.nextPick ?? "-")}</strong> · ` +
    `Picks until yours: <strong>${escapeHtml(snapshot.picksUntilMyNext ?? "-")}</strong> · ` +
    `Your seat: <strong>${escapeHtml(snapshot.mySeat ?? "-")}</strong>`;
}

function renderBoard(snapshot) {
  const board = snapshot.board || [];
  const el = $("board-list");
  if (!board.length) {
    el.innerHTML = '<span class="empty">No picks yet.</span>';
    return;
  }
  el.innerHTML = board.map((p) => `
    <div class="row">
      <strong>#${escapeHtml(p.pickNo)}</strong>
      · Rd ${escapeHtml(p.round)}.${escapeHtml(p.roundPick)}
      · ${escapeHtml(p.teamId)}
      · ${escapeHtml(p.playerExternalId)}
      <span class="badge">${escapeHtml(p.source ?? "n/a")}</span>
    </div>`).join("");
}

function renderBest(snapshot) {
  const list = snapshot.bestAvailable || [];
  const el = $("best-list");
  if (!list.length) {
    el.innerHTML = '<span class="empty">No players available.</span>';
    return;
  }
  const maxExp = Math.max(...list.map((p) => p.expectedPoints || 0), 1);
  el.innerHTML = list.map((p, i) => {
    const rank = i + 1;
    const exp = p.expectedPoints || 0;
    const expPct = Math.round((exp / maxExp) * 100);
    const prob = p.probabilities || {};
    const bars = ["8", "12", "18"].map((k) => {
      const v = Math.round((prob[k] ?? 0) * 100);
      return `<div class="ubar" title="P(>${escapeHtml(k)}): ${v}%"><span style="width:${v}%"></span></div>`;
    }).join("");
    const survival = p.survival != null ? Math.round(p.survival * 100) : "-";
    return `
      <div class="row ${rank === 1 ? "top" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${rank}. ${escapeHtml(p.playerName)}</strong>
          <span class="badge">${escapeHtml(p.position ?? "")}</span>
          <span class="badge">Tier ${escapeHtml(p.tier ?? "-")}</span>
          <span class="badge good">${survival}%</span>
        </div>
        <div>Expected: ${escapeHtml(exp)}</div>
        <div class="bar"><span style="width:${expPct}%"></span></div>
        <div style="font-size:11px;color:var(--muted);">P(&gt;8 / &gt;12 / &gt;18)</div>
        <div class="upsidbars">${bars}</div>
      </div>`;
  }).join("");
}

function renderRoster(snapshot) {
  const needs = snapshot.needs || [];
  const el = $("roster-needs");
  if (!needs.length) {
    el.innerHTML = '<span class="empty">No needs data.</span>';
    return;
  }
  el.innerHTML = needs.map((n) => {
    const filled = (n.remaining ?? 0) <= 0;
    return `<span class="need ${filled ? "filled" : ""}">${escapeHtml(n.slot)} ${n.filled}/${n.required}${filled ? " ✓" : ` (${n.remaining} left)`}</span>`;
  }).join("");

  const roster = snapshot.myRoster || {};
  const starters = roster.starters || [];
  const bench = roster.bench || [];
  const sEl = $("roster-starters");
  const renderSlot = (s) =>
    `<div class="row">${escapeHtml(s.slot_type ?? "")}: ${s.full_name ? escapeHtml(s.full_name) : '<span class="empty">empty</span>'}</div>`;
  sEl.innerHTML =
    `<div style="margin-top:12px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Starters</div>` +
    (starters.length ? starters.map(renderSlot).join("") : '<span class="empty">None.</span>') +
    `<div style="margin-top:8px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Bench</div>` +
    (bench.length ? bench.map(renderSlot).join("") : '<span class="empty">None.</span>');
}

$("pick-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    round: Number(f.round.value),
    roundPick: Number(f.roundPick.value),
    teamId: f.teamId.value,
    playerExternalId: f.playerExternalId.value,
  };
  try {
    const res = await fetch("/api/draft/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (out.ok && out.snapshot) renderSnapshot(out.snapshot);
    f.reset();
  } catch (err) {
    $("status").textContent = "Pick failed: " + err.message;
  }
});

const chatMessages = [];
if (chatMessages.length === 0) {
  chatMessages.push({
    role: "system",
    content: "You are Pardon My Trade, an advisory fantasy football draft assistant. You help the user build a competitive roster by recommending picks, balancing positional needs, and flagging risk. You never execute moves; you only advise.",
  });
}

function renderChat() {
  const el = $("chat-log");
  el.innerHTML = chatMessages.map((m) => `
    <div class="msg ${escapeHtml(m.role)}">
      <span class="role">${escapeHtml(m.role)}</span>
      ${escapeHtml(m.content)}
    </div>`).join("");
  el.scrollTop = el.scrollHeight;
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.message;
  const text = input.value.trim();
  if (!text) return;
  chatMessages.push({ role: "user", content: text });
  input.value = "";
  renderChat();
  try {
    const res = await fetch("/api/draft/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatMessages }),
    });
    const out = await res.json();
    chatMessages.push({ role: "assistant", content: out.reply ?? "" });
    renderChat();
  } catch (err) {
    chatMessages.push({ role: "assistant", content: "Chat error: " + err.message });
    renderChat();
  }
});

renderChat();
loadState();
connectWs();
