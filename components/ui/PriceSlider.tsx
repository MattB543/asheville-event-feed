'use client';

import { useMemo } from 'react';

// Slider stops: Free, $10-$100 in $10 increments, then "All Events" (no limit)
const PRICE_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, null] as const;
const MAX_INDEX = PRICE_STOPS.length - 1;

interface PriceSliderProps {
  value: number | null; // null = "All Events" (no limit)
  onChange: (value: number | null) => void;
}

export default function PriceSlider({ value, onChange }: PriceSliderProps) {
  // Convert value to slider index
  const sliderIndex = useMemo(() => {
    if (value === null) return MAX_INDEX;
    const index = PRICE_STOPS.indexOf(value as (typeof PRICE_STOPS)[number]);
    if (index >= 0) return index;
    // Find closest stop for non-standard values
    for (let i = 0; i < PRICE_STOPS.length - 1; i++) {
      const stop = PRICE_STOPS[i];
      if (stop !== null && value <= stop) return i;
    }
    return MAX_INDEX;
  }, [value]);

  // Convert slider index to value
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value, 10);
    const newValue = PRICE_STOPS[index];
    onChange(newValue);
  };

  // Get display label for current value
  const getLabel = () => {
    if (value === null) return 'All Events';
    if (value === 0) return 'Free';
    return `Under $${value}`;
  };

  return (
    <div className="w-full">
      {/* Current selection label */}
      <div className="text-center mb-3">
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{getLabel()}</span>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={MAX_INDEX}
          step={1}
          value={sliderIndex}
          onChange={handleChange}
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-5
            [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-brand-600
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-moz-range-thumb]:appearance-none
            [&::-moz-range-thumb]:w-5
            [&::-moz-range-thumb]:h-5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-brand-600
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:cursor-pointer
            [&::-moz-range-thumb]:border-0
            [&::-moz-range-track]:bg-transparent"
        />
      </div>

      {/* Labels - positioned to match slider stops */}
      <div className="relative mt-2 h-4">
        <span
          className={`absolute left-0 text-xs ${sliderIndex === 0 ? 'text-brand-600 dark:text-brand-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
        >
          Free
        </span>
        <span
          className={`absolute text-xs -translate-x-1/2 ${sliderIndex === 3 ? 'text-brand-600 dark:text-brand-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
          style={{ left: `${(3 / MAX_INDEX) * 100}%` }}
        >
          $30
        </span>
        <span
          className={`absolute text-xs -translate-x-1/2 ${sliderIndex === 7 ? 'text-brand-600 dark:text-brand-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
          style={{ left: `${(7 / MAX_INDEX) * 100}%` }}
        >
          $70
        </span>
        <span
          className={`absolute right-0 text-xs ${sliderIndex === MAX_INDEX ? 'text-brand-600 dark:text-brand-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
        >
          All
        </span>
      </div>
    </div>
  );
}

// Helper functions to convert between filter state and slider value
export function filterStateToSliderValue(
  priceFilter: 'any' | 'free' | 'under20' | 'under100' | 'custom',
  customMaxPrice: number | null
): number | null {
  if (priceFilter === 'free') return 0;
  if (priceFilter === 'any') return null;
  if (priceFilter === 'under20') return 20;
  if (priceFilter === 'under100') return 100;
  if (priceFilter === 'custom') return customMaxPrice;
  return null;
}

export function sliderValueToFilterState(value: number | null): {
  priceFilter: 'any' | 'free' | 'under20' | 'under100' | 'custom';
  customMaxPrice: number | null;
} {
  if (value === null) return { priceFilter: 'any', customMaxPrice: null };
  if (value === 0) return { priceFilter: 'free', customMaxPrice: null };
  if (value === 20) return { priceFilter: 'under20', customMaxPrice: null };
  if (value === 100) return { priceFilter: 'under100', customMaxPrice: null };
  return { priceFilter: 'custom', customMaxPrice: value };
}
