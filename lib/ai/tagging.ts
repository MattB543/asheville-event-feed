import { getModel, isAIEnabled } from "./client";

interface EventData {
  title: string;
  description?: string | null;
  location?: string | null;
  organizer?: string | null;
  startDate: Date;
}

const TAG_GUIDELINES = `
##Entertainment
- **Live Music** – concerts, bands, open mics
- **Comedy** – stand-up, improv, showcases
- **Theater & Film** – plays, performances, movie nights
- **Dance** – lessons, parties, social dance nights
- **Trivia** – pub trivia, game nights

##Food & Drink
- **Dining** – special dinners, brunches, prix fixe meals
- **Beer** – brewery events, tastings
- **Wine & Spirits** – wine tastings, cocktail events
- **Food Classes** – cooking, baking, cocktail-making workshops

##Activities
- **Art** – galleries, exhibits, visual art events
- **Crafts** – pottery, jewelry, DIY workshops
- **Fitness** – yoga, exercise, sports, climbing
- **Wellness** – sound healing, support groups, holistic health
- **Spiritual** – meditation, ceremonies, religious gatherings
- **Outdoors** – hiking, nature, parks
- **Tours** – walking tours, ghost tours, historical
- **Gaming** – board games, D&D, video games

##Audience/Social
- **Family** – kid-friendly, all-ages
- **Dating** – singles events, speed dating
- **Networking** – business, professional meetups
- **Nightlife** – 21+, bar events, late-night
- **LGBTQ+** – pride, queer-specific events
- **Pets** – dog-friendly, goat yoga, cat lounges

##Other
- **Holiday** – seasonal celebrations
- **Markets** – pop-ups, vendors, shopping
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
    Analyze the following event and assign relevant tags from the provided list.
    Return ONLY a JSON array of strings. Do not include markdown formatting or explanations.

    Event Details:
    Title: ${event.title}
    Description: ${event.description || "N/A"}
    Location: ${event.location || "N/A"}
    Organizer: ${event.organizer || "N/A"}
    Date: ${event.startDate.toISOString()}

    Tag Guidelines:
    ${TAG_GUIDELINES}

    Example Output:
    ["Music", "Beer"]
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

    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
}
