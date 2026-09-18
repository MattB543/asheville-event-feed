# Evidence pass instructions (one Sonnet agent per grey group)

You are gathering evidence on whether a candidate is a real, persistent GROUP of people, or just a
recurring event where only the host recurs. A first-pass classifier read the event listings and marked
it "grey" (unsure). You add evidence from the full event records and the web, then make your own best
call. You are not the final decision; a human reviews the evidence files at the end.

## Definition

A group is a specific set of people with a shared identity who come back repeatedly and would recognize
each other as members: clubs (book, bike, run, hike, board game, chess), recovery and support meetings,
sanghas and congregational communities, community choirs / bands / jams with a returning core of
players, dance communities, volunteer crews, civic and advocacy groups, hobby and maker collectives,
social groups (singles, LGBTQ+, parents, language exchange), networking chapters with a fixed membership.

NOT a group when only the host recurs and the attendees are a rotating public: trivia, open mic,
karaoke, DJ nights, concerts and band residencies, classes taught by a business, guided commercial
tours, exhibitions, drink promos, library and museum drop-in programs, government meetings.

Not overly strict: if there is plausibly a real community with returning members behind it, lean
`group`. Open jams are the hardest case: a jam with a returning core of players who know each other is
a group; a "sign up and play a song" format is an open mic and is not.

## Steps

1. **Full event records.** From `C:\Users\matth\projects\asheville-event-feed` run

   ```
   npx tsx scripts/groups/show-units.ts <index> [<index> ...] --max 3
   ```

   with the indices from your assignment. Read the full descriptions, locations, prices, tags and every
   listing URL. Look for membership language ("members", "our group", "join us", dues, sign-up forms,
   named regulars or leaders, links to a Facebook group, Meetup, Discord, WhatsApp, newsletter), whether
   it is ticketed or commercial, who actually runs it, and whether the same people are described as
   returning.

2. **Web.** Use WebSearch (2 to 5 searches) for the group name plus "Asheville" or the relevant town, and
   WebFetch on the best hits, including at least one of the listing URLs. You are looking for a website
   or "about" page, a Facebook group or page, a Meetup page, Instagram, a news article, or a parent
   organization. If nothing turns up, that is evidence too; say so. Do not go down rabbit holes.

3. **Decide** `verdict`: `group`, `not_group`, or `still_unsure`, with a `confidence` from 0 to 1.

4. **Write** `C:\Users\matth\projects\asheville-event-feed\data\groups\evidence\<slug>.json` with the
   Write tool, exactly this shape:

   ```json
   {
     "group_name": "<the label from your assignment, verbatim>",
     "canonical_name": "<the group's real name if it differs from the label, else null>",
     "unit_indices": [<the indices from your assignment>],
     "verdict": "group" | "not_group" | "still_unsure",
     "confidence": 0.0,
     "website": "<best URL for the group itself: website, Facebook group or page, Meetup, Instagram; else null>",
     "summary": "<2-3 sentences: what it is, who runs it, whether the same people return>",
     "evidence": [
       { "source": "web" | "events", "url": "<url or null>", "note": "<one sentence>" }
     ]
   }
   ```

   Give 2 to 6 evidence items. `events` items cite what the listings themselves say; `web` items cite a
   page you actually fetched or a search result you read.

5. **Validate** from the project directory:

   ```
   node -e "JSON.parse(require('fs').readFileSync('data/groups/evidence/<slug>.json','utf8'));console.log('ok')"
   ```

## Report

Reply with one line: `<slug>: <verdict> (<confidence>) <website or "no web presence">`. Nothing else.
