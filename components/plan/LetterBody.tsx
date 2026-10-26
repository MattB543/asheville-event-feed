import type { ReactNode } from 'react';
import Link from 'next/link';
import SourceRef from '@/components/plan/SourceRef';
import { LETTER_SOURCES, sourceDomain } from '@/lib/plan/letterSources';

/*
 * The open letter at /plan, word for word as the author wrote it: don't fix its
 * typos, numbers or phrasing. Its "Signed" section is the page's live signer list.
 */

const TITLE_KICKER = 'An open letter to Asheville leaders:';
const TITLE_MAIN = 'We need Water and Food Plans for Long Outages';

/** One line, for the tab, share cards and metadata */
export const LETTER_TITLE = `${TITLE_KICKER} ${TITLE_MAIN}`;

const LINK_CLASS =
  'font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300';

export function LetterHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-10 font-display text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white"
    >
      {children}
    </h2>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>;
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-3 pl-6 marker:text-gray-400">{children}</ul>;
}

function Numbered({ children }: { children: ReactNode }) {
  return (
    <ol className="mt-4 list-decimal space-y-3 pl-6 marker:font-semibold marker:text-gray-500 dark:marker:text-gray-400">
      {children}
    </ol>
  );
}

/** The page's h1 */
export function LetterTitle() {
  return (
    <header>
      <h1 className="font-display tracking-tight text-gray-900 dark:text-white">
        {/* The kicker on its own, smaller and lighter line; the space keeps them apart when
            copied or read aloud */}
        <span className="block text-xl font-medium text-gray-600 sm:text-2xl dark:text-gray-400">
          {TITLE_KICKER}
        </span>{' '}
        <span className="mt-1 block text-3xl font-bold sm:text-4xl">{TITLE_MAIN}</span>
      </h1>
    </header>
  );
}

