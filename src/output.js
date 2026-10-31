import { errorEnvelope } from './errors.js';

function compactDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function stringifyCell(value) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

export function printJson(value, stdout = console.log) {
  stdout(JSON.stringify(value, null, 2));
}

export function printTable(rows, columns, stdout = console.log) {
  if (!rows.length) return;
  const widths = columns.map((column) =>
    Math.max(
      column.label.length,
      ...rows.map((row) => stringifyCell(column.value(row)).length)
    )
  );

  const line = (cells) =>
    cells
      .map((cell, index) => stringifyCell(cell).padEnd(widths[index]))
      .join('  ')
      .trimEnd();

  stdout(line(columns.map((column) => column.label)));
  stdout(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    stdout(line(columns.map((column) => column.value(row))));
  }
}

export function printRepoTable(repos, stdout = console.log) {
  printTable(
    repos,
    [
      { label: 'NAMESPACE', value: (repo) => repo.namespace },
      { label: 'NAME', value: (repo) => repo.name },
      { label: 'UPDATED', value: (repo) => compactDate(repo.updated_at) }
    ],
    stdout
  );
}

export function printDocTable(docs, stdout = console.log) {
  printTable(
    docs,
    [
      { label: 'SLUG', value: (doc) => doc.slug },
      { label: 'TITLE', value: (doc) => doc.title },
      { label: 'UPDATED', value: (doc) => compactDate(doc.updated_at) }
    ],
    stdout
  );
}

export function printError(error, { json = false, stderr = console.error } = {}) {
  if (json) {
    stderr(JSON.stringify(errorEnvelope(error), null, 2));
    return;
  }

  const code = error?.code || 'CLI_ERROR';
  const status = error?.status ? ` (HTTP ${error.status})` : '';
  stderr(`${code}${status}: ${error?.message || String(error)}`);
}
