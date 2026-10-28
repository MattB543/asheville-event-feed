/**
 * Camps pilot: print one provider's verified extraction, fact by fact, with each check.
 *
 * Usage:
 *   npx tsx scripts/camps/show-provider.ts bundle ymca-wnc
 */
import { readFileSync } from 'node:fs';
import type { SessionFact } from '../../lib/camps/types';
import { evidenceItems } from '../../lib/camps/verify';
import type { SavedVerification } from './run-pilot';
const [mode, key] = process.argv.slice(2);
const v = JSON.parse(
  readFileSync(`data/camps/pilot/verified/${mode}/${key}.json`, 'utf8')
) as SavedVerification;
console.log('notes:', v.extraction.notes);
console.log('excluded:', JSON.stringify(v.extraction.excluded));
console.log('ownDomains', v.report.ownDomains, 'pages', JSON.stringify(v.report.pages));
for (const card of v.extraction.cards) {
  console.log(
    `\n## ${card.name} | ${card.variant} | ${card.type} | ${card.categories} | reg=${card.registration_url}\n   ${card.description}`
  );
  for (const { field, evidence: e } of evidenceItems(card)) {
    const { url, quote, check, year, source_kind: _kind, ...rest } = e;
    void _kind;
    console.log(
      `  [${check?.status}/${check?.match}${check?.flags?.length ? ' ' + check.flags.join(',') : ''}] ${field} ${year} ${JSON.stringify(rest)}\n      "${quote}"  <${url.replace(/^https?:\/\/(www\.)?/, '')}>`
    );
  }
  if (card.sessions.length)
    console.log(
      '  sessions:',
      card.sessions.map((s: SessionFact) => `${s.label ?? ''} ${s.start}..${s.end}`).join('; ')
    );
}
