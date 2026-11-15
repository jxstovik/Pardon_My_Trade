export function calibrationMetrics(rows) {
    if (!rows.length)
        return { samples: 0, meanAbsoluteError: 0, p10Coverage: 0, p90Coverage: 0, intervalCoverage: 0, averageSpread: 0 };
    const abs = rows.map(({ prediction, actual }) => Math.abs(prediction.mean - actual));
    return {
        samples: rows.length,
        meanAbsoluteError: average(abs),
        p10Coverage: rows.filter(({ prediction, actual }) => actual >= prediction.quantiles.p10).length / rows.length,
        p90Coverage: rows.filter(({ prediction, actual }) => actual <= prediction.quantiles.p90).length / rows.length,
        intervalCoverage: rows.filter(({ prediction, actual }) => actual >= prediction.quantiles.p10 && actual <= prediction.quantiles.p90).length / rows.length,
        averageSpread: average(rows.map(({ prediction }) => prediction.standardDeviation))
    };
}
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
