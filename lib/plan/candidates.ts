/**
 * Every candidate on the Nov 3, 2026 general-election ballot for Asheville
 * Mayor, Asheville City Council and the Buncombe County Board of
 * Commissioners. Party is left out on purpose: the page is nonpartisan.
 *
 * Seats: Mayor (1); City Council (3, at-large, top three vote-getters win);
 * County Commission Districts 1, 2 and 3 (1 each). The commission chair is not
 * on the 2026 ballot.
 *
 * Checked 2026-10-26 against:
 * - Buncombe County Board of Elections, Candidate Detail List for 11/03/2026
 *   (report dated 2026-08-13):
 *   https://www.buncombenc.gov/DocumentCenter/View/7523/2026-Candidate-List-PDF
 * - NC State Board of Elections candidate listing (updated 2026-10-25):
 *   https://s3.amazonaws.com/dl.ncsbe.gov/Elections/2026/Candidate%20Filing/Candidate_Listing_2026.csv
 * - 828newsNOW voter guide (2026-08-30) and Asheville Citizen Times
 *   commission preview (2026-10-06) for incumbency.
 *
 * Photos are 320x320 crops in public/plan/candidates/, from the page in
 * photoSource.
 */

/** 'emergency' is not on the ballot: the officials who run emergency management today */
export type Office = 'emergency' | 'mayor' | 'council' | 'commission';

export interface Candidate {
  /** Kebab-case of the name. */
  slug: string;
  /** As printed on the ballot. */
  name: string;
  office: Office;
  /** Human label, e.g. 'Mayor', 'City Council', 'County Commission, District 1'. */
  seat: string;
  incumbent: boolean;
  /** '/plan/candidates/<slug>.jpg' or null. */
  photo: string | null;
  /** Page the photo came from. */
  photoSource: string | null;
}

const CITY_COUNCIL_PAGE = 'https://www.ashevillenc.gov/government/meet-city-council/';
const BUNCOMBE_GOP_CANDIDATES = 'https://www.buncombegop.com/candidates';

/** Checked 2026-10-26 against the Buncombe County and NC State Board of Elections candidate lists. */
export const CANDIDATES: Candidate[] = [
  // Emergency management leads (appointed staff, not on the ballot)
  {
    slug: 'van-taylor-jones',
    name: 'Van Taylor Jones',
    office: 'emergency',
    // Title from the county staff directory (nc-buncombecounty.civicplus.com/directory.aspx?EID=41)
    seat: 'Emergency Services Director, Buncombe County',
    incumbent: false,
    // Photo supplied by Matt (2026-10-26)
    photo: '/plan/candidates/van-taylor-jones.jpg',
    photoSource: null,
  },
  {
    slug: 'jeremy-knighton',
    name: 'Jeremy Knighton',
    office: 'emergency',
    // Title from the city's fire department staff directory
    seat: 'Assistant Fire Chief, Emergency Management, Asheville Fire Department',
    incumbent: false,
    // Photo supplied by Matt (2026-10-26)
    photo: '/plan/candidates/jeremy-knighton.jpg',
    photoSource: null,
  },

  // Mayor (1 seat, nonpartisan)
  {
    slug: 'esther-manheimer',
    name: 'Esther Manheimer',
    office: 'mayor',
    seat: 'Mayor',
    incumbent: true,
    photo: '/plan/candidates/esther-manheimer.jpg',
    photoSource: CITY_COUNCIL_PAGE,
  },
  {
    // A sitting council member, but not the incumbent in this race.
    slug: 'kim-roney',
    name: 'Kim Roney',
    office: 'mayor',
    seat: 'Mayor',
    incumbent: false,
    photo: '/plan/candidates/kim-roney.jpg',
    photoSource: CITY_COUNCIL_PAGE,
  },

  // City Council (3 at-large seats, nonpartisan)
  {
    // A sitting county commissioner (not seeking re-election there).
    slug: 'drew-ball',
    name: 'Drew Ball',
    office: 'council',
    seat: 'City Council',
    incumbent: false,
    photo: '/plan/candidates/drew-ball.jpg',
    photoSource: 'https://www.ball4yall.com/',
  },
  {
    // Elected in 2022 as Maggie Ullman.
    slug: 'maggie-ullman-berthiaume',
    name: 'Maggie Ullman Berthiaume',
    office: 'council',
    seat: 'City Council',
    incumbent: true,
    photo: '/plan/candidates/maggie-ullman-berthiaume.jpg',
    photoSource: CITY_COUNCIL_PAGE,
  },
  {
    slug: 'jeffrey-burroughs',
    name: 'Jeffrey Burroughs',
    office: 'council',
    seat: 'City Council',
    incumbent: false,
    photo: '/plan/candidates/jeffrey-burroughs.jpg',
    photoSource: 'https://jeffreyforasheville.com/',
  },
  {
    slug: 's-antanette-mosley',
    name: 'S. Antanette Mosley',
    office: 'council',
    seat: 'City Council',
    incumbent: true,
    photo: '/plan/candidates/s-antanette-mosley.jpg',
    photoSource: CITY_COUNCIL_PAGE,
  },
  {
    slug: 'sheneika-e-smith',
    name: 'Sheneika E. Smith',
    office: 'council',
    seat: 'City Council',
    incumbent: true,
    photo: '/plan/candidates/sheneika-e-smith.jpg',
    photoSource: CITY_COUNCIL_PAGE,
  },
  {
    // Former council member (2015-2020).
    slug: 'keith-young',
    name: 'Keith Young',
    office: 'council',
    seat: 'City Council',
    incumbent: false,
    photo: '/plan/candidates/keith-young.jpg',
    photoSource: 'https://www.keithforavl.com/',
  },

  // County Commission, District 1 (open seat)
  {
    slug: 'anna-v-stearns',
    name: 'Anna V. Stearns',
    office: 'commission',
    seat: 'County Commission, District 1',
    incumbent: false,
    photo: '/plan/candidates/anna-v-stearns.jpg',
    photoSource: 'https://www.annaforbuncombe.com/',
  },
  {
    slug: 'rob-stetson',
    name: 'Rob Stetson',
    office: 'commission',
    seat: 'County Commission, District 1',
    incumbent: false,
    photo: '/plan/candidates/rob-stetson.jpg',
    photoSource: BUNCOMBE_GOP_CANDIDATES,
  },

  // County Commission, District 2 (open seat)
  {
    slug: 'lonnie-israel',
    name: 'Lonnie Israel',
    office: 'commission',
    seat: 'County Commission, District 2',
    incumbent: false,
    photo: '/plan/candidates/lonnie-israel.jpg',
    photoSource: 'https://www.lonnieisraelforbuncombe.com/',
  },
  {
    slug: 'greg-parks',
    name: 'Greg Parks',
    office: 'commission',
    seat: 'County Commission, District 2',
    incumbent: false,
    photo: '/plan/candidates/greg-parks.jpg',
    photoSource: BUNCOMBE_GOP_CANDIDATES,
  },

  // County Commission, District 3 (unopposed)
  {
    // Sitting commissioner; redistricting moved him from District 1 to District 3.
    slug: 'al-whitesides',
    name: 'Al Whitesides',
    office: 'commission',
    seat: 'County Commission, District 3',
    incumbent: true,
    photo: '/plan/candidates/al-whitesides.jpg',
    photoSource: 'https://www.buncombenc.gov/705/County-Commissioners',
  },
];
