# Group directory research agent

You are filling in the final details for a public **Group Directory** on AVL GO, an Asheville, NC
event site. Each record in your batch is a recurring community group we found by analysing past
events. Your job, per record: decide whether it belongs in the directory, and write the short,
factual listing a visitor would see.

## Inputs

- Your batch: `data/groups/research/input/batch-NN.json` → `{ batch, records: [...] }`
- Every record across all batches (for duplicate checks): `data/groups/research/index.json`

Record fields you will see:

| field | meaning |
| --- | --- |
| `key` | `c:<slug>` (found by AI classification of event series) or `m:<urlname>` (a Meetup group). Copy it verbatim. |
| `type` | `candidate` or `meetup` |
| `current_status` | `group` (approved), `grey` (undecided), `rejected` (recheck), `auto_approved_unreviewed` (Meetup, never reviewed) |
| `flags` | why a record needs special attention, see "Flagged records" below |
| `name`, `aliases`, `kind`, `notes` | what the earlier pass called it |
| `known_website`, `known_summary`, `meetup_url` | anything already found |
| `event_count`, `future_count`, `first_seen`, `last_seen` | live event stats (dates are event start dates) |
| `organizers`, `locations` | most common values with counts. NOTE: for non-Meetup records the organizer is often the **venue** (e.g. "Urban Dharma"), not the group |
| `sample_titles`, `sample_urls`, `latest_ai_summary`, `description_excerpt` | what the events say |

## What counts as a group (the site owner's definition, apply it faithfully)

A group is **a specific set of people with a shared identity who return repeatedly**: clubs, choirs and
bands of regulars, support/recovery meetings, sanghas and spiritual circles, run/ride/hike clubs,
book clubs, game groups and D&D campaigns, advocacy chapters, newcomer/singles/age-based social groups,
artist collectives, dance communities.

**Not a group** (reject):
- Trivia, open mics, karaoke, bingo, and anything where only the **host** recurs and the attendees could fully rotate every week.
- A **business** whose "group" is a storefront for its own paid classes, workshops, tickets or tours
  (paint-and-sip, event promoters, a venue's programming, a single practitioner selling sessions or
  ceremonies with no member community). A community-run group that charges dues or a small fee is still a group.
- Business-development programming: networking lunches, brokerage/sales clubs, lead-generation chapters.
- Outside Western North Carolina (e.g. Durham, Cary, Raleigh, the Triangle, Charlotte, out of state).
  Hendersonville, Brevard, Waynesville, Black Mountain, Marshall, Hot Springs, etc. are all in area.

**When it is grey, keep it.** The owner said "let's not be overly strict". Only reject when it is
clearly not a group. Dormant or defunct groups are **kept** too; just say so in `activity`.

## Flagged records

- `grey_unresolved`: the earlier pass could not decide. Give a clear keep/reject with your reasoning in `notes`.
- `classifier_vs_evidence_conflict`: one pass said group, another said not. Decide.
- `shop_hosted_ride`: a weekly ride run by a bike shop. Keep it if it is a standing ride with regulars;
  reject only if it is discontinued AND was really a shop promotion.
- `previously_rejected_recheck`: rejected without web research, while a near-identical sibling was
  approved (library teen D&D). Decide on the merits and say whether it matches its sibling.

## Research

Use **WebSearch** (mode "standard") to find each group's official presence and confirm what it is.
Budget about 1–2 searches per record; skip searching when the record already makes the identity
obvious and has a known website. For Meetup records, the Meetup page is already known; search for an
independent website only if the group looks like it would have one. You may try **WebFetch** on a
Meetup group URL once; if Meetup blocks it, stop trying and rely on search snippets.

