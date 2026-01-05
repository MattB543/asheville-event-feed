'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  type ScoreOverride,
  calculateFinalScores,
  formatCuratorBoosts,
} from '@/lib/utils/scoreCalculation';

interface AdminScorePanelProps {
  eventId: string;
  aiScores: {
    rarity: number | null;
    unique: number | null;
    magnitude: number | null;
  };
  scoreReason: string | null;
  scoreOverride: ScoreOverride | null;
  canEdit: boolean; // true for super admin, false for verified curators (read-only)
  onScoreUpdate?: (newOverride: ScoreOverride) => void;
}

export default function AdminScorePanel({
  eventId,
  aiScores,
  scoreReason,
  scoreOverride,
  canEdit,
  onScoreUpdate,
}: AdminScorePanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Override form state
  const [overrideRarity, setOverrideRarity] = useState<string>(
    scoreOverride?.adminOverrides?.rarity?.toString() ?? ''
  );
  const [overrideUnique, setOverrideUnique] = useState<string>(
    scoreOverride?.adminOverrides?.unique?.toString() ?? ''
  );
  const [overrideMagnitude, setOverrideMagnitude] = useState<string>(
    scoreOverride?.adminOverrides?.magnitude?.toString() ?? ''
  );
  const [overrideReason, setOverrideReason] = useState<string>(
    scoreOverride?.adminOverrides?.reason ?? ''
  );

  // Calculate final scores
  const safeAiScores = {
    rarity: aiScores.rarity ?? 0,
    unique: aiScores.unique ?? 0,
    magnitude: aiScores.magnitude ?? 0,
  };
  const finalScores = calculateFinalScores(safeAiScores, scoreOverride);
  const curatorBoostText = formatCuratorBoosts(scoreOverride?.curatorBoosts);

  const handleSaveOverride = async () => {
    if (!canEdit) return;

    setIsSaving(true);

    try {
      const overrides: { rarity?: number; unique?: number; magnitude?: number; reason?: string } =
        {};

      if (overrideRarity !== '') {
        overrides.rarity = parseInt(overrideRarity, 10);
      }
      if (overrideUnique !== '') {
        overrides.unique = parseInt(overrideUnique, 10);
      }
      if (overrideMagnitude !== '') {
        overrides.magnitude = parseInt(overrideMagnitude, 10);
      }
      if (overrideReason.trim()) {
        overrides.reason = overrideReason.trim();
      }

      const hasOverrides = Object.keys(overrides).length > 0;

      const response = await fetch('/api/admin/event/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          overrides: hasOverrides ? overrides : undefined,
          action: hasOverrides ? 'set' : 'clear',
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { scoreOverride: ScoreOverride };
        onScoreUpdate?.(data.scoreOverride);
      } else {
        console.error('Failed to save override');
      }
    } catch (error) {
      console.error('Error saving override:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearOverride = () => {
    setOverrideRarity('');
    setOverrideUnique('');
    setOverrideMagnitude('');
    setOverrideReason('');

    if (!canEdit) return;

    setIsSaving(true);
    fetch('/api/admin/event/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, action: 'clear' }),
    })
      .then(async (response) => {
        if (response.ok) {
          const data = (await response.json()) as { scoreOverride: ScoreOverride };
          onScoreUpdate?.(data.scoreOverride);
        }
      })
      .catch((error: unknown) => {
        console.error('Error clearing override:', error);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Event Scores</span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Final Scores Display */}
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Rarity</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {finalScores.rarity}/10
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Uniqueness</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {finalScores.unique}/10
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Magnitude</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {finalScores.magnitude}/10
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total</div>
              <div className="text-lg font-bold text-brand-600 dark:text-brand-400">
                {finalScores.total}/30
              </div>
            </div>
          </div>

          {/* Curator Boosts */}
          {curatorBoostText && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {curatorBoostText}
            </p>
          )}

          {/* Score Reason */}
          {scoreReason && (
            <p className="text-xs text-gray-600 dark:text-gray-400 italic">
              AI Reasoning: {scoreReason}
            </p>
          )}

          {/* Override Form (Super Admin Only) */}
          {canEdit && (
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Override scores (leave blank to use AI + curator boosts):
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Rarity
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={overrideRarity}
                    onChange={(e) => setOverrideRarity(e.target.value)}
                    placeholder="0-10"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Unique
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={overrideUnique}
                    onChange={(e) => setOverrideUnique(e.target.value)}
                    placeholder="0-10"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Magnitude
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={overrideMagnitude}
                    onChange={(e) => setOverrideMagnitude(e.target.value)}
                    placeholder="0-10"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why are you overriding?"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleSaveOverride()}
                  disabled={isSaving}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 rounded hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? 'Saving...' : 'Save Override'}
                </button>
                {scoreOverride?.adminOverrides && (
                  <button
                    onClick={handleClearOverride}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 cursor-pointer"
                  >
                    Clear Override
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
