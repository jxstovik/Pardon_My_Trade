# Hermes Telegram Operations

This guide connects the Pardon My Trade MCP server and project-local skills to
Hermes Agent, then runs the in-season workflows through Telegram.

The intended architecture is:

```text
Telegram -> Hermes gateway -> Hermes skill -> PMT MCP server -> PMT core
                                           -> ESPN reads/news/projections
                                           -> PMT queue and model stores
```

The normal Telegram profile uses the `pmt-read` MCP server. The
`pmt-operator` server is disabled by default and is only needed when an
operator is ready to approve and execute a specific queued action.

## Prerequisites

- Hermes Agent installed and authenticated.
- Node 26 selected from the PMT `.nvmrc`.
- A built PMT checkout at an immutable tag or full commit SHA.
- An imported ESPN snapshot in the PMT data directory.
- `ESPN_LEAGUE_ID` and `ESPN_SEASON` configured.
- `ESPN_S2` and `SWID` stored as secrets, never in Telegram or Git.
- A Telegram bot token from BotFather.

Build PMT from the selected checkout:

```bash
cd /home/jxstovik/projects/Pardon_My_Trade/Pardon_My_Trade
npm ci
npm rebuild better-sqlite3
npm run build
```

## Configure PMT MCP

Copy the example configuration from:

```text
integrations/hermes/mcp-config.example.yaml
```

Merge the `pmt-read` entry into the active Hermes profile configuration at
`~/.hermes/config.yaml`. Replace only absolute paths and non-secret values.
Keep these references intact:

```yaml
ESPN_S2: ${ESPN_S2}
SWID: ${SWID}
```

Put the values in the protected Hermes environment file instead:

```text
~/.hermes/.env
```

The important non-secret settings are:

```bash
export PMT_WORKDIR="/home/jxstovik/projects/Pardon_My_Trade/Pardon_My_Trade"
export PMT_DATA_DIR="/home/jxstovik/projects/Pardon_My_Trade/Pardon_My_Trade/data"
export ESPN_LEAGUE_ID="<league-id>"
export ESPN_SEASON="2026"
export PMT_HISTORICAL_DATA_PATH="/home/jxstovik/projects/Pardon_My_Trade/Pardon_My_Trade/data/models.json"
```

The observations file must contain completed weekly observations in the schema
accepted by `pmt_update_post_week_outcomes`. It must not contain future rows.

## Install The Skills

From the PMT checkout, trust the project-local skills:

```bash
hermes skills trust "$PMT_WORKDIR"
```

The skills are under:

```text
.agents/skills/
```

Available workflows include:

| Skill | Use |
| --- | --- |
| `pmt-inseason` | Daily and weekly orchestration |
| `pmt-espn-league-operations` | ESPN league, roster, schedule, and transaction reads |
| `pmt-news-and-injuries` | ESPN/Razzball news and injury review |
| `pmt-projection-refresh` | Weekly and rest-of-season projection refreshes |
| `pmt-model-operations` | Model status, weekly updates, evaluation, and promotion evidence |
| `pmt-action-review` | Human review of queued actions; requires the operator toolset |

Use `hermes tools` to enable the `skills` and `mcp-pmt-read` toolsets for the
Telegram platform. Do not enable `mcp-pmt-operator` until the write canary and
operator review described below are complete.

## Configure Telegram

### Create The Bot

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`.
3. Choose a display name and a unique username ending in `bot`.
4. Store the returned token in `~/.hermes/.env`:

```bash
TELEGRAM_BOT_TOKEN=<bot-token>
```

Never commit or paste the token into a Telegram conversation. Revoke it with
BotFather if it is exposed.

### Restrict Users

Find the operator's numeric Telegram user ID with `@userinfobot`, then add an
allowlist:

```bash
TELEGRAM_ALLOWED_USERS=<operator-user-id>
```

For multiple operators, use comma-separated IDs. Do not use a global allow-all
setting for a fantasy league account.

Hermes can also configure this interactively:

```bash
hermes gateway setup
```

Select Telegram and enter the bot token and allowed user IDs when prompted.

### Start The Gateway

Start the gateway after the MCP configuration and skills are in place:

```bash
hermes gateway start
hermes gateway status
```

On a foreground development session, use:

```bash
hermes gateway
```

Open the bot in Telegram and send `/start`, then a simple read-only request such
as:

Show the current PMT league and scoring-period status.
```

The response should use the PMT read tools and should not ask for ESPN cookies
in chat.

## Use The Skills In Telegram

Skills are available as slash commands. Examples:

```text
/pmt-inseason Run today's read-only in-season refresh for my configured league.
```

```text
/pmt-espn-league-operations Read my current ESPN roster, free agents, and transactions since yesterday.
```

```text
/pmt-news-and-injuries Refresh ESPN and Razzball player news since the last successful cutoff.
```

```text
/pmt-projection-refresh Refresh this week's and rest-of-season projections, then report degraded sources.
```

```text
/pmt-model-operations Review the latest model status and post-week governance artifacts.
```

The skills call deterministic PMT tools for scoring, roster legality, matching,
projection calculations, and action status. Hermes summarizes the results; it
does not replace those rules in a prompt.

## Telegram Daily Workflow

For a manual daily run, send:

