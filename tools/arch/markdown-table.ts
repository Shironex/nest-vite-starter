/**
 * A markdown table padded the way Prettier formats one.
 *
 * The generated pages sit under `docs/architecture`, which `pnpm format:check` covers,
 * so a table this renderer emits unpadded would be rewritten by Prettier and
 * the freshness check would then call the committed page stale on every run.
 * Emitting the formatted shape directly keeps the two agreeing.
 */
export function alignedTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, 3, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const formatRow = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => (cell ?? '').padEnd(widths[column] ?? 0)).join(' | ')} |`;

  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;

  return [formatRow(headers), separator, ...rows.map(formatRow)].join('\n');
}
