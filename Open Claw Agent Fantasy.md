# Fantasy Football Agentic Workflow for OpenClaw (ESPN + OpenCode/OpenRouter)

> **Runtime:** OpenClaw (headless OpenCode + paid OpenRouter, cost-efficient tiered models)  
> **League:** ESPN Fantasy Football (hosted) — full read/write via `espn-api`  
> **Capabilities:** Auto roster sets, waiver pickups, trade proposals, probabilistic player models, news scraping  
> **Human Control:** High-risk actions (trades, drops) queued for approval via Discord/calendar

---

## 1. Architecture

```
OpenClaw Scheduler (cron)
│
├── Agent: FF_Orchestrator
│   ├── Skill: auth_espn
│   ├── Skill: fetch_league_state
│   ├── Skill: build_prob_models
│   ├── Skill: evaluate_lineup
│   ├── Skill: waiver_scan
│   ├── Skill: trade_proposer
│   ├── Skill: news_scrape
│   └── Skill: execute_or_queue
│
├── Tools: espn-api, nfl-data-py, selenium/scrapy, opencode fetch
├── State: ~/automation/ff/state.json, ~/automation/ff/models/
└── Notify: Discord webhook + Google Calendar
```

---

## 2. Tools (Specs)

| Tool | Type | Purpose | Spec / Auth |
|------|------|---------|-------------|
| `espn_api` | PyPI `espn-api` | Read league, set roster, add/drop, propose trade | `LEAGUE_ID`, `ESPN_S2`, `SWID` cookies |
| `nfl_data_py` | PyPI | Historical stats, schedules, injuries | Free, no auth |
| `news_scraper` | `selenium` + `scrapy` | Scrape RD, FantasyPros, ESPN articles | Rotates UA, 10-min cache |
| `opencode_fetch` | OpenCode plugin | LLM-summarized news via `gemini-flash-lite` | OpenRouter key |
| `cal_writer` | `google-api-python` | Write lock times to calendar | OAuth free |
| `notifier` | `discord.py` | Post actions + approval buttons | Webhook |
| `model_store` | `joblib` + `pandas` | Save per-player Bayesian models | Local parquet |

<details>
<summary>ESPn auth env</summary>

```bash
export ESPN_LEAGUE_ID="123456"
export ESPN_S2="AEC...cookie"
export SWID="{ABC...}"
```

</details>

---

## 3. Skills (Markdown prompt specs)

### `skill_auth_espn.md`
> "Load cookies from env, instantiate `League(league_id, year, espn_s2, swid)`. Verify 200. Use `gemini-flash-lite`."

### `skill_fetch_league_state.md`
> "Pull rosters, points, waiver order, injuries,他人的 roster. Write `state.json`. Model: `gemini-flash-lite`."

### `skill_build_prob_models.md`
> "For each player in league: fit Bayesian Gaussian (prior = nfl_data_py 3-yr mean, update weekly with scored pts). Output `P(pts>threshold|week)` and value curve. Save to `models/`. Model: `gpt-4o-mini`."

### `skill_evaluate_lineup.md`
> "Using `models/` + news flag, output optimal lineup w/ confidence & risk. Model: `claude-3.5-haiku`."

### `skill_waiver_scan.md`
> "Rank free agents by prob model ROI & news. Auto-add if clear win, else queue. Model: `gpt-4o-mini`."

### `skill_trade_proposer.md`
> "Simulate 500 paths with models; propose +EV trades to weak teams. Queue for human. Model: `claude-3.5-haiku`."

### `skill_news_scrape.md`
> "Scrape trusted sites, flag injuries/beat news, feed models. Model: `gemini-flash-lite`."

### `skill_execute_or_queue.md`
> "If auto=True and low-risk → `espn_api` apply. Else post Discord approve. Model: `gemini-flash-lite`."

---

## 4. Agents (OpenCode defs)

### `agent_ff_orchestrator.yaml`
```yaml
name: FF_Orchestrator
model: claude-3.5-haiku
tools: [espn_api, nfl_data_py, news_scraper]
skills: [auth_espn, fetch_league_state, build_prob_models, evaluate_lineup, waiver_scan, trade_proposer, news_scrape, execute_or_queue]
schedule: "0 6,18 * * *"
```

### `agent_ff_builder.yaml`
```yaml
name: FF_Model_Builder
model: gpt-4o-mini
skills: [build_prob_models]
schedule: "30 5 * * 2,5"  # Tue/Fri after games
```

### `agent_ff_news.yaml`
```yaml
name: FF_News
model: gemini-flash-lite
skills: [news_scrape]
schedule: "*/30 12-23 * * *"
```

---

## 5. Probabilistic Model Spec

- **Per player $i$, week $w$:**  
  $$ \mu_{i,w} = \alpha \cdot \bar{x}_{i}^{hist} + (1-\alpha)\mu_{i,w-1} $$  
  $$ \sigma_{i,w}^2 = \beta \sigma_{hist}^2 + (1-\beta)\sigma_{i,w-1}^2 $$
- Prior: `nfl_data_py` 3-yr mean/var  
- Weekly update: scored points as observation  
- Output: $P(x_{i,w} > \tau)$ for thresholds $\tau \in \{8,12,18\}$  
- Value: $\mathbb{E}[pts] \times positionScarcity$

<details>
<summary>Model code stub</summary>

```python
import pandas as pd
from scipy.stats import norm
# update mu/sigma per player-week, save parquet
```

</details>

---

## 6. Workflows (Cron)

| Time | Workflow | Agent | Action |
|------|----------|-------|--------|
| 05:30 Tue/Fri | Build models | ff_builder | Update `models/` |
| 06:00 Daily | State + lineup | ff_orchestrator | Set roster if auto |
| 12:30–23:30 | News poll | ff_news | Flag injuries |
| 18:00 Sun | Waiver scan | ff_orchestrator | Add/drop or queue |
| 08:00 Mon | Trade scan | ff_orchestrator | Propose +EV |

---

## 7. Cost Estimate (Paid OpenRouter)
~$3–4/mo: lite for scrapes, mini for models, haiku for decisions.

---

## 8. Safety
- Trades/drops → Discord approval (timeout = cancel)
- `state.json` diff → no redundant calls
- All cookies in `.env`, git-ignored