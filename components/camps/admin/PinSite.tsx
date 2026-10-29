'use client';

import { useState, type FormEvent } from 'react';
import type { UnpinnedSite } from '@/lib/db/queries/camps';
import ActionButton from './ActionButton';
import { buttonClass, buttonTones, useCampAdminAction } from './useCampAdminAction';

/** What Google Maps copies from a right-clicked point: "35.5951, -82.5515". */
function parsePoint(text: string): { lat: number; lng: number } | null {
  const match = text.match(/^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/);
  return match ? { lat: Number(match[1]), lng: Number(match[2]) } : null;
}

function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const linkClass = 'text-brand-600 hover:underline dark:text-brand-400';

/** One site to place by hand: no point yet, or ORS's point (`ors`) to check. */
export default function PinSite({
  site,
  ors,
}: {
  site: UnpinnedSite;
  ors?: { lat: number; lng: number; label: string | null };
}) {
  const [text, setText] = useState('');
  const { run, busy, error, setError } = useCampAdminAction();
  const place = [site.address, site.town, site.state].filter(Boolean).join(', ');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const point = parsePoint(text);
    if (!point) {
      setError('Paste "lat, lng" as Google Maps copies it, e.g. 35.5951, -82.5515');
      return;
    }
    if (await run({ action: 'pin', siteId: site.id, ...point })) setText('');
  };

  return (
    <li className="py-3">
      <p className="text-sm">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{site.name}</span>
        <span className="text-gray-600 dark:text-gray-400"> · {site.providerName}</span>
      </p>
      <p className="text-sm text-gray-700 dark:text-gray-300">{place || 'No address'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">Used by {site.camps.join(', ')}</p>
      {ors && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          ORS placed it at {ors.label ?? 'an unlabelled point'} (
          <a
            href={mapsSearchUrl(`${ors.lat},${ors.lng}`)}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {ors.lat.toFixed(5)}, {ors.lng.toFixed(5)}
          </a>
          )
        </p>
      )}
      <p className="mt-1 text-sm">
        <a
          href={mapsSearchUrl([site.name, site.address, site.town].filter(Boolean).join(', '))}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Search Google Maps
        </a>
      </p>
      <form
        onSubmit={(event) => void save(event)}
        className="mt-2 flex flex-wrap items-start gap-2"
      >
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="35.5951, -82.5515"
          aria-label={`Pin for ${site.name}, as lat, lng`}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 sm:max-w-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button type="submit" disabled={busy} className={`${buttonClass} ${buttonTones.primary}`}>
          {busy ? '…' : 'Save pin'}
        </button>
        {ors && (
          <ActionButton
            body={{ action: 'pin', siteId: site.id, lat: ors.lat, lng: ors.lng }}
            label="ORS is right"
          />
        )}
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
