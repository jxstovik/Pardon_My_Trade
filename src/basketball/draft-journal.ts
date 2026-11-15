import { randomUUID } from "node:crypto";
import { open as openFile, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DraftObservationSchema, type CopilotState } from "./copilot-contracts.js";
import { contentHash } from "./store.js";

type JournalEntry = {schemaVersion:1;digest:string;state:CopilotState};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateState(value: unknown): CopilotState {
  if (!record(value)) throw new Error("Draft journal state must be an object");
  const observation = DraftObservationSchema.parse(value.observation);
  if (typeof value.revision !== "string" || !/^g\d+-[a-f0-9]{64}$/.test(value.revision)) throw new Error("Draft journal state has an invalid revision");
  if (!(value.status === "ready" || value.status === "blocked" || value.status === "stale") ||
      typeof value.paused !== "boolean" || !Array.isArray(value.issues) || value.issues.some(issue => typeof issue !== "string")) {
    throw new Error("Draft journal state has invalid status metadata");
  }
  if (contentHash(value.session) !== contentHash(observation.session)) throw new Error("Draft journal session differs from its source observation");
  return {
    revision:value.revision,
    observation,
    session:observation.session,
    status:value.status,
    paused:value.paused,
    issues:[...value.issues] as string[]
  };
}

function samePick(a: {overall:number;teamId:string;playerId:string}, b: {overall:number;teamId:string;playerId:string} | undefined): boolean {
  return !!b && a.overall === b.overall && a.teamId === b.teamId && a.playerId === b.playerId;
}

function checkAppendOrder(previous: CopilotState | null, next: CopilotState): void {
  if (!previous) return;
  const oldObs = previous.observation, newObs = next.observation;
  if (oldObs.sessionId !== newObs.sessionId) {
    if (oldObs.venue !== "local-mock" || newObs.venue !== "local-mock" ||
        next.session.phase !== "pre-draft" || next.session.picks.length !== 0) {
      throw new Error("Draft journal session identity changed outside a fresh local mock reset");
    }
    return;
  }
  if (oldObs.venue !== newObs.venue || previous.session.leagueId !== next.session.leagueId ||
      previous.session.teamId !== next.session.teamId || previous.session.boardRevision !== next.session.boardRevision ||
      JSON.stringify(previous.session.teamOrder) !== JSON.stringify(next.session.teamOrder)) {
    throw new Error("Draft journal scope changed within a session");
  }
  if (next.session.phase === "pre-draft" && previous.session.phase !== "pre-draft") {
    throw new Error("Draft journal cannot reset a session to pre-draft");
  }
  if (previous.session.phase === "complete" && next.session.phase === "live" && !newObs.correction) {
    throw new Error("Draft journal requires an explicit correction to reopen a completed draft");
  }
  if (newObs.sequence < oldObs.sequence) throw new Error("Draft journal observation sequence moved backwards");
  const picksChanged = previous.session.picks.length !== next.session.picks.length ||
    previous.session.picks.some((pick,index) => !samePick(pick,next.session.picks[index]));
  if (picksChanged && !newObs.correction) {
    const appendOnly = next.session.picks.length >= previous.session.picks.length &&
      previous.session.picks.every((pick,index) => samePick(pick,next.session.picks[index]));
    if (!appendOnly) throw new Error("Draft journal historical rewrite lacks an explicit correction event");
  }
  if (newObs.correction && !picksChanged) throw new Error("Draft journal correction has no pick-history change");
}

/** Single-writer, append-only reconciliation journal with an atomic latest-state view. */
export class DraftJournal {
  private readonly eventsPath: string;
  private readonly currentPath: string;
  private readonly leasePath: string;
  private readonly token = randomUUID();
  private leaseContents = "";
  private leaseHandle: Awaited<ReturnType<typeof openFile>> | null = null;
  private latest: CopilotState | null = null;
  private opened = false;
  private closing = false;
  private closed = false;
  private poisoned = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {
    this.eventsPath = join(directory, "observations.jsonl");
    this.currentPath = join(directory, "current.json");
    this.leasePath = join(directory, ".writer-lease");
  }

