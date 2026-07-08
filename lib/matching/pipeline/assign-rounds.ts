import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matchingProfileCards, matchingTopMatches, matchingProfiles } from '@/lib/db/schema';
import type { MatchEntry } from './types';

export type RoundPair = {
  people: Array<{ profileId: string; name: string }>;
  weight: number;
  detail: string;
};

export type RoundAssignment = { round: number; pairs: RoundPair[] };

export type AssignmentResult = {
  rounds: RoundAssignment[];
  totalWeight: number;
  participantCount: number;
  warnings: string[];
  unmatchedEdges: Array<{
    a: string;
    b: string;
    aName: string;
    bName: string;
    weight: number;
    detail: string;
  }>;
};

type Participant = { profileId: string; name: string };

type Edge = {
  a: string;
  b: string;
  weight: number;
  rankA: number | null;
  rankB: number | null;
  scoreA: number;
  scoreB: number;
};

function normalizeConfidence(c: number): number {
  if (c <= 1) return Math.round(c * 100);
  return Math.round(c);
}

function buildEdgeDetail(
  rankA: number | null,
  rankB: number | null,
  scoreA: number,
  scoreB: number
): string {
  const rA = rankA !== null ? `#${rankA}` : '--';
  const rB = rankB !== null ? `#${rankB}` : '--';
  return `${rA}\u2194${rB}, score ${scoreA}+${scoreB}`;
}

export function buildWeightMatrix(
  participants: Participant[],
  matchData: Map<string, MatchEntry[]>
): Map<string, Edge> {
  const edges = new Map<string, Edge>();
  const participantIds = new Set(participants.map((p) => p.profileId));

  for (const [fromId, matches] of matchData.entries()) {
    if (!participantIds.has(fromId)) continue;
    for (const m of matches) {
      if (!participantIds.has(m.profile_id)) continue;
      const key = [fromId, m.profile_id].sort().join('|');
      const confidence = normalizeConfidence(m.confidence);

      if (!edges.has(key)) {
        edges.set(key, {
          a: key.split('|')[0],
          b: key.split('|')[1],
          weight: 0,
          rankA: null,
          rankB: null,
          scoreA: 50,
          scoreB: 50,
        });
      }

      const edge = edges.get(key)!;
      if (fromId === edge.a) {
        edge.rankA = m.rank;
        edge.scoreA = confidence;
      } else {
        edge.rankB = m.rank;
        edge.scoreB = confidence;
      }

      const pairRankWeight =
        (edge.rankA !== null ? 6 - edge.rankA : 0) + (edge.rankB !== null ? 6 - edge.rankB : 0);
      const scoreWeight = edge.scoreA + edge.scoreB;
      edge.weight = pairRankWeight * 1000 + scoreWeight;
    }
  }

  return edges;
}

function getEdgeWeight(edgeLookup: Map<string, number>, x: string, y: string): number {
  const key = [x, y].sort().join('|');
  return edgeLookup.get(key) ?? 0;
}

