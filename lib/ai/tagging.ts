import { getModel, isAIEnabled } from "./client";

interface EventData {
  title: string;
  description?: string | null;
  location?: string | null;
  organizer?: string | null;
  startDate: Date;
}

// All allowed tags - AI must ONLY use tags from this list
const ALLOWED_TAGS = [
  // Entertainment
  'Live Music', 'Comedy', 'Theater & Film', 'Dance', 'Trivia',
  // Food & Drink
  'Dining', 'Beer', 'Wine & Spirits', 'Food Classes',
  // Activities
  'Art', 'Crafts', 'Fitness', 'Wellness', 'Spiritual', 'Outdoors', 'Tours', 'Gaming',
  'Sports', 'Education', 'Book Club',
  // Audience/Social
  'Family', 'Dating', 'Networking', 'Nightlife', 'LGBTQ+', 'Pets',
  'Community', 'Civic', 'Volunteering', 'Support Groups',
  // Seasonal
  'Holiday', 'Markets',
] as const;

const TAG_GUIDELINES = `
ALLOWED TAGS (use ONLY these exact tags, nothing else):

Entertainment:
- Live Music – concerts, bands, open mics
- Comedy – stand-up, improv, showcases
- Theater & Film – plays, performances, movie nights
- Dance – lessons, parties, social dance nights
- Trivia – pub trivia, game nights

Food & Drink:
- Dining – special dinners, brunches, prix fixe meals
- Beer – brewery events, tastings
- Wine & Spirits – wine tastings, cocktail events
- Food Classes – cooking, baking, cocktail-making workshops

Activities:
- Art – galleries, exhibits, visual art events
- Crafts – pottery, jewelry, DIY workshops
- Fitness – yoga, exercise, climbing, general fitness
- Sports – team sports, athletic events, competitions
- Wellness – sound healing, holistic health, self-care
- Spiritual – meditation, ceremonies, religious gatherings
- Outdoors – hiking, nature, parks
- Tours – walking tours, ghost tours, historical
- Gaming – board games, D&D, video games
- Education – classes, workshops, lectures, learning events
- Book Club – book discussions, reading groups, literary meetups

Audience/Social:
- Family – kid-friendly, all-ages
- Dating – singles events, speed dating
- Networking – business, professional meetups
- Nightlife – 21+, bar events, late-night
- LGBTQ+ – pride, queer-specific events
- Pets – dog-friendly, goat yoga, cat lounges
- Community – neighborhood events, local meetups
- Civic – government meetings, town halls, public forums, political events
- Volunteering – volunteer opportunities, community service, charity work
- Support Groups – recovery, grief, mental health support meetings

Seasonal:
- Holiday – seasonal celebrations, Christmas, Halloween, etc.
- Markets – pop-ups, vendors, shopping, craft fairs

IMPORTANT RULES:
1. For official tags: ONLY use tags from the list above. Do NOT create new tags for the official list.
2. NEVER use category names as tags (do NOT use: "Entertainment", "Food & Drink", "Activities", "Audience/Social", "Seasonal", "Other").
3. Use the exact tag spelling and capitalization shown above for official tags.
4. Custom tags should be lowercase, descriptive, and specific to the event (e.g., "jazz", "local venue", "beginner friendly", "outdoor seating").
`;

export async function generateEventTags(event: EventData): Promise<string[]> {
  // Get model lazily (allows dotenv to load first in scripts)
  const model = getModel();

  // Return empty array if AI is not configured
  if (!isAIEnabled() || !model) {
    return [];
  }

  const prompt = `
    You are an expert event tagger for Asheville, NC.
    Analyze the following event and assign tags in two categories:

    1. OFFICIAL TAGS (1-4 tags): Select from the provided list below. These are curated, user-facing tags.
    2. CUSTOM TAGS (1-5 tags): Create additional descriptive tags that capture specific details about the event (genre, vibe, skill level, venue type, etc.). These are for internal use.

    Return a JSON object with two arrays. Do not include markdown formatting or explanations.

    Event Details:
    Title: ${event.title}
    Description: ${event.description || "N/A"}
    Location: ${event.location || "N/A"}
    Organizer: ${event.organizer || "N/A"}
    Date: ${event.startDate.toISOString()}

    ${TAG_GUIDELINES}

    Example Output:
    {"official": ["Live Music", "Beer", "Nightlife"], "custom": ["jazz", "brewery venue", "weekend nightlife"]}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Clean up markdown code blocks if present
    const cleanedText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanedText);

    // Handle new format: { official: [...], custom: [...] }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const officialTags = Array.isArray(parsed.official) ? parsed.official : [];
      const customTags = Array.isArray(parsed.custom) ? parsed.custom : [];

      // Validate official tags against allowed list
      const validOfficialTags = officialTags.filter(
        (tag: unknown): tag is string =>
          typeof tag === "string" && ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
      );

      // Log if AI generated invalid official tags
      const invalidOfficialTags = officialTags.filter(
        (tag: unknown) => typeof tag === "string" && !ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
      );
      if (invalidOfficialTags.length > 0) {
        console.warn(`[Tagging] Invalid official tags for "${event.title}": ${invalidOfficialTags.join(", ")} (filtered out)`);
      }

      // Custom tags are allowed as-is (just ensure they're strings)
      const validCustomTags = customTags.filter(
        (tag: unknown): tag is string => typeof tag === "string" && (tag as string).trim().length > 0
      );

      // Return official tags first, then custom tags
      return [...validOfficialTags, ...validCustomTags];
    }

    // Fallback: handle old array format for backwards compatibility
    if (Array.isArray(parsed)) {
      console.warn("[Tagging] AI returned old array format, processing as official tags only");
      const validTags = parsed.filter(
        (tag): tag is string =>
          typeof tag === "string" && ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
      );
      return validTags;
    }

    console.warn("AI returned unexpected response format, returning empty array");
    return [];
  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
}
