const DEFAULT_ITERATIONS = 2000;
const DEFAULT_CONFIDENCE_LEVEL = 0.95;
const DEFAULT_SEED = 0x6d2b79f5;
export function clusterBootstrapCI(rows, statistic, options = {}) {
    const settings = normalizeOptions(options);
    const clusters = groupByScoringPeriod(rows);
    if (rows.length === 0) {
        return {
            estimate: 0,
            lower: 0,
            upper: 0,
            confidenceLevel: settings.confidenceLevel,
            samples: 0,
            clusters: 0,
            replicates: settings.iterations
        };
    }
    const estimate = finiteStatistic(statistic(rows), "statistic");
    const random = createRandom(settings.seed);
    const values = [];
    for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
        const sample = [];
        for (let draw = 0; draw < clusters.length; draw += 1) {
            sample.push(...clusters[Math.floor(random() * clusters.length)]);
        }
        values.push(finiteStatistic(statistic(sample), "bootstrap statistic"));
    }
    values.sort((left, right) => left - right);
    const tail = (1 - settings.confidenceLevel) / 2;
    return {
        estimate,
        lower: percentile(values, tail),
        upper: percentile(values, 1 - tail),
        confidenceLevel: settings.confidenceLevel,
        samples: rows.length,
        clusters: clusters.length,
        replicates: settings.iterations
    };
}
export function bootstrapConfidenceInterval(rows, statistic, options = {}) {
    return clusterBootstrapCI(rows, statistic, options);
}
export function pairedClusterBootstrapCI(rows, delta, options = {}) {
    return clusterBootstrapCI(rows, (sample) => mean(sample.map(delta)), options);
}
export function pairedDeltaConfidenceInterval(rows, deltaOrOptions = {}, options = {}) {
    const delta = typeof deltaOrOptions === "function"
        ? deltaOrOptions
        : (row) => {
            const paired = row;
            if (typeof paired.baseline !== "number" || typeof paired.candidate !== "number") {
                throw new Error("paired delta rows require baseline and candidate values");
            }
            return paired.candidate - paired.baseline;
        };
    const settings = typeof deltaOrOptions === "function" ? options : deltaOrOptions;
    return pairedClusterBootstrapCI(rows, delta, settings);
}
export const pairedDeltaCI = pairedDeltaConfidenceInterval;
function groupByScoringPeriod(rows) {
    const groups = new Map();
    for (const row of rows) {
        const group = groups.get(row.scoringPeriod) ?? [];
        group.push(row);
        groups.set(row.scoringPeriod, group);
    }
    return [...groups.values()];
}
function normalizeOptions(options) {
    const iterations = options.iterations ?? options.replicates ?? DEFAULT_ITERATIONS;
    const confidenceLevel = options.confidenceLevel ?? DEFAULT_CONFIDENCE_LEVEL;
    if (!Number.isInteger(iterations) || iterations <= 0)
        throw new Error("bootstrap iterations must be a positive integer");
    if (!Number.isFinite(confidenceLevel) || confidenceLevel <= 0 || confidenceLevel >= 1) {
        throw new Error("confidenceLevel must be between 0 and 1");
    }
    const seed = options.seed ?? DEFAULT_SEED;
    if (!Number.isFinite(seed))
        throw new Error("bootstrap seed must be finite");
    return { iterations, confidenceLevel, seed };
}
function createRandom(seed) {
    let state = Math.trunc(seed) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
function percentile(values, probability) {
    if (values.length === 0)
        return 0;
    const position = (values.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper)
        return values[lower];
    const fraction = position - lower;
    return values[lower] + (values[upper] - values[lower]) * fraction;
}
function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function finiteStatistic(value, name) {
    if (!Number.isFinite(value))
        throw new Error(`${name} must be finite`);
    return value;
}
