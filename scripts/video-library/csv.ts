/** Minimal CSV writer: every cell is quoted, quotes are doubled (same convention as review.csv). */
export const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
export const csvRow = (cells: readonly unknown[]): string => cells.map(csvCell).join(',');
