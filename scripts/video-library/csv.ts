/** Minimal CSV writer: every cell is quoted, quotes are doubled (same convention as review.csv). */
export const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
export const csvRow = (cells: readonly unknown[]): string => cells.map(csvCell).join(',');

/**
 * Reads CSV text (RFC 4180): quoted or unquoted cells, doubled quotes, CRLF or LF, a leading BOM. Spreadsheet programs
 * rewrite files in these forms when you save, so the reader must accept all of them. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') endRow();
    else if (c === '\r') { if (src[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}
