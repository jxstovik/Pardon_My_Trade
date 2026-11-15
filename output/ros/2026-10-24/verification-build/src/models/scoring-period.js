/** Canonical period identity; W4 and W04 describe the same weekly target. */
export function canonicalScoringPeriod(period) {
    const match = /^(\d{4})-W(\d+)$/i.exec(period);
    return match ? `${match[1]}-W${Number(match[2])}` : period;
}
export function sameScoringPeriod(left, right) {
    return canonicalScoringPeriod(left) === canonicalScoringPeriod(right);
}
