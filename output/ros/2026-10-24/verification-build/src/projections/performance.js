export function evaluatePredictions(observations, intervals) {
    const groups = new Map();
    for (const observation of observations) {
        const group = groups.get(observation.source) ?? [];
        group.push(observation);
        groups.set(observation.source, group);
    }
    return [...groups.entries()].map(([source, rows]) => {
        const errors = rows.map((row) => row.predicted - row.actual);
        const covered = rows.filter((row) => {
            const prediction = intervals?.get(`${row.source}:${row.playerId}:${row.scoringPeriod}`);
            return prediction ? row.actual >= prediction.quantiles.p10 && row.actual <= prediction.quantiles.p90 : false;
        });
        return {
            source,
            samples: rows.length,
            mae: average(errors.map(Math.abs)),
            rmse: Math.sqrt(average(errors.map((error) => error * error))),
            bias: average(errors),
            ...(intervals ? { intervalCoverage: covered.length / rows.length } : {})
        };
    }).sort((a, b) => a.rmse - b.rmse);
}
function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
