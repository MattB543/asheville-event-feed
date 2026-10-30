'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  RotateCcw,
  Route,
  Search,
  Send,
  Sparkles,
  StopCircle,
  Tag,
  X,
} from 'lucide-react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
  AI_NOTICE,
  TYPE_LABELS,
  formatDateRange,
  formatHours,
  formatPriceTier,
} from '@/lib/camps/display';
import { directoryContext } from '@/lib/camps/chat/context';
import {
  CAMP_CHAT_ENDPOINT,
  type CampChatRequest,
  type CampSearchFilters,
  type CampSearchHit,
  type CampSearchSummary,
  type CampTurnEvidence,
  type ChatMessage,
} from '@/lib/camps/chat/types';
import { useModal } from '@/lib/hooks/useModal';
import { isRecord } from '@/lib/utils/validation';
import SaveCampButton from './SaveCampButton';
import { UnconfirmedTag, YearTag } from './YearTag';
import { sendCampView } from './campViews';
import { TONE_CLASSES } from './tones';

/** The route's request limits (06-ai-chat-plan §5.1): older whole turns are left out to fit. */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 32000;
const MAX_DIRECTORY_CHARS = 4000;
/** Camp cards under one answer. */
const MAX_CARDS = 6;

const SUGGESTIONS = [
  'Pottery camps under $500 a week in June or July',
  'Theater or musical camps under $400 a week in July',
  'Full-day nature camps for an 8-year-old in July, under $350 a week',
  'Which camps open registration before January 15?',
];

const LOADING_MESSAGES = ['Reading request…', 'Searching camps…', 'Checking sessions…'];

type Entry =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      /** What the server verified for this answer: its cards and counts come from here alone. */
      evidence: CampTurnEvidence | null;
      /** 'cut': stopped or failed before the end. Shown, but never sent back as history. */
      status: 'streaming' | 'done' | 'cut';
    };
type AnswerEntry = Extract<Entry, { role: 'assistant' }>;

type StreamFrame = {
  type?: string;
  data?: unknown;
  choices?: Array<{ delta?: { content?: string } }>;
};

/**
 * What the server is sent: the user's messages and the finished answers (never the greeting, an
 * error or a cut-off answer), leaving out the oldest whole turns when it's over the route's limits
 * and cutting an answer down to the per-message limit. `partial` says either happened.
 */
function historyFor(entries: Entry[]): { messages: ChatMessage[]; partial: boolean } {
  const turns: ChatMessage[][] = [];
  for (const entry of entries) {
    if (entry.role === 'user') turns.push([{ role: 'user', content: entry.content }]);
    else if (entry.status === 'done' && turns.length > 0)
      turns[turns.length - 1].push({ role: 'assistant', content: entry.content });
  }
  const size = (turn: ChatMessage[]) =>
    turn.reduce((sum, message) => sum + Math.min(message.content.length, MAX_MESSAGE_CHARS), 0);
  let count = turns.reduce((sum, turn) => sum + turn.length, 0);
  let chars = turns.reduce((sum, turn) => sum + size(turn), 0);
  let first = 0;
  while (first < turns.length - 1 && (count > MAX_MESSAGES || chars > MAX_TOTAL_CHARS)) {
    count -= turns[first].length;
    chars -= size(turns[first]);
    first += 1;
  }
  const kept = turns.slice(first).flat();
  const clipped = kept.some((message) => message.content.length > MAX_MESSAGE_CHARS);
  return {
    messages: kept.map(({ role, content }) => ({
      role,
      content:
        content.length <= MAX_MESSAGE_CHARS
          ? content
          : `${content.slice(0, MAX_MESSAGE_CHARS - 1)}…`,
    })),
    partial: first > 0 || clipped,
  };
}

/** The URL when it's http(s), normalized, else null: nothing else is ever a link. */
function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const CAMP_PATH = /^\/camps\/([a-z0-9][a-z0-9-]*)\/?$/i;
const SITE_HOSTS = new Set(['avlgo.com', 'www.avlgo.com']);

