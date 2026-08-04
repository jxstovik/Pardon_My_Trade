/**
 * Minimal, dependency-free parser for the server-rendered HTML tables used by
 * Razzball and FFToday. We deliberately avoid a full HTML parser: these pages
 * expose a single primary `<table>` of player rows, and we only care about
 * extracting a header row plus data rows as plain-text cells.
 *
 * The output is intentionally loose — callers (RazzballProjectionSource /
 * FFTodayProjectionSource) normalise headers and map cells to stats.
 */

export interface ParsedTable {
  readonly headers: string[];
  readonly rows: string[][];
}

export interface HtmlTableParseResult {
  readonly tables: ParsedTable[];
}

const BLOCK_TAGS = new Set(["html", "head", "body", "table", "thead", "tbody", "tfoot", "tr", "th", "td"]);

/**
 * Extract every `<table>` from `html` as a `{ headers, rows }` structure.
 *
 * Header cells are taken from `<th>` elements when present, otherwise from the
 * first `<tr>` of the table. Cell text is stripped of nested tags and collapsed
 * whitespace. Returns an empty `tables` array when no table is found (which lets
 * callers distinguish "no data" from a parse failure).
 */
export function parseHtmlTables(html: string): HtmlTableParseResult {
  const tables = findTagPairs(html, "table").map((p) => parseTable(p.inner));
  return { tables };
}

function parseTable(tableHtml: string): ParsedTable {
  const rowParts = findTagPairs(tableHtml, "tr");
  if (rowParts.length === 0) {
    const cells = extractCells(tableHtml);
    return { headers: [], rows: cells.length > 0 ? [cells] : [] };
  }

  const allRows = rowParts.map((p) => extractCells(p.inner));

  // The header row is the first <tr> that contains a <th> cell. When no such
  // row exists (plain <td> tables), promote the first row to headers.
  let headerIdx = -1;
  for (let i = 0; i < rowParts.length; i++) {
    if (findTagPairs(rowParts[i].inner, "th").length > 0) {
      headerIdx = i;
      break;
    }
  }

  let headers: string[];
  let dataRows: string[][];
  if (headerIdx >= 0) {
    headers = allRows[headerIdx];
    dataRows = allRows.filter((_, i) => i !== headerIdx);
  } else if (allRows.length > 0) {
    headers = allRows[0];
    dataRows = allRows.slice(1);
  } else {
    headers = [];
    dataRows = [];
  }

  // Drop fully-empty rows (e.g. spacer rows of &nbsp; cells).
  dataRows = dataRows.filter((row) => row.some((cell) => cell.trim() !== ""));

  return {
    headers: headers.map(cleanCell),
    rows: dataRows.map((row) => row.map(cleanCell))
  };
}

function extractCells(scopeHtml: string): string[] {
  const ths = findTagPairs(scopeHtml, "th");
  const tds = findTagPairs(scopeHtml, "td");
  const cells = [...ths, ...tds];
  // Preserve document order by the cell's tag start position. Sorting on the
  // inner text with indexOf is unsafe: "2" is a substring of "250" and would
  // sort before it, scrambling the row.
  cells.sort((a, b) => a.start - b.start);
  return cells.map((c) => cleanCell(c.inner));
}

function cleanCell(text: string): string {
  // Decode the handful of entities these pages use, then strip tags.
  const decoded = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, " ");
  const noTags = decoded.replace(/<[^>]*>/g, " ");
  return noTags.replace(/\s+/g, " ").trim();
}

interface TagPair {
  readonly inner: string;
  readonly start: number;
}

/**
 * Return every `<tag>...</tag>` pair in `html`, in document order, with the
 * position of its opening tag. Handles nested, self-closing-free tags by
 * tracking depth.
 */
function findTagPairs(html: string, tag: string): TagPair[] {
  const result: TagPair[] = [];
  const tokens: Array<{ type: "open" | "close"; at: number; end: number }> = [];
  const openMatches = [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "gi"))];
  const closeMatches = [...html.matchAll(new RegExp(`</${tag}>`, "gi"))];
  for (const m of openMatches) tokens.push({ type: "open", at: m.index, end: m.index + m[0].length });
  for (const m of closeMatches) tokens.push({ type: "close", at: m.index, end: m.index + m[0].length });
  tokens.sort((a, b) => a.at - b.at);

  const openStack: number[] = [];
  for (const token of tokens) {
    if (token.type === "open") {
      openStack.push(token.end);
    } else {
      const innerStart = openStack.pop();
      if (innerStart === undefined) continue;
      result.push({ inner: html.slice(innerStart, token.at), start: innerStart });
    }
  }
  // Anything still open at EOF (malformed pages) is captured to the end.
  for (const open of openStack) {
    result.push({ inner: html.slice(open), start: open });
  }
  return result;
}

export function firstTable(result: HtmlTableParseResult): ParsedTable | undefined {
  return result.tables.find((t) => t.rows.length > 0);
}

const PLAYER_TABLE_HEADER = /player|name|team/i;

/**
 * Choose the table that actually holds player rows: it must have a header
 * cell identifying a player/name/team column and at least one data row. When
 * several qualify (Razzball pages embed nav + stat tables), prefer the one
 * with the most rows, which is the stat table.
 */
export function selectPlayerTable(result: HtmlTableParseResult): ParsedTable | undefined {
  const candidates = result.tables.filter(
    (t) => t.rows.length > 0 && t.headers.some((h) => PLAYER_TABLE_HEADER.test(h))
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => b.rows.length - a.rows.length)[0];
}
