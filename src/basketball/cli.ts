import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { PROFILE_NAMES, OVERLAYS, instant } from "./contracts.js";
import { readConfig, importCapture, currentCapture, readPolicy, selectPolicy, PROFILES } from "./store.js";
import { createReadinessReport, renderReadinessMarkdown, saveReport } from "./report.js";
import { readFantrax, READ_ENDPOINTS, FantraxReadError } from "./fantrax-reader.js";
import { aggregateCategories, compareCategories } from "./categories.js";
import { importPlayerPool, readPlayerPool, renderPlayerPool } from "./player-pool.js";
import { importHistory, readHistory, readHistoryRevision, renderHistory } from "./history.js";
import { buildDraftBoard, DraftStatusSchema, FORECAST_RECIPE, SupplementSchema, saveDraftBoard, type DraftBoard, type DraftForecastRecipe } from "./forecast.js";
import { recommendDraft } from "./draft.js";
import { contentHash } from "./store.js";
import { buildWeeklyReport, renderWeeklyReport } from "./weekly.js";
import { ReconciliationEvidenceSchema, reconcileDraftBoard, saveReconciliation, verifyEvidenceSourceFiles, verifyFrozenBoard, type ReconciliationResult } from "./reconcile.js";

const args = process.argv.slice(2);
const value = (flag: string, fallback?: string): string | undefined => {
  const index = args.indexOf(flag); if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return args[index + 1];
};
const required = (flag: string): string => {const result = value(flag); if (!result) throw new Error(`Required ${flag}`); return result;};

const projectionFields:Record<string,string>={MIN:"minutes",PTS:"PTS",REB:"REB",AST:"AST",ST:"ST",BLK:"BLK","3PTM":"threeMade",GP:"GP",TO:"TO",DD:"DD",TD:"TD",FGM:"FGM",FGA:"FGA",FTM:"FTM",FTA:"FTA",providerRank:"providerRank"};
function mergeProviderEvidence(baseInput:unknown,evidence:z.infer<typeof ReconciliationEvidenceSchema>) {
  const supplement=SupplementSchema.parse(structuredClone(baseInput));
  const players=new Map(supplement.players.map(player=>[player.fantraxId,player]));
  const sources=evidence.sources.filter(source=>source.kind==="provider-projection").sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  for(const source of sources)for(const record of source.records) {
    if(!record.fantraxId)continue;
    let player=players.get(record.fantraxId);
    if(!player) {
      const minutes=record.values.MIN,PTS=record.values.PTS,REB=record.values.REB,AST=record.values.AST;
      const name=record.providerName??record.name,schoolLabel=record.schoolLabel;
      if(typeof minutes!=="number"||typeof PTS!=="number"||typeof REB!=="number"||typeof AST!=="number"||!name||!schoolLabel)continue;
      player={fantraxId:record.fantraxId,name,schoolLabel,minutes,PTS,REB,AST,providerRank:null,notes:`Projection line sourced from ${source.id}.`,matchMethod:record.matchMethod??"Evidence manifest stable-ID reconciliation",fieldObservedAt:{}};
      supplement.players.push(player);players.set(player.fantraxId,player);
    }
    const mutable=player as unknown as Record<string,unknown>;
    const timestamps={...(player.fieldObservedAt??{})};
    for(const [sourceField,targetField] of Object.entries(projectionFields)) {
      const supplied=record.values[sourceField];
      if(typeof supplied!=="number"||!Number.isFinite(supplied))continue;
      const observed=record.fieldObservedAt[sourceField]??source.observedAt;
      const previous=timestamps[sourceField];
      if(previous&&Date.parse(previous)>=Date.parse(observed))continue;
      mutable[targetField]=supplied;
      timestamps[sourceField]=observed;
    }
    player.fieldObservedAt=timestamps;
  }
  return SupplementSchema.parse(supplement);
}

