import { evaluatePredictions } from "./performance.js";
export function runHistoricalBacktest(history, modelFactory, sourceMeans = new Map()) {
    const periods = [...new Set(history.map((row) => row.scoringPeriod))].sort(compareScoringPeriods);
    const predictions = [];
    const observations = [];
    for (let index = 1; index < periods.length; index += 1) {
        const training = history.filter((row) => periods.indexOf(row.scoringPeriod) < index);
        const model = modelFactory(training);
        for (const actual of history.filter((row) => row.scoringPeriod === periods[index])) {
            const row = {
                playerId: actual.playerId,
                position: actual.position,
                scoringPeriod: actual.scoringPeriod,
                sourceMean: sourceMeans.get(`${actual.playerId}:${actual.scoringPeriod}`),
                history: training.filter((prior) => prior.playerId === actual.playerId).map((prior) => prior.points)
            };
            const prediction = model.predict(row);
            predictions.push(prediction);
            observations.push({ playerId: actual.playerId, scoringPeriod: actual.scoringPeriod, source: model.name, predicted: prediction.mean, actual: actual.points });
        }
    }
    return { metrics: evaluatePredictions(observations), predictions };
}
function compareScoringPeriods(left, right) {
    const leftMatch = /^(\d{4})-W(\d+)$/.exec(left);
    const rightMatch = /^(\d{4})-W(\d+)$/.exec(right);
    if (!leftMatch || !rightMatch)
        return left.localeCompare(right);
    return Number(leftMatch[1]) - Number(rightMatch[1]) || Number(leftMatch[2]) - Number(rightMatch[2]);
}