// Max-weight matching with cardinality priority.
// Phase 1: greedy by weight. Phase 2: local swaps. Phase 3: augmenting paths for unmatched.
export function findMaxWeightMatching(
  participants: string[],
  availableEdges: Edge[]
): Array<{ a: string; b: string; weight: number }> {
  if (participants.length < 2 || availableEdges.length === 0) return [];

  const participantSet = new Set(participants);
  const edges = availableEdges
    .filter((e) => participantSet.has(e.a) && participantSet.has(e.b))
    .sort((a, b) => b.weight - a.weight);

  if (edges.length === 0) return [];

  // Build edge lookup
  const edgeLookup = new Map<string, number>();
  for (const edge of edges) {
    const key = [edge.a, edge.b].sort().join('|');
    if (!edgeLookup.has(key)) edgeLookup.set(key, edge.weight);
  }

  // Build adjacency list for augmenting paths
  const adj = new Map<string, string[]>();
  for (const p of participants) {
    if (participantSet.has(p)) adj.set(p, []);
  }
  for (const edge of edges) {
    adj.get(edge.a)?.push(edge.b);
    adj.get(edge.b)?.push(edge.a);
  }

  // Phase 1: Greedy
  const matched = new Set<string>();
  const matching: Array<{ a: string; b: string; weight: number }> = [];
  const matchOf = new Map<string, string>(); // partner lookup

  for (const edge of edges) {
    if (matched.has(edge.a) || matched.has(edge.b)) continue;
    matching.push({ a: edge.a, b: edge.b, weight: edge.weight });
    matched.add(edge.a);
    matched.add(edge.b);
    matchOf.set(edge.a, edge.b);
    matchOf.set(edge.b, edge.a);
  }

  // Phase 2: Local swap search
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < matching.length; i++) {
      for (let j = i + 1; j < matching.length; j++) {
        const { a: a1, b: b1, weight: w1 } = matching[i];
        const { a: a2, b: b2, weight: w2 } = matching[j];
        const currentWeight = w1 + w2;

        const opt1 = getEdgeWeight(edgeLookup, a1, a2) + getEdgeWeight(edgeLookup, b1, b2);
        const opt2 = getEdgeWeight(edgeLookup, a1, b2) + getEdgeWeight(edgeLookup, b1, a2);

        if (opt1 > currentWeight && opt1 >= opt2) {
          matching[i] = { a: a1, b: a2, weight: getEdgeWeight(edgeLookup, a1, a2) };
          matching[j] = { a: b1, b: b2, weight: getEdgeWeight(edgeLookup, b1, b2) };
          matchOf.set(a1, a2);
          matchOf.set(a2, a1);
          matchOf.set(b1, b2);
          matchOf.set(b2, b1);
          improved = true;
        } else if (opt2 > currentWeight) {
          matching[i] = { a: a1, b: b2, weight: getEdgeWeight(edgeLookup, a1, b2) };
          matching[j] = { a: b1, b: a2, weight: getEdgeWeight(edgeLookup, b1, a2) };
          matchOf.set(a1, b2);
          matchOf.set(b2, a1);
          matchOf.set(b1, a2);
          matchOf.set(a2, b1);
          improved = true;
        }
      }
    }
  }

  // Phase 3: Augmenting paths for unmatched participants
  // For each pair of unmatched participants, try to find an augmenting path
  // through the existing matching to pair them both.
  const unmatched = participants.filter((p) => participantSet.has(p) && !matched.has(p));

  for (let u = 0; u < unmatched.length; u++) {
    const uId = unmatched[u];
    if (matched.has(uId)) continue; // may have been matched by a previous augmentation

    // BFS for augmenting path: unmatched -> matched_vertex -> their_partner -> ... -> unmatched
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = [];

    // Start from uId's neighbors
    for (const neighbor of adj.get(uId) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, uId);
        queue.push(neighbor);
      }
    }

    let foundEnd: string | null = null;

    while (queue.length > 0 && !foundEnd) {
      const current = queue.shift()!;

      if (!matched.has(current)) {
        // Found another unmatched vertex — augmenting path complete
        foundEnd = current;
        break;
      }

      // current is matched; follow the matching edge to their partner
      const partner = matchOf.get(current)!;
      if (visited.has(partner)) continue;
      visited.add(partner);
      parent.set(partner, current);

      // Then explore partner's free neighbors
      for (const neighbor of adj.get(partner) ?? []) {
        if (!visited.has(neighbor) && neighbor !== uId) {
          visited.add(neighbor);
          parent.set(neighbor, partner);
          queue.push(neighbor);
        }
      }
    }

    if (foundEnd) {
      // Trace back the augmenting path and flip matching edges
      let cur = foundEnd;
      while (cur !== uId) {
        const prev = parent.get(cur)!;
        const prevPrev = parent.get(prev);

        // Add edge (prev, cur) to matching
        const w = getEdgeWeight(edgeLookup, prev, cur);
        matched.add(prev);
        matched.add(cur);
        matchOf.set(prev, cur);
        matchOf.set(cur, prev);

        // Remove old matching edge involving prev (if it was matched before)
        const oldIdx = matching.findIndex(
          (m) => (m.a === prev && m.b !== cur) || (m.b === prev && m.a !== cur)
        );
        if (oldIdx >= 0) {
          matching.splice(oldIdx, 1);
        }

        matching.push({ a: prev, b: cur, weight: w });

        if (!prevPrev || prevPrev === uId) break;
        cur = prevPrev;
      }

      // uId should now be connected through the path reconstruction
    }
  }

  return matching;
}

// Evaluate a full schedule including trio assignments. Returns total weight.
function evaluateSchedule(
  rounds: Array<Array<{ a: string; b: string; weight: number }>>,
  participantIds: string[],
  edgeMap: Map<string, Edge>,
  isOdd: boolean
): number {
  let total = 0;
  const usedThirds = new Set<string>();

  for (const matching of rounds) {
    for (const pair of matching) {
      total += pair.weight;
    }

    if (isOdd) {
      const matchedInRound = new Set<string>();
      for (const m of matching) {
        matchedInRound.add(m.a);
        matchedInRound.add(m.b);
      }
      const unmatchedId = participantIds.find((id) => !matchedInRound.has(id));
      if (unmatchedId && matching.length > 0) {
        const { combinedWeight } = findBestTrioPartnerWithRotation(
          unmatchedId,
          matching,
          edgeMap,
          usedThirds
        );
        total += combinedWeight;
        usedThirds.add(unmatchedId);
      }
    }
  }

  return total;
}

