import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
function localDateStamp(clock) {
    const d = clock();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}
export function renderRecommendationMarkdown(content) {
    const clock = content.clock ?? (() => new Date());
    const title = `${content.source.toUpperCase()} ${content.query} (${clock().getFullYear()})`;
    const showFC = content.showFloorCeiling ?? content.rows.some((r) => r.floor !== undefined || r.ceiling !== undefined);
    const header = [
        "---",
        `source: ${content.source}`,
        `query: ${content.query}`,
        `url: ${content.url}`,
        `fetched_at: ${clock().toISOString()}`,
        `cached: ${content.cached ?? false}`,
        "---",
        "",
        `# ${title}`,
        ""
    ].join("\n");
    const headCells = showFC
        ? ["Rank", "Player", "Team", "Pos", "Proj", "Floor", "Ceiling"]
        : ["Rank", "Player", "Team", "Pos", "Value"];
    const divider = showFC
        ? "| --- | --- | --- | --- | --- | --- | --- |"
        : "| --- | --- | --- | --- | --- |";
    const sep = " | ";
    const lines = [header, `| ${headCells.join(sep)} |`, divider];
    for (const row of content.rows) {
        const cells = showFC
            ? [row.rank, row.player, row.team, row.position, row.value, row.floor ?? "", row.ceiling ?? ""]
            : [row.rank, row.player, row.team, row.position, row.value];
        lines.push(`| ${cells.join(sep)} |`);
    }
    lines.push("", `Source: ${content.url}`, "");
    return lines.join("\n");
}
export async function saveRecommendation(content, options = {}) {
    const clock = options.clock ?? (() => new Date());
    const directory = options.directory ?? "data/recommendations";
    const markdown = renderRecommendationMarkdown({ ...content, clock });
    const stamp = localDateStamp(clock);
    const fileName = `${stamp}-${slugify(content.source)}-${slugify(content.query)}.md`;
    const path = join(directory, fileName);
    await mkdir(directory, { recursive: true });
    if (options.writeFileImpl) {
        await options.writeFileImpl(path, markdown);
    }
    else {
        await writeFile(path, markdown, "utf8");
    }
    return { path, markdown };
}
