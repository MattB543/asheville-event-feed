/**
 * Mapping of zip codes to friendly neighborhood/area names
 * Used in the location filter dropdown
 */
export const ZIP_NAMES: Record<string, string> = {
  // Asheville area zips
  '28801': 'Downtown',
  '28802': 'Downtown (PO)',
  '28803': 'South Asheville',
  '28804': 'North Asheville',
  '28805': 'East Asheville',
  '28806': 'West Asheville',
  '28810': 'Asheville (PO)',
  '28813': 'Asheville (PO)',
  '28814': 'Asheville (PO)',
  '28815': 'Asheville (PO)',
  '28816': 'Asheville (PO)',

  // Nearby towns
  '28711': 'Black Mountain',
  '28715': 'Candler',
  '28730': 'Fairview',
  '28732': 'Fletcher',
  '28739': 'Hendersonville',
  '28748': 'Leicester',
  '28778': 'Swannanoa',
  '28787': 'Weaverville',
  '28704': 'Arden',
  '28731': 'Flat Rock',
  '28759': 'Mills River',
  '28792': 'Hendersonville',
};

/**
 * Asheville-area zip codes (288xx prefix)
 * Used to determine if a zip should be auto-selected with "Asheville area"
 */
export const ASHEVILLE_ZIPS = [
  '28801', '28802', '28803', '28804', '28805', '28806',
  '28810', '28813', '28814', '28815', '28816',
];

/**
 * Get friendly name for a zip code
 */
export function getZipName(zip: string): string {
  return ZIP_NAMES[zip] || zip;
}

/**
 * Check if a zip is in the Asheville area
 */
export function isAshevilleZip(zip: string): boolean {
  return ASHEVILLE_ZIPS.includes(zip) || zip.startsWith('288');
}