/** The letter from its opening through the closing "We are grateful…" paragraph */
export default function LetterBody() {
  return (
    <div className="text-base leading-relaxed text-gray-700 sm:text-[17px] dark:text-gray-300 [&>p]:mt-4">
      <LetterHeading id="letter">A letter to our leaders</LetterHeading>
      <p>
        After Helene, we saw the power of this community and its public servants, but also how much{' '}
        <Lead>depended on help from outside Asheville</Lead>. Helene was a regional disaster with
        national support. The next one could be a national disaster with little or no national
        support; cybersecurity, electric grid, water supply attacks are at a greater risk now more
        than ever.
      </p>
      <p>We ask our leaders, and everyone running to lead, to commit to forming a plan.</p>

      <LetterHeading>Experts warn of new risks we&apos;re not ready for</LetterHeading>
      <Bullets>
        <li>
          <Lead>Foreign hackers are already positioned.</Lead> U.S. agencies found Chinese
          state-sponsored hackers inside U.S. water, energy and communications networks, positioned
          “for disruptive or destructive cyberattacks.”
          <SourceRef n={1} />
        </li>
        <li>
          <Lead>AI is making attacks cheaper.</Lead> Federal agencies warned in August of
          “AI-generated exploitation scripts” aimed at water and power controls.
          <SourceRef n={2} /> OpenAI rates its newest model “Critical” for cyber risk.
          <SourceRef n={3} />
        </li>
        <li>
          <Lead>Attacks on many targets at once have begun.</Lead> In July, water utilities in
          several states reported intrusions within days of each other.
          <SourceRef n={4} /> Most attacks still exploit weak passwords; AI makes those cheap to
          find at scale.
        </li>
        <li>
          <Lead>The military is preparing.</Lead> The Army requires bases to sustain critical
          missions for 14 days without utilities,
          <SourceRef n={5} /> and the Pentagon is working to make major bases independent of the
          civilian grid.
          <SourceRef n={6} /> We rely on that grid.
        </li>
        <li>
          <Lead>Outside help is weakening.</Lead> FEMA lost about 17% of its workforce in FY2025.
          <SourceRef n={7} /> North Carolina’s Helene review warns of having “to compete with other
          states for limited supplies.”
          <SourceRef n={8} />
        </li>
      </Bullets>

      <LetterHeading>The gap: local water and food access</LetterHeading>
      <p>
        After Helene, much of our water and food was shipped in: the county’s main warehouse alone
        received over a million MREs and nearly 600,000 gallons of water.
        <SourceRef n={10} />
      </p>
      <p>
        In a disaster that hits many regions at once, that help will be stretched thin or gone, and
        we could find no public plan for keeping water and food flowing without it.
      </p>
      <Bullets>
        <li>
          <Lead>Water runs on diesel.</Lead> With the grid down, pumps and treatment depend on
          generators, and diesel reaches Asheville by truck. The county’s Helene review found “gaps
          in fuel contract/plan.”
          <SourceRef n={10} />
        </li>
        <li>
          <Lead>Food runs on trucks.</Lead> Grocery stores and the food bank restock by truck, and
          the county’s review found its distribution plan “not scalable.”
          <SourceRef n={10} />
        </li>
      </Bullets>
      <p>
        Without a plan, a long outage could become a public-health and public-safety emergency
        within days.
      </p>

      <LetterHeading>Questions every leader should be able to answer now</LetterHeading>
      <Numbered>
        <li>
          With the grid down for a month, how does diesel keep reaching our water plants and pump
          stations?
        </li>
        <li>
          If few trucks reach the region, where does food for 400,000+ people come from, and who
          distributes it?
        </li>
        <li>
          Has the city or county ever exercised an outage lasting weeks, across many states, with
          little outside help?
        </li>
      </Numbered>

      <LetterHeading>Go on the record by 5 PM Monday, November 2</LetterHeading>
      <p>
        We are sending this letter to every sitting official and every candidate for Mayor and City
        Council asking them each to reply to{' '}
        <a href="mailto:plan@avlgo.com" className={LINK_CLASS}>
          plan@avlgo.com
        </a>{' '}
        with:
      </p>
      <p className="border-l-4 border-brand-200 pl-4 dark:border-brand-800">
        Yes or no on each of the six commitments below, with an optional comment or statement
      </p>
      <p>
        Every response, and every non-response, will be published unedited at{' '}
        <Link href="/plan" className={LINK_CLASS}>
          AVLGO.com/plan
        </Link>
        .
      </p>

      <LetterHeading>The six commitments</LetterHeading>
      <Numbered>
        <li>
          <Lead>Name an owner</Lead> for water and food resilience by January 31, 2027, with public
          updates every six months. The owner&apos;s first step: an initial assessment of the water
          and food capacity we have today, the gaps, and the assumptions current plans rely on.
        </li>
        <li>
          <Lead>Lock down water controls</Lead> by February 28, 2027: CISA’s free scanning, and
          control systems off the open internet.
        </li>
        <li>
          <Lead>Write a fuel plan for water</Lead> by March 31, 2027: how the city will secure,
          store and deliver diesel to run water plants and pumps for 30 days without outside
          resupply.
        </li>
        <li>
          <Lead>Convene the food system</Lead> by March 31, 2027: grocers, distributors, MANNA
          FoodBank and growers, to map how food reaches residents with no grid, internet or outside
          trucks for a month.
        </li>
        <li>
          <Lead>Write and test a 30-day water and food plan</Lead> by June 30, 2027, using a public
          tabletop exercise.
          <SourceRef n={9} />
        </li>
        <li>
          <Lead>Publish the emergency plans,</Lead> redacted as needed, by March 31, 2027. After
          Helene, partners used an outdated plan.
          <SourceRef n={10} />
        </li>
      </Numbered>

      <p className="mt-6">
        We are grateful for the work since Helene, and we are ready to help as volunteers,
        technologists and neighbors.
      </p>
    </div>
  );
}

/**
 * The numbered sources, each with an `src-<n>` anchor: where a citation links before the
 * page hydrates (or with no JS), and a plain list of every link for crawlers.
 */
export function LetterSourceList() {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm leading-relaxed text-gray-700 marker:text-gray-500 sm:text-base dark:text-gray-300 dark:marker:text-gray-400">
      {LETTER_SOURCES.map((source) => (
        <li
          key={source.n}
          id={`src-${source.n}`}
          className="scroll-mt-4 rounded target:bg-brand-50 dark:target:bg-brand-950/40"
        >
          <a href={source.url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {source.title}
          </a>{' '}
          <span className="text-gray-500 dark:text-gray-400">· {sourceDomain(source.url)}</span>
        </li>
      ))}
    </ol>
  );
}
