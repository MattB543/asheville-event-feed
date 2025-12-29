This makes perfect sense. You are essentially moving from a **Rules-Based Engine** (filtering by tags and keywords) to a **Semantic Recommendation Engine** (filtering by "vibe" and intent).

### The Concept Explained Back to You

Instead of the user manually managing a list of blocked keywords like "Pesticide Training," the system observes that they hid a "Commercial Pesticide" event. The system looks at the **embedding** (the mathematical "DNA" of that event) and says: _"Anything that 'feels' like this event should be buried."_ Conversely, if they add a Jazz show to their calendar, the system finds the common thread between that and other live music and **boosts** those to the top.

You are creating a **User Interest Profile** that is a weighted average of their "Positive Vectors" (Favorites/Calendar) and "Negative Vectors" (Hidden).

---

### Detailed MVP Plan: Semantic Personalization

#### 1. Signal Instrumentation (The Data Collection)

To build a profile, we need to track more than just favorites.

- **Positive Signals:**
  - **Favorite:** Explicit high-intent.
  - **Add to Calendar:** The highest-intent signal (implies physical attendance).
  - **"View Source" Click:** Moderate-intent signal (interest in details).
- **Negative Signals:**
  - **Hide Event:** Explicit dislike.
  - **Block Host:** Explicit dislike for a category/venue.
- **Storage:** We need to ensure that when an event is favorited or hidden, we store its **Embedding Vector** in a new table associated with the user. This is crucial because scraped events are eventually deleted or age out, but the _type_ of thing the user likes must persist.

#### 2. The "User Interest Profile" (The Math)

We create a dynamic "Persona" for each logged-in user:

- **The Positive Centroid:** An average vector of the last 20 events the user liked.
- **The Negative Centroid:** An average vector of the last 20 events the user disliked.
- **Recency Weighting:** Newer likes/dislikes should have a slightly higher weight than a show they liked 6 months ago, allowing their tastes to evolve.

#### 3. The Personalized Ranking Algorithm

When the user visits the "For You" page (or toggles a "Personalized" view):

1.  **Fetch:** Pull all events for the next 10 days.
2.  **Compare:** For each event, calculate two scores using vector similarity:
    - **Score A:** Similarity to the user’s Positive Centroid.
    - **Score B:** Similarity to the user’s Negative Centroid.
3.  **Final Rank:** `FinalScore = (Score A - Score B)`.
4.  **Thresholding:**
    - If `FinalScore` is very high: **Highlight/Badge** the event (e.g., "98% Match").
    - If `FinalScore` is very low: **Auto-collapse** or hide the event, even if it doesn't match a specific blocked keyword.

#### 4. UI/UX Changes

- **The "For You" Tab:** A new primary view next to "All Events."
- **Match Visuals:** Small, subtle indicators on event cards (e.g., a "Sparkle" icon for events that strongly match their profile).
- **Feedback Transparency:** If an event is boosted, a tiny tooltip could say: _"Recommended because you liked 'Jazz at Little Jumbo'."_ This builds trust in the AI.
- **Rate-Limiting Logic:** Because vector math on hundreds of events can be heavy, this ranking should happen once per session or be cached for the user for an hour.

#### 5. "I'm Feeling Lucky" (The Apex Feature)

Once the ranking algorithm is live, this button becomes trivial to build:

- It looks at the #1 ranked event for "Tonight" that the user hasn't seen yet.
- It presents it with a "High Confidence" UI.
- It provides a "Not for me" button, which immediately feeds back into the Negative Centroid, making the next "Lucky" pick even better.

### Success Metrics for MVP

1.  **Click-Through Rate (CTR):** Are users clicking "View Source" more often on the "For You" tab than the "All Events" tab?
2.  **Signal Volume:** How many users are actually using the "Hide" feature now that it has "superpowers"?
3.  **Retention:** Does the personalized feed bring users back more frequently because the "Noise" is gone?

### Why this is a winner for your IUP:

Asheville has a high volume of "niche" events. A user might love "Experimental Noise Music" but hate "Bluegrass." Tags often lump these both under "Music." Your semantic approach is the only way to truly distinguish between them without forcing the user to manage a 500-word blocklist.
