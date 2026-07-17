import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NotificationRecord } from "../models/v1.js";

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly detail: string;
}

export interface NotificationProvider {
  send(notification: NotificationRecord): Promise<DeliveryResult>;
}

export class ConsoleNotificationProvider implements NotificationProvider {
  async send(notification: NotificationRecord): Promise<DeliveryResult> {
    console.log(`[notification:${notification.priority}] ${notification.title} — ${notification.body}`);
    return { delivered: true, detail: "console" };
  }
}

export class FileNotificationProvider implements NotificationProvider {
  constructor(private readonly filePath: string) {}

  async send(notification: NotificationRecord): Promise<DeliveryResult> {
    const absolutePath = resolve(this.filePath);
    const line = `${notification.created_at}\t${notification.priority}\t${notification.type}\t${notification.title}\t${notification.body}\n`;
    await appendFile(absolutePath, line, "utf8");
    return { delivered: true, detail: absolutePath };
  }
}
