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
  'Sports', 'Basketball', 'Education', 'Book Club',
  // Audience/Social
  'Family', 'Dating', 'Networking', 'Nightlife', 'LGBTQ+', 'Pets',
  'Community', 'Support Groups',
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
- Basketball – basketball games, leagues, pickup games
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
- Community – neighborhood events, civic gatherings, local meetups
- Support Groups – recovery, grief, mental health support meetings

Seasonal:
- Holiday – seasonal celebrations, Christmas, Halloween, etc.
- Markets – pop-ups, vendors, shopping, craft fairs

IMPORTANT RULES:
1. ONLY use tags from the list above. Do NOT create new tags.
2. NEVER use category names as tags (do NOT use: "Entertainment", "Food & Drink", "Activities", "Audience/Social", "Seasonal", "Other").
3. An event can have multiple tags if applicable.
4. Use the exact tag spelling and capitalization shown above.
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
    Analyze the following event and assign relevant tags ONLY from the provided list.
    Return ONLY a JSON array of strings. Do not include markdown formatting or explanations.

    Event Details:
    Title: ${event.title}
    Description: ${event.description || "N/A"}
    Location: ${event.location || "N/A"}
    Organizer: ${event.organizer || "N/A"}
    Date: ${event.startDate.toISOString()}

    ${TAG_GUIDELINES}

    Example Output:
    ["Live Music", "Beer", "Nightlife"]
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

    // Validate that the result is an array of strings
    if (!Array.isArray(parsed)) {
      console.warn("AI returned non-array response, returning empty array");
      return [];
    }

    // Filter to only allowed tags (safeguard against AI generating invalid tags)
    const validTags = parsed.filter(
      (tag): tag is string =>
        typeof tag === "string" && ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
    );

    // Log if AI generated invalid tags
    const invalidTags = parsed.filter(
      (tag) => typeof tag === "string" && !ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
    );
    if (invalidTags.length > 0) {
      console.warn(`AI generated invalid tags (filtered out): ${invalidTags.join(", ")}`);
    }

    return validTags;
  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
}
