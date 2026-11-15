export class InMemoryV1Store {
    news = new Map();
    history = [];
    profiles = new Map();
    notifications = [];
    async saveNews(leagueId, items) {
        const byId = new Map();
        for (const item of (this.news.get(leagueId) ?? []))
            byId.set(item.news_id, item);
        for (const item of items)
            byId.set(item.news_id, item);
        this.news.set(leagueId, Array.from(byId.values()));
    }
    async getNews(leagueId, since) {
        const items = this.news.get(leagueId) ?? [];
        return since ? items.filter((item) => item.published_at >= since) : [...items];
    }
    async recordHistory(record) {
        this.history.push(record);
    }
    async getHistory(leagueId) {
        return this.history.filter((record) => record.league_id === leagueId);
    }
    async saveManagerProfile(profile) {
        this.profiles.set(profile.manager_id, profile);
    }
    async getManagerProfiles(_leagueId) {
        return Array.from(this.profiles.values());
    }
    async saveNotification(record) {
        this.notifications.push(record);
    }
    async getNotifications(_leagueId) {
        return [...this.notifications];
    }
}
