export type JobHandler = () => Promise<void> | void;

/** Day-of-week constants matching `Date.prototype.getDay()`. */
export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;
export const FRIDAY = 5;
export const SATURDAY = 6;

export interface ScheduledJob {
  readonly jobId: string;
  readonly name: string;
  readonly time: string;
  /**
   * Days of the week (0 = Sunday) the job may fire on. Omitted means every
   * day, preserving the original daily-only behaviour.
   */
  readonly days?: readonly number[];
  readonly handler: JobHandler;
}

export interface Scheduler {
  register(job: ScheduledJob): void;
  cancel(jobId: string): void;
  listJobs(): ScheduledJob[];
  start(): void;
  stop(): void;
}

function matchesSchedule(job: ScheduledJob, now: Date): boolean {
  if (job.days && !job.days.includes(now.getDay())) return false;
  const [hours, minutes] = job.time.split(":").map((part) => Number(part));
  return now.getHours() === hours && now.getMinutes() === minutes;
}

export class InMemoryScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly pollMs = 60_000,
    /** When true the poll timer keeps the process alive (headless daemon). */
    private readonly keepAlive = false
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
    if (!this.keepAlive && typeof this.timer.unref === "function") {
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
      if (matchesSchedule(job, now)) {
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
