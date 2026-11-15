import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
export class ConsoleNotificationProvider {
    async send(notification) {
        console.log(`[notification:${notification.priority}] ${notification.title} — ${notification.body}`);
        return { delivered: true, detail: "console" };
    }
}
export class FileNotificationProvider {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async send(notification) {
        const absolutePath = resolve(this.filePath);
        const line = `${notification.created_at}\t${notification.priority}\t${notification.type}\t${notification.title}\t${notification.body}\n`;
        await appendFile(absolutePath, line, "utf8");
        return { delivered: true, detail: absolutePath };
    }
}
