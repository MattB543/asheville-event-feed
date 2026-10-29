'use client';

import { FileCode, FileText } from 'lucide-react';

// The app/api/camps/export routes. Not imported from lib/camps/export.ts: that would ship the
// formatter to the browser.
const MARKDOWN_PATH = '/api/camps/export/markdown';
const JSON_PATH = '/api/camps/export/json';

const linkClasses =
  'inline-flex items-center gap-1 rounded font-medium text-gray-700 dark:text-gray-300 underline-offset-2 hover:text-brand-600 hover:underline dark:hover:text-brand-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * "Export for your AI: Markdown · JSON": every listed camp as one file (lib/camps/export.ts) a
 * parent can give ChatGPT, Claude or another AI to compare camps for their own kids. The routes
 * send it as a download.
 */
export default function CampExportLinks({ className = '' }: { className?: string }) {
  const title = 'Download every camp as one file to give ChatGPT, Claude or another AI';
  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400 ${className}`}
    >
      <span>Export for your AI:</span>
      <a href={MARKDOWN_PATH} download title={title} className={linkClasses}>
        <FileText size={13} aria-hidden="true" />
        Markdown
      </a>
      <span aria-hidden="true">·</span>
      <a href={JSON_PATH} download title={title} className={linkClasses}>
        <FileCode size={13} aria-hidden="true" />
        JSON
      </a>
    </p>
  );
}
