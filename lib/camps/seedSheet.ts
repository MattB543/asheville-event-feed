/**
 * The exa.ai seed sheet ("Buncombe County Summer Camps", tab summer-camps): 96 Summer 2026 rows,
 * useful only as a list of names and URLs (plan §2.1).
 */

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1X2ypxq0w1TJs0ii2pfYHqQ8ZN5PiLNL5EYzITb0OaZY/gviz/tq?tqx=out:csv&sheet=summer-camps';

export interface SeedRow {
  name: string;
  ages: string;
  location: string;
  /** The first URL in the Sources column. */
  url: string;
  sources: string[];
}

export async function fetchSeedSheet(): Promise<SeedRow[]> {
  const response = await fetch(SHEET_CSV_URL, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Seed sheet: HTTP ${response.status}`);
  const rows = parseCsv(await response.text());

  // The gviz export folds the first data row into the header cells ("Name <first name>").
  const header = rows[0];
  const firstRow = header.map((cell) => cell.replace(/^\S+(?: \S+)? (?=\S)/, ''));
  firstRow[0] = header[0].replace(/^Name /, '');
  firstRow[3] = header[3].replace(/^Ages \/ Grades /, '');
  firstRow[4] = header[4].replace(/^Location /, '');
  firstRow[8] = header[8].replace(/^Sources /, '');

  return [firstRow, ...rows.slice(1)]
    .filter((cells) => cells[0]?.trim())
    .map((cells) => {
      const sources = (cells[8] ?? '').match(/https?:\/\/[^\s;,]+/g) ?? [];
      return {
        name: cells[0].trim(),
        ages: (cells[3] ?? '').trim(),
        location: (cells[4] ?? '').trim(),
        url: sources[0] ?? '',
        sources,
      };
    });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
