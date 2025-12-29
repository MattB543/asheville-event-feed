This is an impressive pipeline. Looking at your data, the "strictness" of the curator is definitely the issue—the AI is following your "be conservative" instruction so well that it has nowhere to go for truly high-quality events.

Here are the optimized prompts to fix your two specific issues.

### 1. Improved Summary Prompt

The goal here is to eliminate redundancy. If the title is "Yoga in the Park," the summary shouldn't start with "Yoga in the park at..."

**Update the `SUMMARY RULES` section of your Phase 1 prompt to this:**

```text
## SUMMARY RULES:
- NEVER repeat the event title or venue name (assume the user has already read them).
- Focus on the "Hook": What is the specific vibe, a unique detail not in the title, or the exact activity?
- Format: A single, active sentence under 20 words.
- Start with a verb (e.g., "Featuring," "Blending," "Showcasing," "Exploring") or a direct descriptor.
- No city names, no dates, no prices.
- Bad: "Live music at The Orange Peel featuring Mersiv." (Redundant)
- Good: "Bass-heavy electronic sets with immersive lighting and experimental beat-driven performances."
- Bad: "Group meditation at Urban Dharma featuring silent sits." (Redundant)
- Good: "Guided silent practice focusing on traditional Buddhist techniques and community empowerment."
```

---

### 2. Improved Scoring Prompt

Your current distribution is "compressed." You have a floor of 5 (for recurring) and a self-imposed ceiling of ~18. We need to expand the dynamic range so that "Regional draws" hit the 20s and "Legendary/Major Festivals" hit 28-30.

**Update the `Scoring Pass` System Prompt to this:**

```text
You are an expert Event Curator for Asheville, NC. Your goal is to rank events so that the "Score" acts as a discovery heat-map.

## DIMENSION 1 - Rarity & Urgency (0-10)
How "missable" is this?
- 1-3: Daily/Weekly (Trivia, regular yoga, open mics).
- 4-5: Monthly or Seasonal (Monthly markets, standard holiday displays like Winter Lights).
- 6-7: Special Limited Runs (A 2-week theater run, a 3-stop workshop series).
- 8-9: True One-Offs (A touring band's only stop, a specific guest speaker, a unique gala).
- 10: Once-in-a-decade (Legendary artist, Centennial celebration, Solar Eclipse).

## DIMENSION 2 - Cool & Unique Factor (0-10)
How much "Main Character Energy" does this event have?
- 1-3: Standard/Utility (AA meetings, generic classes, basic networking).
- 4-6: Solid Entertainment (Local bands, standard stand-up, local brewery jams).
- 7-8: High Concept (Themed masquerades, specialized workshops like "Tarot with Cats," niche festivals).
- 9-10: Truly Novel (GWAR, extreme circus, "Crankie Fest," events with high production "weirdness").

## DIMENSION 3 - Magnitude & Caliber (0-10)
What is the scale of the "Draw"?
- 1-3: Hyper-local/Peer-led (Small meetups, student groups, neighborhood walks).
- 4-5: Professional Local (Established local acts, venue-staple performers, paid workshops).
- 6-7: Regional Draw (Well-known SE touring acts, mid-sized venue headliners like at Grey Eagle).
- 8-9: National Headliner (Acts at Orange Peel, Harrah's Arena, or major touring theater).
- 10: Global Icon (A-list celebrities, stadium-level acts, massive 10k+ person festivals).

## CALIBRATION LOGIC:
- If it's a TOURING ACT at a major venue (Orange Peel, Grey Eagle, Rabbit Rabbit), it should automatically start at 18+ total.
- If it's a massive ASHVILLE TRADITION (Gingerbread competition, Crankie Fest), it should score 20+.
- RECURRING EVENT RULE: A weekly event can still score high on Magnitude/Uniqueness. Don't let a "1" in Rarity crush a "9" in Magnitude.
- BELL CURVE: Aim for a broader spread.
  - 0-10: Standard weekly/utility.
  - 11-17: High-quality local weekend options.
  - 18-24: Major touring shows and significant local productions.
  - 25-30: "The biggest event of the month."

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "reason": "Short explanation."}
```

### Why these changes work:

1.  **Summary:** By assuming the title is already known, you've freed up 5-10 words of space. Instead of saying "A concert at The Orange Peel featuring RJD2," you get "Legendary instrumental hip-hop and electronic production featuring complex sampling and live MPC sets."
2.  **Scoring Floor:** I adjusted the Rarity 1-2 penalty. Before, a recurring event was basically blocked from ever reaching a 20. Now, if a world-class act (Magnitude 8) plays a very cool show (Unique 8), even if it's weekly (Rarity 3), it hits a **19/30**, which is "Above Average" rather than "Below Average."
3.  **The "Touring Act" Boost:** By explicitly mentioning venues like The Orange Peel or Grey Eagle, the AI will recognize that these are high-production environments. An event like **#285 (The Avett Brothers)** should be a 26/30, not a 16/30.
4.  **"Crankie Fest" Test:** An event like **#984 (Asheville Crankie Fest)** is exactly why people live in Asheville. Under your old prompt, it got a 14. Under this new prompt, it would likely get: Rarity 8 (Annual/Special) + Unique 9 (Ancient scroll art) + Magnitude 6 (Regional draw) = **23/30**. This makes it a "Featured" event, which is correct.
