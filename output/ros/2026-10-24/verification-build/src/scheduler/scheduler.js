/** Day-of-week constants matching `Date.prototype.getDay()`. */
export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;
export const FRIDAY = 5;
export const SATURDAY = 6;
function matchesSchedule(job, now) {
    if (job.days && !job.days.includes(now.getDay()))
        return false;
    const [hours, minutes] = job.time.split(":").map((part) => Number(part));
    return now.getHours() === hours && now.getMinutes() === minutes;
}
export class InMemoryScheduler {
    now;
    pollMs;
    keepAlive;
    jobs = new Map();
    timer;
    constructor(now = () => new Date(), pollMs = 60_000, 
    /** When true the poll timer keeps the process alive (headless daemon). */
    keepAlive = false) {
        this.now = now;
        this.pollMs = pollMs;
        this.keepAlive = keepAlive;
    }
    register(job) {
        this.jobs.set(job.jobId, job);
    }
    cancel(jobId) {
        this.jobs.delete(jobId);
    }
    listJobs() {
        return Array.from(this.jobs.values());
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.runDue();
        }, this.pollMs);
        if (!this.keepAlive && typeof this.timer.unref === "function") {
            this.timer.unref();
        }
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    async runDue(now = this.now()) {
        const fired = [];
        for (const job of this.jobs.values()) {
            if (matchesSchedule(job, now)) {
                await this.safeRun(job);
                fired.push(job.jobId);
            }
        }
        return fired;
    }
    async safeRun(job) {
        try {
            await job.handler();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Scheduler job ${job.jobId} failed: ${message}`);
        }
    }
}