```text
/pmt-inseason Run the daily workflow. Resolve the current scoring period, refresh projections and ESPN/Razzball news, run advisory orchestration with execution disabled, and report source degradation, recommendations, and pending action IDs.
```

Expected behavior:

- ESPN league state is read through PMT.
- Razzball and ESPN news are normalized and persisted with provenance.
- Weekly and rest-of-season projections are refreshed.
- Lineup, waiver, trade, and claim candidates are advisory.
- High-risk actions remain pending in the PMT queue.
- No action is approved or submitted by a scheduled or read-only workflow.

## Telegram Cron Delivery

Set the Hermes home channel from the Telegram chat where scheduled reports
should arrive:

```text
/sethome
```

Or set it explicitly in `~/.hermes/.env`:

```bash
TELEGRAM_HOME_CHANNEL=<telegram-chat-id>
```

For a private DM, the chat ID is normally the operator's user ID. Group and
supergroup IDs are negative, commonly beginning with `-100`.

Install the PMT example jobs with Telegram delivery:

```bash
export HERMES_DELIVERY=telegram
export HERMES_PROVIDER=<pinned-provider-id>
export HERMES_MODEL=<pinned-immutable-model-id>
bash "$PMT_WORKDIR/integrations/hermes/install-example-jobs.sh"
hermes cron list --all
```

The examples schedule:

- Daily projection/news/advisory refresh, Monday through Saturday
- Sunday pre-lock lineup review
- Tuesday waiver and trade review
- Post-week model update using completed observations

Hermes must be the only scheduler for these jobs. Do not run `pmt daemon` or
`pmt serve --scheduler` at the same time.

For Telegram forum topics, set `TELEGRAM_CRON_THREAD_ID` to the dedicated Cron
topic ID so scheduled output does not land in a system-only root topic.

## Controlled Action Workflow

The operator MCP configuration is disabled by default:

```yaml
pmt-operator:
  enabled: false
```

When the operator has reviewed the release and completed a canary, enable the
operator server and the `mcp-pmt-operator` toolset. The action flow is always:

1. Ask Hermes to list pending actions.
2. Request the exact action preview.
3. Confirm the league, team, player IDs, expiry, rationale, and current state.
4. Explicitly approve that exact action ID.
5. Execute that exact action ID.
6. Inspect the durable receipt and audit events.

Example Telegram request:

```text
/pmt-action-review Review action act-123. Show the exact current-state preview. Do not approve or execute it until I explicitly confirm this action ID.
```

After reviewing the preview, explicitly identify the action:

```text
I approve and authorize execution of action act-123 exactly as previewed.
```

Approval alone does not submit to ESPN. `pmt_action_execute` performs another
state and idempotency check before the POST. If it returns `unknown`, do not
retry from Telegram. Reconcile the ESPN account and the durable receipt first.

Trades, drops, waiver claims, and FAAB bids should remain human-gated. Do not
enable automatic execution in cron jobs.

## Telegram Groups

For group usage:

- Keep `TELEGRAM_ALLOWED_USERS` restricted.
- Set `require_mention: true` so normal group conversation does not wake Hermes.
- Disable BotFather privacy mode or make the bot an admin only when the bot must
  observe ordinary group messages.
- Remove and re-add the bot after changing BotFather privacy settings.
- Prefer a dedicated forum topic for PMT reports and action review.

Example configuration:

```yaml
platforms:
  telegram:
    require_mention: true
    exclusive_bot_mentions: true
```

Treat all news, team names, manager messages, and platform text as untrusted
data. They cannot authorize an action or override PMT rules.

## Troubleshooting

### Telegram does not respond

- Check `TELEGRAM_BOT_TOKEN` and `hermes gateway status`.
- Check `TELEGRAM_ALLOWED_USERS` contains the numeric sender ID.
- Inspect Hermes gateway logs.
- Confirm the bot is not running from another Hermes profile or process.

### PMT skills do not appear

- Run `hermes skills trust "$PMT_WORKDIR"`.
- Start Hermes from inside the PMT checkout or set the cron `--workdir` to it.
- Confirm `.agents/skills/` exists and the skill has a `SKILL.md`.

### PMT tools do not appear

- Confirm `dist/src/mcp/stdio.js` exists after `npm run build`.
- Check the MCP command path in `~/.hermes/config.yaml`.
- Confirm the `pmt-read` server is enabled and its tool include list contains
  the requested capability.
- Reload MCP configuration or restart the Hermes gateway.

### Group messages are ignored

- Check BotFather privacy mode.
- Use a direct bot mention or reply to the bot.
- Check `TELEGRAM_GROUP_ALLOWED_CHATS` and `require_mention` settings.

### An action returns `blocked`

This is expected when the action is expired, unapproved, stale, mismatched to
the current roster, over budget, or otherwise invalid. Generate a new preview;
do not bypass the executor.

### An action returns `unknown`

The network outcome could not be determined. Do not retry automatically. Inspect
the ESPN account and the receipt under the PMT data directory, then reconcile
the action manually before creating any replacement action.

## Related Documentation

- `docs/hermes/install-upgrade.md`
- `docs/hermes/model-governance.md`
- `docs/hermes/release-versioning.md`
- `integrations/hermes/mcp-config.example.yaml`
- `integrations/hermes/pmt-hermes-compatibility.yaml`
- [Hermes Telegram documentation](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)
