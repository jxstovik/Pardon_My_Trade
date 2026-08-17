import Database from "better-sqlite3";
import type { NewsItem } from "../models/types.js";
import type {
  HistoricalRecord,
  ManagerProfileRecord,
  NotificationRecord
} from "../models/v1.js";
import type { V1Store } from "./v1-store.js";

export interface SqliteV1StoreOptions {
  readonly filePath?: string;
  readonly memory?: boolean;
}

export class SqliteV1Store implements V1Store {
  private readonly db: Database.Database;

  constructor(options: SqliteV1StoreOptions = {}) {
    const filePath = options.memory ? ":memory:" : (options.filePath ?? ":memory:");
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  async saveNews(leagueId: string, items: NewsItem[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO v1_news (news_id, player_id, league_ref, data, published_at)
       VALUES (@news_id, @player_id, @league_ref, @data, @published_at)
       ON CONFLICT(news_id) DO UPDATE SET data = excluded.data`
    );
    const tx = this.db.transaction((rows: NewsItem[]) => {
      for (const item of rows) {
        insert.run({
          news_id: item.news_id,
          player_id: item.player_id,
          league_ref: leagueId,
          data: JSON.stringify(item),
          published_at: item.published_at
        });
      }
    });
    tx(items);
  }

  async getNews(leagueId: string, since?: string): Promise<NewsItem[]> {
    const base = "SELECT data FROM v1_news WHERE league_ref = ?";
    const sql = since ? `${base} AND published_at >= ?` : base;
    const params = since ? [leagueId, since] : [leagueId];
    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as NewsItem);
  }

  async recordHistory(record: HistoricalRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO v1_history (record_id, league_id, snapshot_id, data, captured_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(record.record_id, record.league_id, record.snapshot_id, JSON.stringify(record), record.captured_at);
  }

  async getHistory(leagueId: string): Promise<HistoricalRecord[]> {
    const rows = this.db
      .prepare("SELECT data FROM v1_history WHERE league_id = ? ORDER BY captured_at DESC")
      .all(leagueId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as HistoricalRecord);
  }

  async saveManagerProfile(profile: ManagerProfileRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO v1_manager_profiles (manager_id, display_name, data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(manager_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      )
      .run(`${profile.league_id}:${profile.manager_id}`, profile.display_name, JSON.stringify(profile), profile.updated_at);
  }

  async getManagerProfiles(leagueId: string): Promise<ManagerProfileRecord[]> {
    const rows = this.db
      .prepare("SELECT data FROM v1_manager_profiles WHERE json_extract(data, '$.league_id') = ?")
      .all(leagueId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as ManagerProfileRecord);
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO v1_notifications (notification_id, league_id, data, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(record.notification_id, record.league_id, JSON.stringify(record), record.created_at);
  }

  async getNotifications(leagueId: string): Promise<NotificationRecord[]> {
    const rows = this.db
      .prepare("SELECT data FROM v1_notifications WHERE league_id = ? ORDER BY created_at DESC")
      .all(leagueId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as NotificationRecord);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS v1_news (
        news_id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        league_ref TEXT NOT NULL,
        data TEXT NOT NULL,
        published_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v1_history (
        record_id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        data TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v1_manager_profiles (
        manager_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v1_notifications (
        notification_id TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v1_news_league ON v1_news(league_ref);
      CREATE INDEX IF NOT EXISTS idx_v1_history_league ON v1_history(league_id);
      CREATE INDEX IF NOT EXISTS idx_v1_notifications_league ON v1_notifications(league_id);
    `);
  }
}
