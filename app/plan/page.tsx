import type { Metadata } from 'next';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import ShareButton from '@/components/ShareButton';
import LetterBody, {
  LETTER_TITLE,
  LetterHeading,
  LetterSourceList,
  LetterTitle,
} from '@/components/plan/LetterBody';
import CandidateGrid from '@/components/plan/CandidateGrid';
import SignLetterForm from '@/components/plan/SignLetterForm';
import SignatureReview from '@/components/plan/SignatureReview';
import {
  getLetterPageData,
  getOwnSignature,
  getReviewQueue,
} from '@/lib/db/queries/letterSignatures';
import {
  isSigningOpen,
  type LetterPageData,
  type OwnSignature,
  type PublicSigner,
  type ReviewQueue,
} from '@/lib/letter/outagePlan';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { SITE_URL } from '@/lib/seo/site';

const pageUrl = `${SITE_URL}/plan`;
const description =
  'An open letter from Asheville residents asking Asheville leaders, and every candidate for Mayor and City Council, to commit to a plan for keeping water and food flowing through a weeks-long outage with little outside help.';

export const metadata: Metadata = {
  title: LETTER_TITLE,
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'article',
    url: pageUrl,
    title: LETTER_TITLE,
    description,
    siteName: 'AVL GO',
    locale: 'en_US',
    images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: LETTER_TITLE,
    description,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },
};

/** Past this many public names the list starts collapsed */
const OPEN_LIST_MAX = 25;

function signerLine(signer: PublicSigner): string {
  const details = [signer.neighborhood, signer.role].filter(Boolean).join(' · ');
  return details ? `${signer.name} — ${details}` : signer.name;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export default async function PlanPage() {
  // Reading the session makes this render per request, and the signatures are read fresh
  // each time. A missing table or failed read still shows the letter, says the signatures
  // are unavailable, and holds off the form (it can't know whether this visitor signed)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isSuperAdmin(user?.id);

  const [data, ownSignature, reviewQueue] = await Promise.all([
    getLetterPageData().catch((error: unknown): LetterPageData | null => {
      console.error('[Plan] Failed to load signatures:', error);
      return null;
    }),
    user
      ? getOwnSignature(user.id).catch((error: unknown): OwnSignature | null | undefined => {
          console.error('[Plan] Failed to load own signature:', error);
          return undefined;
        })
      : Promise.resolve<OwnSignature | null | undefined>(null),
    admin
      ? getReviewQueue().catch((error: unknown) => {
          console.error('[Plan] Failed to load review queue:', error);
          return null;
        })
      : Promise.resolve<ReviewQueue | null>(null),
  ]);

  // undefined = the read failed, which is not the same as not having signed
  const unavailable = data === null || ownSignature === undefined;
  const { total, privateCount, shown } = data ?? { total: 0, privateCount: 0, shown: [] };
  // "1 public signer & 4 private signers"; signatures waiting for review are in neither
  const signerSummary = [
    shown.length > 0 && plural(shown.length, 'public signer', 'public signers'),
    privateCount > 0 && plural(privateCount, 'private signer', 'private signers'),
  ]
    .filter(Boolean)
    .join(' & ');

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="plan" />

      <div className="flex-grow">
        <article className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8">
          <LetterTitle />

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base">
            <a
              href="#sign"
              className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              Agree with this letter? Sign your support below ↓
            </a>
            <div className="relative">
              <ShareButton path="/plan" title={LETTER_TITLE} />
            </div>
          </div>

          <div className="mt-6">
            <LetterBody />
          </div>

          <section aria-labelledby="leaders" className="mt-10">
            <h2
              id="leaders"
              className="font-display text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white"
            >
              Where the leaders stand
            </h2>
            <p className="mt-1 mb-4 text-sm text-gray-600 dark:text-gray-400">
              We&apos;ve asked the officials who lead emergency planning, and every candidate for
              Mayor and City Council on the November 3 ballot, to answer the six commitments above.
            </p>
            <CandidateGrid />
          </section>

          {/* ph-no-capture: PostHog autocapture and replay never record names, typed or shown */}
          <section
            id="sign"
            className="ph-no-capture mt-10 scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900"
          >
            <SignLetterForm
              ownerId={user?.id ?? null}
              initialSignature={ownSignature ?? null}
              signingOpen={isSigningOpen()}
              unavailable={unavailable}
            />
          </section>

          {user && admin && reviewQueue && (
            <section id="review" className="ph-no-capture mt-8 scroll-mt-4">
              <SignatureReview queue={reviewQueue} adminId={user.id} />
            </section>
          )}

          <LetterHeading id="signed">Signed</LetterHeading>
          <div className="mt-4 text-base leading-relaxed text-gray-700 sm:text-[17px] dark:text-gray-300">
            {data === null ? (
              <p className="text-gray-600 dark:text-gray-400">
                Signatures are unavailable right now. Please check back in a few minutes.
              </p>
            ) : shown.length > 0 ? (
              <details open={shown.length <= OPEN_LIST_MAX}>
                <summary className="cursor-pointer font-medium text-gray-900 dark:text-white">
                  {signerSummary}
                </summary>
                <ul className="mt-3 space-y-1.5">
                  {shown.map((signer, i) => (
                    <li key={i}>{signerLine(signer)}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-gray-600 dark:text-gray-400">
                {total === 0
                  ? 'No one has signed yet.'
                  : `${signerSummary || plural(total, 'neighbor has', 'neighbors have') + ' signed'}. Public names appear here after a quick review.`}
              </p>
            )}
          </div>

          <LetterHeading id="sources">Sources</LetterHeading>
          <LetterSourceList />

          <LetterHeading id="about">About this letter</LetterHeading>
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600 sm:text-base dark:text-gray-400">
            <p>
              Organized by Matt Brooks, an Asheville resident, and hosted on AVL GO as a community
              project. Independent and nonpartisan; not affiliated with any candidate, party or
              campaign.
            </p>
            <p>
              Signing needs an AVL GO account so we know each signature is a real, verified email.
              Your email is never shown. Public names appear here after a quick review and may be
              sent to officials with the letter; private signers are counted but never published or
              sent to officials. Corrections or removal:{' '}
              <a
                href="mailto:plan@avlgo.com"
                className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                plan@avlgo.com
              </a>
              .
            </p>
          </div>
        </article>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
