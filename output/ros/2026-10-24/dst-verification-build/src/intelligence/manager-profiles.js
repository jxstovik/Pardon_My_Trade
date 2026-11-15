export function updateManagerProfiles(snapshot, clock = () => new Date()) {
    const now = clock().toISOString();
    const profiles = [];
    for (const manager of snapshot.managers) {
        const team = snapshot.league.teams.find((candidate) => candidate.manager_id === manager.manager_id);
        const transactions = team?.transaction_history ?? [];
        const adds = transactions.filter((transaction) => transaction.type === "add" || transaction.type === "waiver").length;
        const drops = transactions.filter((transaction) => transaction.type === "drop").length;
        const trades = transactions.filter((transaction) => transaction.type === "trade").length;
        const aggression = trades + adds + drops;
        const tradeActivity = trades >= 3 ? "high" : trades >= 1 ? "moderate" : "low";
        profiles.push({
            manager_id: manager.manager_id,
            display_name: manager.display_name,
            observed_behavior_profile: {
                ...manager.observed_behavior_profile,
                adds,
                drops,
                trades,
                aggression,
                trade_activity: tradeActivity
            },
            updated_at: now
        });
    }
    return profiles;
}
