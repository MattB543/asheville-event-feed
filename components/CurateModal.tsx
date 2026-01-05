'use client';

import { useState, useId } from 'react';
import { X } from 'lucide-react';

interface ScoreBoost {
  rarity?: number;
  unique?: number;
  magnitude?: number;
}

interface CurateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (note?: string, scoreBoost?: ScoreBoost) => void;
  eventTitle: string;
  // Score boost props (optional - only shown for verified curators / super admin)
  canBoostScore?: boolean;
  currentScores?: {
    rarity: number | null;
    unique: number | null;
    magnitude: number | null;
    total: number | null;
  } | null;
  existingBoost?: ScoreBoost | null;
}

interface CurateModalFormProps {
  onClose: () => void;
  onConfirm: (note?: string, scoreBoost?: ScoreBoost) => void;
  eventTitle: string;
  canBoostScore: boolean;
  currentScores?: {
    rarity: number | null;
    unique: number | null;
    magnitude: number | null;
    total: number | null;
  } | null;
  existingBoost?: ScoreBoost | null;
}

// Inner form component that gets remounted when modal opens
function CurateModalForm({
  onClose,
  onConfirm,
  eventTitle,
  canBoostScore,
  currentScores,
  existingBoost,
}: CurateModalFormProps) {
  const [note, setNote] = useState('');
  const [boostRarity, setBoostRarity] = useState(existingBoost?.rarity ?? 0);
  const [boostUnique, setBoostUnique] = useState(existingBoost?.unique ?? 0);
  const [boostMagnitude, setBoostMagnitude] = useState(existingBoost?.magnitude ?? 0);

  const hasScore = currentScores?.total !== null && currentScores?.total !== undefined;
  const showBoostSection = canBoostScore && hasScore;

  const handleSubmit = () => {
    const scoreBoost: ScoreBoost | undefined =
      showBoostSection && (boostRarity !== 0 || boostUnique !== 0 || boostMagnitude !== 0)
        ? {
            rarity: boostRarity || undefined,
            unique: boostUnique || undefined,
            magnitude: boostMagnitude || undefined,
          }
        : undefined;

    onConfirm(note.trim() || undefined, scoreBoost);
    onClose();
  };

  const formatBoostValue = (value: number) => {
    if (value > 0) return `+${value}`;
    if (value < 0) return `${value}`;
    return '0';
  };

  return (
    <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
      >
        <X size={20} />
      </button>

      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Curate this event
      </h2>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Adding &ldquo;{eventTitle}&rdquo; to your curated list.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Add a note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 280))}
          placeholder="Why do you recommend this event?"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          rows={3}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
          {note.length}/280
        </p>
      </div>

      {/* Score Boost Section (only for verified curators / super admin with scored events) */}
      {showBoostSection && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Adjust Event Score
          </h3>

          <div className="space-y-4">
            {/* Rarity Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-gray-600 dark:text-gray-400">Rarity</label>
                <span
                  className={`text-xs font-medium ${
                    boostRarity > 0
                      ? 'text-green-600 dark:text-green-400'
                      : boostRarity < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {formatBoostValue(boostRarity)}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="1"
                value={boostRarity}
                onChange={(e) => setBoostRarity(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>-2</span>
                <span>0</span>
                <span>+2</span>
              </div>
            </div>

            {/* Uniqueness Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-gray-600 dark:text-gray-400">Uniqueness</label>
                <span
                  className={`text-xs font-medium ${
                    boostUnique > 0
                      ? 'text-green-600 dark:text-green-400'
                      : boostUnique < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {formatBoostValue(boostUnique)}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="1"
                value={boostUnique}
                onChange={(e) => setBoostUnique(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>-2</span>
                <span>0</span>
                <span>+2</span>
              </div>
            </div>

            {/* Magnitude Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-gray-600 dark:text-gray-400">Magnitude</label>
                <span
                  className={`text-xs font-medium ${
                    boostMagnitude > 0
                      ? 'text-green-600 dark:text-green-400'
                      : boostMagnitude < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {formatBoostValue(boostMagnitude)}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="1"
                value={boostMagnitude}
                onChange={(e) => setBoostMagnitude(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>-2</span>
                <span>0</span>
                <span>+2</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Current score: {currentScores?.total ?? 0}/30
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors cursor-pointer"
        >
          Curate
        </button>
      </div>
    </div>
  );
}

export default function CurateModal({
  isOpen,
  onClose,
  onConfirm,
  eventTitle,
  canBoostScore = false,
  currentScores,
  existingBoost,
}: CurateModalProps) {
  // Generate a unique key that changes when modal opens to reset form state
  const formKey = useId() + (isOpen ? '-open' : '-closed');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Form - keyed to reset state when modal opens */}
      <CurateModalForm
        key={formKey}
        onClose={onClose}
        onConfirm={onConfirm}
        eventTitle={eventTitle}
        canBoostScore={canBoostScore}
        currentScores={currentScores}
        existingBoost={existingBoost}
      />
    </div>
  );
}