/** The slug of an AVL GO camp page link ("/camps/<slug>", on this site or avlgo.com), else null. */
function campSlug(href: string): string | null {
  const here = typeof window === 'undefined' ? null : window.location.host;
  let url: URL;
  try {
    url = new URL(href, 'https://www.avlgo.com');
  } catch {
    return null;
  }
  if (!SITE_HOSTS.has(url.hostname) && url.host !== here) return null;
  return CAMP_PATH.exec(url.pathname)?.[1] ?? null;
}

/** Every official page the server supplied with this answer's camps: the only outside links kept. */
function suppliedUrls(camps: CampSearchHit[]): Set<string> {
  const urls = camps.flatMap((hit) => [
    hit.websiteUrl,
    hit.registrationUrl,
    hit.lastYearOpened?.url,
    ...(hit.openingDates ?? []).map((milestone) => milestone.url),
  ]);
  return new Set(urls.map(httpUrl).filter((url): url is string => !!url));
}

const linkClasses =
  'text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 no-underline hover:underline';

const proseClasses =
  'text-sm prose prose-sm max-w-none prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-hr:my-3 prose-hr:border-gray-300 dark:prose-hr:border-gray-600 prose-strong:text-gray-900 dark:prose-strong:text-gray-100';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/**
 * "Your search: 12 possible matches", then any alternative searches, labeled as such. Another page
 * of a search already shown isn't another search, so it gets no pill.
 */
function SearchPills({ searches }: { searches: CampSearchSummary[] }) {
  const keys = searches.map((search) => JSON.stringify({ ...search.filters, page: 0 }));
  const shown = searches.filter((_, index) => keys.indexOf(keys[index]) === index);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((search, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-950/50 px-3 py-1 text-xs text-brand-700 dark:text-brand-300"
        >
          <Search size={12} aria-hidden="true" className="shrink-0" />
          {index === 0 ? 'Your search' : 'Alternative search'}:{' '}
          {plural(search.totalMatches, 'possible match', 'possible matches')}
          {search.page > 1 && ` · page ${search.page}`}
        </span>
      ))}
    </div>
  );
}