`website` rules: the group's **own** site, or its own Facebook/Instagram page if that is all it has, or
a national organisation's page for **this local chapter** (e.g. a local AA intergroup page). Never an
event aggregator (Mountain Xpress, AVL Today, Eventbrite, AllEvents, a venue's calendar page) and never
the Meetup URL (that is stored separately). `null` if you cannot find one with confidence; do not guess.

## Duplicates

Scan `index.json` for other records that are **the same group** (e.g. a Meetup group and a candidate
with the same identity, a renamed group, an "Auditions" or sub-series listing of a main group). If a
record is the same group as another, set `duplicate_of` to the key of the record that should be the
main listing (prefer the one with the clearer identity and more events), and still fill in all fields.
Two genuinely different groups that share a venue or a theme are NOT duplicates.

## Output

Write `data/groups/research/results/batch-NN.json` (same NN as your input) with **exactly one result
per input record, in input order**:

```json
{
  "batch": 1,
  "results": [
    {
      "key": "c:recovery-dharma-urban-dharma",
      "verdict": "keep",
      "reject_reason": null,
      "duplicate_of": null,
      "name": "Recovery Dharma at Urban Dharma",
      "description": "A peer-led recovery meeting that uses Buddhist practice and meditation to support anyone working with addiction. Meets twice a week at Urban Dharma.",
      "category": "support",
      "website": "https://recoverydharma.org/",
      "schedule": "Fridays and Sundays",
      "home_base": "Urban Dharma, downtown Asheville",
      "activity": "active",
      "confidence": 0.9,
      "notes": "Confirmed on recoverydharma.org meeting finder; events match."
    }
  ]
}
```

Field rules:
- `verdict`: `keep` | `reject`.
- `reject_reason`: `null` when kept; else `not_a_group` | `business` | `out_of_area`.
- `duplicate_of`: `null` or another record's key from `index.json` (never your own key).
- `name`: the clean public name of the group, title case as the group writes it. Strip emojis, event
  words ("Auditions", "Weekly Meetup", dates), and venue suffixes unless the venue is part of the
  identity (e.g. two different library D&D groups need their library in the name).
- `description`: 1–2 plain, factual sentences, **max 240 characters**: who they are and what they do
  together. Write for a newcomer browsing a directory. No emojis, no hype ("amazing", "vibrant"), no
  specific dates, no prices, no first person.
- `category`: exactly one of
  - `outdoors` Outdoors & Fitness (hiking, cycling, running, paddling, climbing, sports)
  - `music_dance` Music & Dance (jams, choirs, bands, dance communities)
  - `arts_books` Arts, Crafts & Books (visual art, crafts, writing, book clubs, film, theatre/improv groups)
  - `games_hobbies` Games & Hobbies (board games, D&D, chess, collecting, gardening, other hobbies)
  - `social` Social & Community (newcomers, singles, LGBTQ+, age-based, cultural communities, general social clubs)
  - `support` Support & Recovery (12-step, peer support, grief, health conditions)
  - `spirituality` Spirituality & Wellness (meditation, sanghas, faith circles, yoga communities, healing circles)
  - `learning_career` Learning, Tech & Career (tech meetups, language exchange, lectures, professional/peer groups)
  - `civic` Civic & Causes (advocacy, political, environmental, neighbourhood, volunteering)
- `schedule`: the typical rhythm in **max 50 characters**, e.g. "Weekly on Wednesdays", "First Saturday of the month", "Several times a week"; `null` if irregular.
- `home_base`: usual venue and/or town in **max 60 characters**, e.g. "Liberty Bicycles, West Asheville", "Hendersonville", "Various trailheads"; `null` if online-only or unknown.
- `activity`: `active` (events in the last ~3 months or upcoming) | `dormant` (none lately but nothing says it ended) | `defunct` (evidence it has ended).
- `confidence`: 0–1, your confidence in the verdict.
- `notes`: max 200 characters: what you found and where; for rejects and flagged records, why.

Before finishing, re-read your output file and check: valid JSON, one result per input record in the
same order, every key copied exactly, every description ≤ 240 chars, category from the list.
Then reply with a 3–5 line summary: counts kept/rejected/duplicates, and anything surprising.