  async open(): Promise<this> {
    if (this.opened) return this;
    if (this.closed) throw new Error("Closed draft journal cannot be reopened");
    await mkdir(this.directory, {recursive:true,mode:0o700});
    this.leaseContents = JSON.stringify({token:this.token,pid:process.pid,openedAt:new Date().toISOString()}) + "\n";
    try { this.leaseHandle = await openFile(this.leasePath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Draft journal already has an active writer lease");
      throw error;
    }
    try {
      await this.leaseHandle.writeFile(this.leaseContents, "utf8");
      await this.leaseHandle.sync();
      await this.syncDirectory();
      const events = await openFile(this.eventsPath, "a+", 0o600);
      try {
        const bytes = await events.readFile();
        const completeEnd = bytes.lastIndexOf(0x0a) + 1;
        if (completeEnd !== bytes.length) await events.truncate(completeEnd);
        const complete = bytes.subarray(0,completeEnd).toString("utf8");
        let recovered: CopilotState | null = null;
        for (const line of complete.split("\n")) {
          if (!line) continue;
          const parsed = JSON.parse(line) as JournalEntry;
          if (parsed.schemaVersion !== 1 || typeof parsed.digest !== "string") throw new Error("Draft journal contains an unsupported entry");
          const state = validateState(parsed.state);
          if (parsed.digest !== contentHash(state)) throw new Error("Draft journal entry hash mismatch");
          checkAppendOrder(recovered, state);
          recovered = state;
        }
        this.latest = recovered;
        if (recovered) await this.writeCurrent(recovered);
        else {
          try {
            await readFile(this.currentPath, "utf8");
            throw new Error("Draft journal current file exists without durable history");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      } finally { await events.close(); }
      this.opened = true;
      return this;
    } catch (error) {
      await this.releaseLease();
      throw error;
    }
  }

  async current(): Promise<CopilotState | null> {
    this.assertOpen();
    return this.latest ? structuredClone(this.latest) : null;
  }

  append(stateInput: CopilotState): Promise<void> {
    this.assertOpen();
    const task = this.pending.then(async () => {
      this.assertOpen();
      const state = validateState(stateInput);
      checkAppendOrder(this.latest, state);
      if (this.latest && contentHash(this.latest) === contentHash(state)) return;
      const entry: JournalEntry = {schemaVersion:1,digest:contentHash(state),state};
      try {
        const file = await openFile(this.eventsPath, "a", 0o600);
        try {
          await file.writeFile(JSON.stringify(entry) + "\n", "utf8");
          await file.sync();
        } finally { await file.close(); }
        await this.syncDirectory();
        await this.writeCurrent(state);
        this.latest = state;
      } catch(error) {
        // The append may already be durable. Never accept another write against old memory.
        this.poisoned = true;
        throw error;
      }
    });
    this.pending = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    if (this.opened) await this.pending;
    await this.releaseLease();
    this.opened = false;
    this.closed = true;
  }

  private assertOpen(): void {
    if(this.poisoned)throw new Error("Draft journal needs close/reopen and durable replay after a write failure");
    if (!this.opened || this.closing || this.closed || !this.leaseHandle) throw new Error("Draft journal is not open");
  }

  private async writeCurrent(state: CopilotState): Promise<void> {
    const temporary = `${this.currentPath}.${randomUUID()}.tmp`;
    const file = await openFile(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(state,null,2)+"\n", "utf8");
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary,this.currentPath);
    await this.syncDirectory();
  }

  private async syncDirectory(): Promise<void> {
    const directory = await openFile(this.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async releaseLease(): Promise<void> {
    if (this.leaseHandle) {
      await this.leaseHandle.close();
      this.leaseHandle = null;
    }
    try {
      if (await readFile(this.leasePath,"utf8") === this.leaseContents) {
        await unlink(this.leasePath);
        await this.syncDirectory();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

