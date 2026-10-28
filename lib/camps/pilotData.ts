import pilotImport from '@/data/camps/pilot/import.json';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import { buildListings, type CampListing, type CampsData } from './display';

/**
 * The pilot's camps, read from the committed import file (scripts/camps/build-pilot.ts) until
 * drizzle/0025_camps.sql is applied; then this becomes a query over the camps tables.
 */
const data = pilotImport as unknown as CampsData & { generatedAt: string };

export function getCampListings(): CampListing[] {
  return buildListings(data, getTodayStringEastern());
}

export function getCampListing(slug: string): CampListing | null {
  return getCampListings().find((listing) => listing.slug === slug) ?? null;
}

export function campsDataInfo(): { generatedAt: string; attribution: string } {
  return { generatedAt: data.generatedAt, attribution: data.attribution };
}