async function main(): Promise<void> {
  const command = args[0] ?? "help";
  if (command === "help" || command === "--help") {
    console.log("Basketball read-only CLI (build first). Commands:\n  weekly-forecast --board <approved-board.json> --input <weekly-capture.json> --out <directory>\n  import --bundle <capture.json>\n  pool-import --csv <official.csv> --metadata <source.json>\n  pool-report\n  history-import --csv <standard.csv> --metadata <source.json>\n  history-report\n  draft-forecast --out <directory> [--supplement <provider.json>]\n  draft-reconcile --board <frozen-board.json> --evidence <manifest.json> --out <directory> --as-of <offset instant>\n  draft-recommend --board <board.json> --state <local-session.json>\n  copilot --board <board.json> --state <session.json> [--mode mock|coach] [--copilot-data <dir>] [--port N]\n  doctor | report | refresh\n  strategies\n  strategy-set --profile balanced|bigs|guards [--overlay schedule-pressure|must-win|playoff-runway --period N]\n  probe --endpoint getLeagueInfo|getTeamRosters|getStandings|getDraftResults|getMatchupScores [--period N]\n  demo --out <directory>\nCommon: --config config/basketball/banging-3s.json --data-root data/basketball --as-of <offset instant>\nrefresh analyzes saved evidence; it does not fetch live data. probe never imports or overwrites snapshots. No platform writer exists."); return;
  }
  if(command==="draft-reconcile") {
    const config = await readConfig(resolve(value("--config", "config/basketball/banging-3s.json")!));
    const root = resolve(value("--data-root", "data/basketball")!);
    const asOfArg=required("--as-of");
    const asOf=new Date(instant.parse(asOfArg));
    const boardPath=resolve(required("--board")),manifestPath=resolve(required("--evidence"));
    const baseline=JSON.parse(await readFile(boardPath,"utf8")) as DraftBoard;
    const manifest=ReconciliationEvidenceSchema.parse(JSON.parse(await readFile(manifestPath,"utf8")));
    const sourceArtifacts=await verifyEvidenceSourceFiles(manifest,process.cwd());
    const baselineFileSha256=await verifyFrozenBoard(boardPath,manifest,baseline);
    if(baseline.leagueId!==config.leagueId||baseline.teamId!==config.teamId||baseline.season!==config.rules.seasonLabel)throw new Error("Frozen board does not match configured league/team/season");
    const baselineHistory=await readHistoryRevision(root,config,baseline.inputs.historyRevision);
    const oldSupplement=SupplementSchema.parse(JSON.parse(await readFile(resolve(value("--supplement","config/basketball/provider-supplement.json")!),"utf8")));
    const oldStatus=DraftStatusSchema.parse(JSON.parse(await readFile(resolve(value("--status","config/basketball/draft-status.json")!),"utf8")));
    if(contentHash(oldSupplement)!==baseline.inputs.supplementHash||contentHash(oldStatus)!==baseline.inputs.statusHash)throw new Error("Pinned frozen-board supplement/status inputs do not reproduce their hashes");
    const poolSource=manifest.sources.filter(s=>s.kind==="available-pool").sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
    if(!poolSource?.artifactPath)throw new Error("Evidence manifest has no complete available-pool source");
    const wrapper=JSON.parse(await readFile(resolve(process.cwd(),poolSource.artifactPath),"utf8")) as {upstreamArtifactPath?:string};
    if(!wrapper.upstreamArtifactPath)throw new Error("Fresh pool evidence lacks its normalized history revision path");
    const historyFilename=wrapper.upstreamArtifactPath.split(/[\\/]/).at(-1)??"";
    const historyRevision=historyFilename.replace(/\.json$/i,"");
    const candidateHistory=await readHistoryRevision(root,config,historyRevision);
    const availableRecords=poolSource.records.filter(r=>r.values.available===true&&r.fantraxId);
    const historyIds=new Set(candidateHistory.players.map(p=>p.fantraxId));
    const poolIds=new Set(availableRecords.map(r=>r.fantraxId!));
    if(historyIds.size!==poolIds.size||[...historyIds].some(id=>!poolIds.has(id)))throw new Error("Normalized current history IDs do not exactly match hashed complete-pool evidence");
    const candidateSupplement=mergeProviderEvidence(oldSupplement,manifest);
    const currentIds=historyIds;
    candidateSupplement.players=candidateSupplement.players.filter(p=>currentIds.has(p.fantraxId));
    const candidateStatus={...oldStatus,observations:oldStatus.observations.filter(s=>currentIds.has(s.fantraxId))};
    const candidateBase=buildDraftBoard(config,candidateHistory,candidateSupplement,asOf,candidateStatus,baseline.recipe??FORECAST_RECIPE);
    const frozenSupplement=oldSupplement,frozenStatus=oldStatus,frozenRecipe=baseline.recipe??FORECAST_RECIPE;
    const priorStrengthReplay=(multiplier:number)=>{
      const recipe:DraftForecastRecipe=multiplier===1?frozenRecipe:{...frozenRecipe,priorGames:frozenRecipe.priorGames*multiplier,fgPseudoAttempts:frozenRecipe.fgPseudoAttempts*multiplier,ftPseudoAttempts:frozenRecipe.ftPseudoAttempts*multiplier,version:`${frozenRecipe.version}-prior-strength-${multiplier}x`};
      return buildDraftBoard(config,baselineHistory,frozenSupplement,new Date(baseline.generatedAt),frozenStatus,recipe);
    };
    const result=reconcileDraftBoard(baseline,manifest,JSON.parse(await readFile(resolve(value("--scenarios","config/basketball/draft-reconciliation-scenarios.v1.json")!),"utf8")),asOf,baselineFileSha256,{
      candidateBase,priorStrengthReplay,baselineReproduction:{status:"exact-match",rebuiltRevision:priorStrengthReplay(1).revision,historyRevision:baselineHistory.revision,historyRawSha256:baselineHistory.rawSha256,
        supplementHash:contentHash(oldSupplement),statusHash:contentHash(oldStatus),currentPoolHistoryRevision:candidateHistory.revision,verifiedEvidenceSources:sourceArtifacts}
    });
    const out=resolve(required("--out"));
    const revisionDir=await saveReconciliation(out,result);
    console.log(JSON.stringify({revision:result.revision,report:result.report,revisionDir,liveActionsExecuted:0},null,2));return;
  }
  const now = new Date(instant.parse(value("--as-of", new Date().toISOString())));
  if (command === "demo") {
    const a = aggregateCategories([{PTS:25, REB:8, AST:4, ST:2, BLK:1, "3PTM":3, FGM:9, FGA:20, FTM:4, FTA:5}, {PTS:10, REB:5, AST:2, ST:0, BLK:3, "3PTM":0, FGM:5, FGA:5, FTM:0, FTA:0}]);
    const b = aggregateCategories([{PTS:32, REB:10, AST:8, ST:2, BLK:2, "3PTM":4, FGM:12, FGA:24, FTM:4, FTA:6}]);
    const output = {synthetic: true, label: "Arithmetic demonstration; no real players or forecasts", a, b,
      explicitPolicy: {kind: "synthetic-exact" as const, minimumFGA: 0, minimumFTA: 0},
      categoryResults: compareCategories(a, b, {kind: "synthetic-exact", minimumFGA: 0, minimumFTA: 0})};
    const directory = resolve(required("--out")); await mkdir(directory, {recursive: true});
    await writeFile(resolve(directory, "synthetic-category-demo.json"), JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify(output, null, 2)); return;
  }
  const config = await readConfig(resolve(value("--config", "config/basketball/banging-3s.json")!));
  const root = resolve(value("--data-root", "data/basketball")!);
  if(command === "weekly-forecast") {
    const board=JSON.parse(await readFile(resolve(required("--board")),"utf8")) as DraftBoard;
    if(board.leagueId!==config.leagueId||board.teamId!==config.teamId||board.season!==config.rules.seasonLabel)throw new Error("Weekly board does not match configured scope");
    const report=buildWeeklyReport(board,JSON.parse(await readFile(resolve(required("--input")),"utf8")),now);
    const out=resolve(required("--out"),report.revision);await mkdir(out,{recursive:true});
    const {immutableText}=await import("./store.js");
    await immutableText(resolve(out,"weekly-report.json"),JSON.stringify(report,null,2)+"\n");
    await immutableText(resolve(out,"weekly-report.md"),renderWeeklyReport(report));
    console.log(JSON.stringify({revision:report.revision,out,status:report.status,owned:report.ranked.filter(p=>p.ownership==="own").length,available:report.ranked.filter(p=>p.ownership!=="own").length,blockers:report.blockers,liveActionsExecuted:0},null,2));return;
  }
  if(command === "copilot") {
    const board=JSON.parse(await readFile(resolve(required("--board")),"utf8")) as DraftBoard;
    const {revision,...content}=board;
    const {contentHash}=await import("./store.js");
    if(contentHash(content)!==revision||board.leagueId!==config.leagueId||board.teamId!==config.teamId||board.season!==config.rules.seasonLabel)throw new Error("Copilot board hash or configured scope mismatch");
    const {DraftSessionSchema}=await import("./draft.js");
    const session=DraftSessionSchema.parse(JSON.parse(await readFile(resolve(required("--state")),"utf8")));
    const mode=z.enum(["mock","coach"]).parse(value("--mode","mock"));
    const port=z.coerce.number().int().min(0).max(65535).parse(value("--port","0"));
    const {startCopilotServer}=await import("./copilot-server.js");
    const comparisonDir=value("--reconciliation");
    let reconciliation:Pick<ReconciliationResult,"report"|"correctedBoard"|"providerFirstRankOnly">|undefined;
    if(comparisonDir) {
      const files=await Promise.all(["reconciliation.json","corrected-category-board.json","provider-first-rank-only.json"].map(name=>readFile(resolve(comparisonDir,name),"utf8")));
      reconciliation={report:JSON.parse(files[0]!),correctedBoard:JSON.parse(files[1]!),providerFirstRankOnly:JSON.parse(files[2]!)};
    }
    const started=await startCopilotServer({board,session,mode,port,reconciliation,dataDir:resolve(value("--copilot-data",`${root}/${config.leagueId}/copilot/${mode}`)!)});
    console.log(JSON.stringify({status:"ready",url:started.url,mode,liveActionsExecuted:0},null,2));
    const stop=()=>{void started.close().catch(error=>{console.error(String(error));process.exitCode=1;});};
    process.once("SIGINT",stop);process.once("SIGTERM",stop);return;
  }
  if(command === "draft-forecast") {
    const supplement=JSON.parse(await readFile(resolve(value("--supplement","config/basketball/provider-supplement.json")!),"utf8"));
    const status=JSON.parse(await readFile(resolve(value("--status","config/basketball/draft-status.json")!),"utf8"));
    const board=buildDraftBoard(config,await readHistory(root,config),supplement,now,status),out=resolve(required("--out"));
    await saveDraftBoard(root,config,board,out);
    console.log(JSON.stringify({revision:board.revision,status:board.status,counts:board.counts,out,liveActionsExecuted:0},null,2));return;
  }
  if(command === "draft-recommend") {
    const board=JSON.parse(await readFile(resolve(required("--board")),"utf8")) as DraftBoard;
    if(board.leagueId!==config.leagueId||board.teamId!==config.teamId||board.season!==config.rules.seasonLabel)throw new Error("Draft board does not match configured league/team/season");
    const {revision,...content}=board;
    const {contentHash}=await import("./store.js");
    if(contentHash(content)!==revision)throw new Error("Draft board hash mismatch");
    const state=JSON.parse(await readFile(resolve(required("--state")),"utf8"));
    console.log(JSON.stringify(recommendDraft(board,state,now),null,2));return;
  }
  if (command === "history-import") {
    const h=await importHistory(root,config,JSON.parse(await readFile(resolve(required("--metadata")),"utf8")),await readFile(resolve(required("--csv"))),now);
    console.log(JSON.stringify({revision:h.revision,rawSha256:h.rawSha256,source:h.source,quality:h.quality},null,2)); return;
  }
  if (command === "history-report") {console.log(renderHistory(await readHistory(root,config))); return;}
  if (command === "pool-import") {
    const pool = await importPlayerPool(root, config, JSON.parse(await readFile(resolve(required("--metadata")), "utf8")), await readFile(resolve(required("--csv"))), now);
    console.log(JSON.stringify({revision:pool.revision, rawSha256:pool.rawSha256, source:pool.source, quality:pool.quality, directory:pool.directory}, null, 2)); return;
  }
  if (command === "pool-report") {console.log(renderPlayerPool(await readPlayerPool(root, config))); return;}
  if (command === "strategies") {console.log(JSON.stringify({selected: (await readPolicy(root, config))?.profile ?? config.initialProfile, profiles: PROFILES, overlays: OVERLAYS, forecastsAvailable: false}, null, 2)); return;}
  if (command === "strategy-set") {
    const profile = z.enum(PROFILE_NAMES).parse(required("--profile")), overlay = z.enum(OVERLAYS).parse(value("--overlay", "none"));
    const effectivePeriod = value("--period") === undefined ? null : z.number().int().positive().parse(Number(value("--period")));
    const result = await selectPolicy(root, config, {profile, overlay, effectivePeriod}, now);
    console.log(JSON.stringify({policy: result, note: "Preference saved. No live action or forecast change claimed."}, null, 2)); return;
  }
  if (command === "probe") {
    const endpoint = z.enum(READ_ENDPOINTS).parse(required("--endpoint"));
    if ((endpoint === "getTeamRosters" || endpoint === "getMatchupScores") && value("--period") === undefined) throw new Error("An explicit --period is required; never rely on rollover defaults");
    const result = await readFantrax(endpoint, config.leagueId, {period: value("--period") === undefined ? undefined : Number(value("--period"))});
    console.log(JSON.stringify({endpoint, result, imported: false}, null, 2)); return;
  }
  if (command === "import") {
    const stored = await importCapture(root, config, JSON.parse(await readFile(resolve(required("--bundle")), "utf8")), now);
    if (await readPolicy(root, config) === null) await selectPolicy(root, config, {profile: config.initialProfile, overlay: "none", effectivePeriod: null}, now);
    console.log(JSON.stringify({snapshotId: stored.snapshotId, captureHash: stored.captureHash, ingestedAt: stored.ingestedAt, sourceKind: stored.capture.leagueSource.kind, originalPayloadHash: null}, null, 2)); return;
  }
  if (["doctor", "report", "refresh"].includes(command)) {
    const report = createReadinessReport(config, await currentCapture(root, config), await readPolicy(root, config), now);
    const output = await saveReport(root, config, report);
    console.log(command === "doctor" ? JSON.stringify({...report, output}, null, 2) : renderReadinessMarkdown(report) + `\nSaved: ${output.directory}`); return;
  }
  throw new Error(`Unsupported basketball command: ${command}`);
}
main().catch(error => {console.error(JSON.stringify({status: "failed", code: error instanceof FantraxReadError ? error.code : "BASKETBALL_COMMAND_FAILED", message: error instanceof Error ? error.message : String(error), liveActionsExecuted: 0})); process.exitCode = 1;});