/** One camp an answer links to, from that answer's evidence: compact, stacked under it. */
function ChatCampCard({ hit }: { hit: CampSearchHit }) {
  const { registration } = hit;
  const match = hit.matches[0] ?? null;
  const website = httpUrl(hit.websiteUrl) ?? httpUrl(hit.registrationUrl);
  const caveats = [...new Set([...(match?.caveats ?? []), ...hit.caveats])];

  // The session (or season) at the site that passed the search, with its own price and hours:
  // the camp's overall ranges alone don't prove a fit
  const session: ReactNode[] = [];
  if (match) {
    if (match.label) session.push(match.label);
    const dates = formatDateRange(match.start, match.end);
    // A last-summer session matched to a week this summer: "Jun 28 – Jul 2, 2027 (from 2026:
    // Jun 29 – Jul 3)"
    const projected = formatDateRange(match.projectedStart, match.projectedEnd);
    if (projected && dates)
      session.push(
        `${projected}, ${match.projectedStart!.slice(0, 4)} (from ${match.start!.slice(0, 4)}: ${dates})`
      );
    else if (dates)
      session.push(
        <>
          {dates}
          {match.year ? <YearTag year={match.year} /> : null}
        </>
      );
    const hours = formatHours(match.hours);
    if (hours) session.push(hit.hoursNote ? `${hours} (${hit.hoursNote})` : hours);
    if (match.price)
      session.push(
        <>
          {formatPriceTier(match.price)}
          {match.price.label && ` (${match.price.label})`}
          <YearTag year={match.price.year} />
        </>
      );
    const place = match.town ?? match.site;
    if (place) session.push(place);
    if (match.kidFit === 'may_fit') session.push('may fit: check the ages');
  }

  const facts = [
    { icon: CalendarDays, label: 'Dates', text: hit.season?.text, year: hit.season?.year },
    {
      icon: Tag,
      label: 'Price',
      text: hit.price && `${hit.price.text}${hit.priceNote ? ` (${hit.priceNote})` : ''}`,
      year: hit.price?.year,
    },
    { icon: Route, label: 'Drive', text: hit.drive, year: undefined },
  ].filter((fact) => fact.text);

  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <p
        title={registration.text}
        className={`flex min-h-8 items-center border-b px-3 py-1 text-xs font-semibold ${TONE_CLASSES[registration.tone]}`}
      >
        <span className="truncate">{registration.text}</span>
        {registration.unconfirmed && <UnconfirmedTag />}
      </p>

      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs leading-5 text-gray-600 dark:text-gray-400">
              {hit.providerName} · {TYPE_LABELS[hit.type] ?? hit.type}
            </p>
            <h3 className="text-sm font-semibold leading-5 text-gray-900 dark:text-gray-100">
              <a
                href={`/camps/${hit.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {hit.name}
              </a>
            </h3>
          </div>
          <SaveCampButton campId={hit.id} campName={hit.name} />
        </div>

        {facts.length > 0 && (
          <dl className="mt-2 space-y-0.5 text-sm leading-5">
            {facts.map(({ icon: Icon, label, text, year }) => (
              <div key={label} className="flex min-w-0 items-center gap-2">
                <dt className="sr-only">{label}</dt>
                <Icon size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
                <dd className="flex min-w-0 items-center">
                  <span
                    title={text ?? undefined}
                    className="truncate text-gray-700 dark:text-gray-300"
                  >
                    {text}
                  </span>
                  {year ? <YearTag year={year} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {session.length > 0 && (
          <p className="mt-2 text-sm leading-5 text-gray-700 dark:text-gray-300">
            {hit.matchedSessions > 0 && hit.matchedSessions < hit.totalSessions && (
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {hit.matchedSessions} of {hit.totalSessions} sessions fit the search, e.g.
              </span>
            )}
            {session.map((part, index) => (
              <span key={index}>
                {index > 0 && ' · '}
                {part}
              </span>
            ))}
          </p>
        )}

        {caveats.length > 0 && (
          <p className="mt-1.5 text-xs leading-4 text-amber-800 dark:text-amber-300">
            {caveats.join(' · ')}
          </p>
        )}
      </div>

      <div className="flex min-h-10 flex-wrap items-center gap-x-1 border-t border-gray-100 dark:border-gray-800 px-1.5 py-0.5">
        <a
          href={`/camps/${hit.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Details
        </a>
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => sendCampView(hit.id)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Camp website
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : (
          <span className="px-2 text-xs text-gray-500 dark:text-gray-400">
            No camp website stored: see Details
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * One answer. Its links are read as the Markdown is rendered (react-markdown's urlTransform sees
 * every link target, in order), never by scanning the prose: a camp link becomes a card only when
 * this answer's evidence has that camp, and any other link stays a link only when the server
 * supplied it. Everything else renders as plain text.
 */
function Answer({ entry }: { entry: AnswerEntry }) {
  const camps = useMemo(() => entry.evidence?.camps ?? [], [entry.evidence]);
  const hits = useMemo(() => new Map(camps.map((hit) => [hit.slug, hit])), [camps]);
  const supplied = useMemo(() => suppliedUrls(camps), [camps]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const slug = href ? campSlug(href) : null;
        const target = slug ? (hits.has(slug) ? `/camps/${slug}` : null) : httpUrl(href);
        if (!target || (!slug && !supplied.has(target))) return <span>{children}</span>;
        return (
          <a href={target} target="_blank" rel="noopener noreferrer" className={linkClasses}>
            {children}
          </a>
        );
      },
    }),
    [hits, supplied]
  );

  const { body, cited } = useMemo(() => {
    const slugs: string[] = [];
    // Markdown has no hooks, so calling it here renders the same tree <Markdown> would, and hands
    // back the link targets it saw on the way
    const rendered = Markdown({
      children: entry.content,
      remarkPlugins: [remarkBreaks],
      components,
      skipHtml: true,
      disallowedElements: ['img'],
      urlTransform: (url, key, node) => {
        const safe = defaultUrlTransform(url);
        if (key === 'href' && node.tagName === 'a') {
          const slug = campSlug(safe);
          if (slug && hits.has(slug) && !slugs.includes(slug)) slugs.push(slug);
        }
        return safe;
      },
    });
    return { body: rendered, cited: slugs.slice(0, MAX_CARDS).map((slug) => hits.get(slug)!) };
  }, [entry.content, components, hits]);

  return (
    <div className="flex flex-col items-start gap-2">
      {entry.evidence && <SearchPills searches={entry.evidence.searches} />}
      <div className="max-w-full sm:max-w-[85%] break-words rounded-lg px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
        <div className={proseClasses}>{body}</div>
        {entry.status === 'cut' && (
          <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
            This answer stopped before it finished.
          </p>
        )}
      </div>
      {entry.status === 'done' && cited.length > 0 && (
        <ul aria-label="Camps in this answer" className="w-full sm:max-w-[85%] space-y-2">
          {cited.map((hit) => (
            <ChatCampCard key={hit.slug} hit={hit} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mounted only while open (CampChatButton), so each open is a new conversation. */
export default function CampChatModal({
  onClose,
  directory,
  totalCount,
}: {
  onClose: () => void;
  /** The directory's view as URL parameters (its listKey), read on open. */
  directory: string;
  totalCount: number;
}) {
  // The directory's view at open; a 4,000+ character link is sent as no context
  const [captured] = useState(() => {
    const value = directory.length <= MAX_DIRECTORY_CHARS ? directory : '';
    return { directory: value, context: directoryContext(value) };
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearch, setLastSearch] = useState<CampSearchFilters | null>(null);
  const [partial, setPartial] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(false);
  // Each request gets the next number; a response (or its finally) only touches the conversation
  // while its number is still the latest, so Stop, Retry and close all leave it behind
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const inputId = useId();

  const cancelRequest = useCallback(() => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // Closing unmounts the modal, which stops a request still running
  useEffect(() => cancelRequest, [cancelRequest]);

  // Step through the loading labels until the answer starts
  useEffect(() => {
    if (!pending || streaming) {
      setLoadingIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingIndex((index) => Math.min(index + 1, LOADING_MESSAGES.length - 1));
    }, 3000);
    return () => clearInterval(interval);
  }, [pending, streaming]);

  // Scroll to the newest message when one is sent, not while an answer streams in
  useEffect(() => {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries, pending]);

  /** Answer the last user message in `conversation` (which ends with it). */
  async function ask(conversation: Entry[]) {
    cancelRequest();
    const id = requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => requestRef.current === id;

    const history = historyFor(conversation);
    setEntries(conversation);
    setPending(true);
    setStreaming(false);
    setError(null);
    setPartial(history.partial);
    shouldScrollRef.current = true;

    let evidence: CampTurnEvidence | null = null;
    let answer = '';
    let finished = false;
    const show = (status: AnswerEntry['status']) =>
      setEntries([...conversation, { role: 'assistant', content: answer, evidence, status }]);

    try {
      const body: CampChatRequest = {
        messages: history.messages,
        directory: captured.directory,
        lastSearch,
      };
      const response = await fetch(CAMP_CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? 'Something went wrong. Please try again.');
      }
      if (!response.ok || !response.body)
        throw new Error(`Something went wrong (${response.status}).`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Frames can be split across reads: the trailing partial line waits for the next one
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (!isCurrent()) return;
        // The last read flushes any final UTF-8 bytes and parses a last line with no newline
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() ?? '');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            finished = true;
            continue;
          }
          let frame: StreamFrame;
          try {
            frame = JSON.parse(data) as StreamFrame;
          } catch {
            continue;
          }
          // The route owns this frame's shape (CampTurnEvidence): only the envelope is checked
          if (frame.type === 'campResults') {
            const data = frame.data;
            if (isRecord(data) && Array.isArray(data.camps) && Array.isArray(data.searches))
              evidence = data as unknown as CampTurnEvidence;
            continue;
          }
          if (frame.type === 'error') {
            throw new Error(typeof frame.data === 'string' ? frame.data : 'Something went wrong.');
          }
          const token = frame.choices?.[0]?.delta?.content ?? '';
          if (!token) continue;
          if (!answer) setStreaming(true);
          answer += token;
          show('streaming');
        }
        if (done) break;
      }

      // An empty or cut-off stream isn't an answer
      if (!answer) throw new Error('No answer came back. Please try again.');
      if (!finished) throw new Error('The answer was cut off. Please try again.');
      show('done');
      if (evidence) setLastSearch(evidence.lastSearch);
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted) return;
      setError(
        err instanceof TypeError
          ? "Couldn't reach AVL GO. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.'
      );
      if (answer) show('cut');
    } finally {
      if (isCurrent()) {
        controllerRef.current = null;
        setPending(false);
        setStreaming(false);
      }
    }
  }

  function send(text: string) {
    const content = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content || pending) return;
    setInput('');
    void ask([...entries, { role: 'user', content }]);
  }

  /** Ask the last question again: its cut-off answer goes, the question isn't added twice. */
  function retry() {
    const last = entries.map((entry) => entry.role).lastIndexOf('user');
    if (last < 0 || pending) return;
    void ask(entries.slice(0, last + 1));
  }

  function stop() {
    cancelRequest();
    setPending(false);
    setStreaming(false);
    setEntries((current) =>
      current.map((entry) =>
        entry.role === 'assistant' && entry.status === 'streaming'
          ? { ...entry, status: 'cut' }
          : entry
      )
    );
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  };

  // On a phone, focusing the box on open throws up the keyboard, and iOS then scrolls the chat and
  // the page behind it around; there, wait for a tap instead
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  useModal(true, onClose, dialogRef, touch ? undefined : inputRef);

  const last = entries.at(-1);
  const canRetry = !pending && !!last && (last.role === 'user' || last.status !== 'done');
  const { context } = captured;

  return (
    <div
      className="ph-no-capture fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-dvh w-full flex-col bg-white shadow-xl outline-none dark:bg-gray-900 sm:h-[85dvh] sm:max-h-[760px] sm:max-w-2xl sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 py-2 pl-4 pr-2 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={20} aria-hidden="true" className="text-brand-600 dark:text-brand-400" />
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Ask AI about camps
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {/* Greeting: shown, never sent */}
          <div className="max-w-full space-y-2 break-words rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200 sm:max-w-[85%]">
            <p>
              Tell me what you need in your own words. I can search{' '}
              {totalCount > 0
                ? `all ${totalCount.toLocaleString('en-US')} listed camps`
                : 'every listed camp'}{' '}
              by age or grade, dates, hours and care, budget, place and interests.
            </p>
            {context.lines.length > 0 && (
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  Your directory filters, which I’ll use unless you ask for something else:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {context.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {context.notes.map((note) => (
              <p key={note} className="text-xs text-gray-600 dark:text-gray-400">
                {note}
              </p>
            ))}
          </div>
          <p
            role="note"
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <Sparkles size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{AI_NOTICE}</span>
          </p>

          {entries.length === 0 && !pending && (
            <div className="flex flex-col items-start gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-2xl bg-gray-100 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {entries.map((entry, index) =>
            entry.role === 'user' ? (
              <div key={index} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">
                  {entry.content}
                </div>
              </div>
            ) : (
              <Answer key={index} entry={entry} />
            )
          )}

          {pending && !streaming && (
            <div role="status" className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                {LOADING_MESSAGES[loadingIndex]}
              </div>
            </div>
          )}

          {canRetry && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p
                role={error ? 'alert' : undefined}
                className={`text-sm ${error ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-gray-400'}`}
              >
                {error ?? 'Stopped.'}
              </p>
              <button
                type="button"
                onClick={retry}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-brand-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Retry
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
          className="border-t border-gray-200 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-gray-700 sm:px-4"
        >
          <div className="flex items-end gap-2">
            <label htmlFor={inputId} className="sr-only">
              Describe what you need
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_MESSAGE_CHARS}
              enterKeyHint="send"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need…"
              className="field-sizing-content min-h-10 max-h-32 flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-[9px] text-sm leading-5 text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            {pending ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop"
                title="Stop"
                className="flex h-10 shrink-0 items-center rounded-lg bg-brand-600 px-3 text-white transition-colors hover:bg-brand-700 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
              >
                <StopCircle size={18} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="flex h-10 shrink-0 items-center rounded-lg bg-brand-600 px-3 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
              >
                <Send size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          {partial && (
            <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
              Part of this conversation is no longer sent to AI; your latest search still is.
            </p>
          )}
          <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
            AI-read info · confirm with the camp before booking.
          </p>
        </form>
      </div>
    </div>
  );
}
