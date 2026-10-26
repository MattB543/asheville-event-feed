/**
 * The open letter's sources, numbered as the letter cites them. Titles are the
 * author's own wording; don't tidy them.
 */

export interface LetterSource {
  n: number;
  title: string;
  url: string;
}

export const LETTER_SOURCES: LetterSource[] = [
  {
    n: 1,
    title: 'CISA, NSA and FBI, Advisory AA24-038A (Feb 2024)',
    url: 'https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-038a',
  },
  {
    n: 2,
    title: 'NSA, CISA, FBI, DOE and EPA, Advisory AA26-231A (Aug 2026)',
    url: 'https://www.cisa.gov/news-events/cybersecurity-advisories/aa26-231a',
  },
  {
    n: 3,
    title: "CSO Online on OpenAI's GPT-6 Astra (Sept 2026)",
    url: 'https://www.csoonline.com/article/4218679/',
  },
  {
    n: 4,
    title: 'NBC News, attacks on municipal water systems in several states (Jul 2026)',
    url: 'https://www.nbcwashington.com/news/national-international/hackers-municipal-water-systems-states/4136930/',
  },
  {
    n: 5,
    title: 'U.S. Army, installation energy and water security policy',
    url: 'https://www.army.mil/article/184993',
  },
  {
    n: 6,
    title: "DefenseScoop, Pentagon's FORTRESS America program (Oct 2026)",
    url: 'https://defensescoop.com/2026/10/07/pentagon-memo-operationalize-fortress-america-program-office/',
  },
  {
    n: 7,
    title: 'GAO-26-108427, FEMA Workforce (Aug 2026)',
    url: 'https://www.gao.gov/products/gao-26-108427',
  },
  {
    n: 8,
    title: 'NC Emergency Management, Helene After-Action Review (Jun 2025)',
    url: 'https://ncdps.gov/division/emergency-management/ts-helene-after-action-review/open',
  },
  {
    n: 9,
    title: 'CISA Tabletop Exercise Packages',
    url: 'https://www.cisa.gov/resources-tools/services/cisa-tabletop-exercise-packages',
  },
  {
    n: 10,
    title: 'Buncombe County, Helene After-Action Report (Jul 2025)',
    url: 'https://www.buncombenc.gov/DocumentCenter/View/4231/After-Action-Report---Tropical-Storm-Helene-2024',
  },
];

/** "gao.gov" for a source's link, shown under its title */
export function sourceDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}
