/**
 * Score calculation utilities for event scoring with admin overrides and curator boosts.
 */

// TypeScript interfaces for score override structure
export interface CuratorBoost {
  curatorId: string;
  rarity?: number; // -2 to +2
  unique?: number; // -2 to +2
  magnitude?: number; // -2 to +2
  boostedAt: string; // ISO timestamp
}

export interface AdminOverride {
  rarity?: number; // 0-10
  unique?: number; // 0-10
  magnitude?: number; // 0-10
  reason?: string;
  setBy: string; // Admin user ID
  setAt: string; // ISO timestamp
}

export interface ScoreOverride {
  adminOverrides?: AdminOverride;
  curatorBoosts?: CuratorBoost[];
}

export interface AIScores {
  rarity: number;
  unique: number;
  magnitude: number;
}

export interface FinalScores {
  rarity: number;
  unique: number;
  magnitude: number;
  total: number;
}

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Aggregate all curator boosts, capping each category at ±6.
 */
export function aggregateCuratorBoosts(boosts: CuratorBoost[] | undefined): {
  rarity: number;
  unique: number;
  magnitude: number;
} {
  if (!boosts || boosts.length === 0) {
    return { rarity: 0, unique: 0, magnitude: 0 };
  }

  let totalRarity = 0;
  let totalUnique = 0;
  let totalMagnitude = 0;

  for (const boost of boosts) {
    totalRarity += boost.rarity ?? 0;
    totalUnique += boost.unique ?? 0;
    totalMagnitude += boost.magnitude ?? 0;
  }

  return {
    rarity: clamp(totalRarity, -6, 6),
    unique: clamp(totalUnique, -6, 6),
    magnitude: clamp(totalMagnitude, -6, 6),
  };
}

/**
 * Calculate final scores with admin overrides and curator boosts.
 *
 * Priority:
 * 1. Admin override (if set) completely replaces the category
 * 2. Otherwise: AI score + curator boost sum (clamped to 0-10)
 */
export function calculateFinalScores(
  aiScores: AIScores,
  override: ScoreOverride | null | undefined
): FinalScores {
  // Aggregate curator boosts
  const boostTotals = aggregateCuratorBoosts(override?.curatorBoosts);

  // Calculate final scores (admin override takes precedence)
  const finalRarity =
    override?.adminOverrides?.rarity ?? clamp(aiScores.rarity + boostTotals.rarity, 0, 10);

  const finalUnique =
    override?.adminOverrides?.unique ?? clamp(aiScores.unique + boostTotals.unique, 0, 10);

  const finalMagnitude =
    override?.adminOverrides?.magnitude ?? clamp(aiScores.magnitude + boostTotals.magnitude, 0, 10);

  return {
    rarity: finalRarity,
    unique: finalUnique,
    magnitude: finalMagnitude,
    total: finalRarity + finalUnique + finalMagnitude,
  };
}

/**
 * Format curator boosts for display (aggregate only, no names).
 * Returns null if no boosts.
 */
export function formatCuratorBoosts(boosts: CuratorBoost[] | undefined): string | null {
  const totals = aggregateCuratorBoosts(boosts);

  if (totals.rarity === 0 && totals.unique === 0 && totals.magnitude === 0) {
    return null;
  }

  const parts: string[] = [];
  if (totals.rarity !== 0) {
    parts.push(`${totals.rarity > 0 ? '+' : ''}${totals.rarity} rarity`);
  }
  if (totals.unique !== 0) {
    parts.push(`${totals.unique > 0 ? '+' : ''}${totals.unique} unique`);
  }
  if (totals.magnitude !== 0) {
    parts.push(`${totals.magnitude > 0 ? '+' : ''}${totals.magnitude} magnitude`);
  }

  return `Curator boosts: ${parts.join(', ')}`;
}
