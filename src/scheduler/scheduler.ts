export type JobHandler = () => Promise<void> | void;

export interface ScheduledJob {
  readonly jobId: string;
  readonly name: string;
  readonly time: string;
  readonly handler: JobHandler;
}

export interface Scheduler {
  register(job: ScheduledJob): void;
  cancel(jobId: string): void;
  listJobs(): ScheduledJob[];
  start(): void;
  stop(): void;
}

function matchesDaily(time: string, now: Date): boolean {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return now.getHours() === hours && now.getMinutes() === minutes;
}

export class InMemoryScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly pollMs = 60_000
  ) {}

  register(job: ScheduledJob): void {
    this.jobs.set(job.jobId, job);
  }

  cancel(jobId: string): void {
    this.jobs.delete(jobId);
  }

  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, this.pollMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runDue(now: Date = this.now()): Promise<string[]> {
    const fired: string[] = [];
    for (const job of this.jobs.values()) {
      if (matchesDaily(job.time, now)) {
        await this.safeRun(job);
        fired.push(job.jobId);
      }
    }
    return fired;
  }

  private async safeRun(job: ScheduledJob): Promise<void> {
    try {
      await job.handler();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Scheduler job ${job.jobId} failed: ${message}`);
    }
  }
}