function findBestTrioPartnerWithRotation(
  unmatched: string,
  pairs: Array<{ a: string; b: string; weight: number }>,
  edgeMap: Map<string, Edge>,
  usedThirds: Set<string>
): { pairIndex: number; combinedWeight: number } {
  let bestIdx = 0;
  let bestWeight = -1;
  let bestHasRotationBonus = false;

  for (let i = 0; i < pairs.length; i++) {
    const keyA = [unmatched, pairs[i].a].sort().join('|');
    const keyB = [unmatched, pairs[i].b].sort().join('|');
    const wA = edgeMap.get(keyA)?.weight ?? 0;
    const wB = edgeMap.get(keyB)?.weight ?? 0;
    const combined = wA + wB;

    // Prefer pairs where neither member has been a third before
    const hasRotationBonus = !usedThirds.has(pairs[i].a) && !usedThirds.has(pairs[i].b);

    const isBetter =
      (hasRotationBonus && !bestHasRotationBonus && combined > 0) ||
      (hasRotationBonus === bestHasRotationBonus && combined > bestWeight);

    if (isBetter) {
      bestWeight = combined;
      bestIdx = i;
      bestHasRotationBonus = hasRotationBonus;
    }
  }

  return { pairIndex: bestIdx, combinedWeight: bestWeight > 0 ? bestWeight : 0 };
}

export function assignRoundsFromData(
  participants: Participant[],
  matchData: Map<string, MatchEntry[]>,
  numRounds: number
): AssignmentResult {
  const warnings: string[] = [];
  const edgeMap = buildWeightMatrix(participants, matchData);
  const allEdges = Array.from(edgeMap.values());
  const nameMap = new Map<string, string>();
  for (const p of participants) {
    nameMap.set(p.profileId, p.name);
  }

  // Warn about participants with no match data
  for (const p of participants) {
    if (!matchData.has(p.profileId)) {
      const hasInboundEdge = allEdges.some((e) => e.a === p.profileId || e.b === p.profileId);
      if (!hasInboundEdge) {
        warnings.push(
          `${p.name} (${p.profileId}) has no match data and no inbound edges — may be unscheduled`
        );
      } else {
        warnings.push(
          `${p.name} (${p.profileId}) has no outbound match data (but appears in others' lists)`
        );
      }
    }
  }

  const isOdd = participants.length % 2 === 1;
  const participantIds = participants.map((p) => p.profileId);

  // Generate all permutations of round priority ordering
  const roundIndices = Array.from({ length: numRounds }, (_, i) => i);
  const permutations = getPermutations(roundIndices);

  let bestRounds: Array<Array<{ a: string; b: string; weight: number }>> | null = null;
  let bestTotalWeight = -1;

  for (const perm of permutations) {
    const usedPairs = new Set<string>();
    const rounds: Array<Array<{ a: string; b: string; weight: number }>> = Array.from(
      { length: numRounds },
      () => []
    );

    for (const roundIdx of perm) {
      const available = allEdges.filter((e) => {
        const key = [e.a, e.b].sort().join('|');
        return !usedPairs.has(key);
      });

      const matching = findMaxWeightMatching(participantIds, available);
      rounds[roundIdx] = matching;

      for (const pair of matching) {
        const key = [pair.a, pair.b].sort().join('|');
        usedPairs.add(key);
      }
    }

    // Score includes trio contributions for accurate comparison
    const totalWeight = evaluateSchedule(rounds, participantIds, edgeMap, isOdd);

    if (totalWeight > bestTotalWeight) {
      bestTotalWeight = totalWeight;
      bestRounds = rounds;
    }
  }

  // Build final result with trio handling
  const usedThirds = new Set<string>();
  const trioEdgesUsed = new Set<string>(); // track trio relationships across rounds
  const finalRounds: RoundAssignment[] = [];
  let totalWeight = 0;

  for (let r = 0; r < numRounds; r++) {
    const matching = bestRounds![r];
    const pairs: RoundPair[] = [];

    const matchedInRound = new Set<string>();
    for (const m of matching) {
      matchedInRound.add(m.a);
      matchedInRound.add(m.b);
      totalWeight += m.weight;
    }

    for (const m of matching) {
      const edge = edgeMap.get([m.a, m.b].sort().join('|'));
      const nameA = nameMap.get(m.a) ?? m.a;
      const nameB = nameMap.get(m.b) ?? m.b;
      const detail = edge
        ? buildEdgeDetail(edge.rankA, edge.rankB, edge.scoreA, edge.scoreB)
        : `${nameA} \u2194 ${nameB}`;

      pairs.push({
        people: [
          { profileId: m.a, name: nameA },
          { profileId: m.b, name: nameB },
        ],
        weight: m.weight,
        detail,
      });
    }

    // Handle odd participant with rotation
    if (isOdd) {
      const unmatchedId = participantIds.find((id) => !matchedInRound.has(id));
      if (unmatchedId && pairs.length > 0) {
        const { pairIndex, combinedWeight } = findBestTrioPartnerWithRotation(
          unmatchedId,
          matching,
          edgeMap,
          usedThirds
        );
        const targetPair = pairs[pairIndex];
        const unmatchedName = nameMap.get(unmatchedId) ?? unmatchedId;
        targetPair.people.push({ profileId: unmatchedId, name: unmatchedName });
        targetPair.weight += combinedWeight;
        targetPair.detail += ` + ${unmatchedName} (trio)`;
        totalWeight += combinedWeight;

        // Track trio edges so they count as "scheduled"
        trioEdgesUsed.add([unmatchedId, matching[pairIndex].a].sort().join('|'));
        trioEdgesUsed.add([unmatchedId, matching[pairIndex].b].sort().join('|'));
        usedThirds.add(unmatchedId);
      }
    }

    pairs.sort((a, b) => b.weight - a.weight);
    finalRounds.push({ round: r + 1, pairs });
  }

  // Find unmatched mutual edges (both ranked each other but never scheduled)
  const scheduledPairs = new Set<string>();
  for (const round of bestRounds!) {
    for (const pair of round) {
      scheduledPairs.add([pair.a, pair.b].sort().join('|'));
    }
  }
  // Also count trio edges as scheduled
  for (const key of trioEdgesUsed) {
    scheduledPairs.add(key);
  }

  const unmatchedEdges: AssignmentResult['unmatchedEdges'] = [];
  for (const edge of allEdges) {
    if (edge.rankA !== null && edge.rankB !== null) {
      const key = [edge.a, edge.b].sort().join('|');
      if (!scheduledPairs.has(key)) {
        unmatchedEdges.push({
          a: edge.a,
          b: edge.b,
          aName: nameMap.get(edge.a) ?? edge.a,
          bName: nameMap.get(edge.b) ?? edge.b,
          weight: edge.weight,
          detail: buildEdgeDetail(edge.rankA, edge.rankB, edge.scoreA, edge.scoreB),
        });
      }
    }
  }

  unmatchedEdges.sort((a, b) => b.weight - a.weight);

  return {
    rounds: finalRounds,
    totalWeight,
    participantCount: participants.length,
    warnings,
    unmatchedEdges,
  };
}

function getPermutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of getPermutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

export async function assignRounds(options: {
  runId: string;
  numRounds: number;
}): Promise<AssignmentResult> {
  const { runId, numRounds } = options;

  const cardRows = await db
    .select({
      profileId: matchingProfileCards.profileId,
      displayName: matchingProfiles.displayName,
    })
    .from(matchingProfileCards)
    .innerJoin(matchingProfiles, eq(matchingProfileCards.profileId, matchingProfiles.id))
    .where(eq(matchingProfileCards.runId, runId));

  const participants: Participant[] = cardRows.map((row) => ({
    profileId: row.profileId,
    name: row.displayName ?? 'Unknown',
  }));

  if (participants.length < 2) {
    return {
      rounds: [],
      totalWeight: 0,
      participantCount: participants.length,
      warnings: [],
      unmatchedEdges: [],
    };
  }

  const matchRows = await db
    .select({
      profileId: matchingTopMatches.profileId,
      matchesJson: matchingTopMatches.matchesJson,
    })
    .from(matchingTopMatches)
    .where(eq(matchingTopMatches.runId, runId));

  const matchData = new Map<string, MatchEntry[]>();
  for (const row of matchRows) {
    const json = row.matchesJson as { target_profile_id?: string; matches?: unknown[] } | null;
    if (!json || !Array.isArray(json.matches)) continue;

    const entries: MatchEntry[] = [];
    for (const item of json.matches) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      const profileId =
        typeof m.profile_id === 'string'
          ? m.profile_id.trim()
          : typeof m.profileId === 'string'
            ? m.profileId.trim()
            : '';
      if (!profileId) continue;

      const confidence = typeof m.confidence === 'number' ? normalizeConfidence(m.confidence) : 50;
      const rank = typeof m.rank === 'number' ? m.rank : entries.length + 1;

      entries.push({
        rank,
        profile_id: profileId,
        name: typeof m.name === 'string' ? m.name : '',
        why_match: typeof m.why_match === 'string' ? m.why_match : '',
        mutual_value: typeof m.mutual_value === 'string' ? m.mutual_value : '',
        conversation_starter:
          typeof m.conversation_starter === 'string' ? m.conversation_starter : '',
        confidence,
      });
    }

    matchData.set(row.profileId, entries);
  }

  return assignRoundsFromData(participants, matchData, numRounds);
}
