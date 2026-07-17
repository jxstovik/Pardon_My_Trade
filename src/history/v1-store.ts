import type { NewsItem } from "../models/types.js";
import type {
  HistoricalRecord,
  ManagerProfileRecord,
  NotificationRecord
} from "../models/v1.js";

export interface V1Store {
  saveNews(leagueId: string, items: NewsItem[]): Promise<void>;
  getNews(leagueId: string, since?: string): Promise<NewsItem[]>;
  recordHistory(record: HistoricalRecord): Promise<void>;
  getHistory(leagueId: string): Promise<HistoricalRecord[]>;
  saveManagerProfile(profile: ManagerProfileRecord): Promise<void>;
  getManagerProfiles(leagueId: string): Promise<ManagerProfileRecord[]>;
  saveNotification(record: NotificationRecord): Promise<void>;
  getNotifications(leagueId: string): Promise<NotificationRecord[]>;
}

export class InMemoryV1Store implements V1Store {
  private readonly news = new Map<string, NewsItem[]>();
  private readonly history: HistoricalRecord[] = [];
  private readonly profiles = new Map<string, ManagerProfileRecord>();
  private readonly notifications: NotificationRecord[] = [];

  async saveNews(leagueId: string, items: NewsItem[]): Promise<void> {
    const byId = new Map<string, NewsItem>();
    for (const item of (this.news.get(leagueId) ?? [])) byId.set(item.news_id, item);
    for (const item of items) byId.set(item.news_id, item);
    this.news.set(leagueId, Array.from(byId.values()));
  }

  async getNews(leagueId: string, since?: string): Promise<NewsItem[]> {
    const items = this.news.get(leagueId) ?? [];
    return since ? items.filter((item) => item.published_at >= since) : [...items];
  }

  async recordHistory(record: HistoricalRecord): Promise<void> {
    this.history.push(record);
  }

  async getHistory(leagueId: string): Promise<HistoricalRecord[]> {
    return this.history.filter((record) => record.league_id === leagueId);
  }

  async saveManagerProfile(profile: ManagerProfileRecord): Promise<void> {
    this.profiles.set(profile.manager_id, profile);
  }

  async getManagerProfiles(_leagueId: string): Promise<ManagerProfileRecord[]> {
    return Array.from(this.profiles.values());
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    this.notifications.push(record);
  }

  async getNotifications(_leagueId: string): Promise<NotificationRecord[]> {
    return [...this.notifications];
  }
}
