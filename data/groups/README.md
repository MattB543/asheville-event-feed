# Group discovery

Goal: find the recurring **groups** behind the events in the DB - specific, persistent groups of people
with a shared identity who gather repeatedly (clubs, recovery meetings, sanghas, run clubs, civic groups) -
so they can eventually get their own table and page instead of only surfacing as individual events.

Not groups: series where only the host recurs and the attendees are a rotating public (trivia, open mics,
karaoke, concerts, classes taught by a business, tours, exhibitions, library story times, museum programs).

## Pipeline

1. **`npx tsx scripts/groups/build-buckets.ts`** (no AI)
   - `meetup-groups.json` - every Meetup group we hold events for. On Meetup the organizer _is_ the group and
     the `urlname` is the second path segment of every event URL, so this needs no classification.
   - `units.json` - one row per repeated **unit** across every other source: the same normalized title from the
     same organizer, seen 2+ times (`event_ids` links back to the `events` rows). Singletons (~10.6k) are
     skipped for now; most one-offs are not groups.
   - `buckets/bucket-NN.json` - the same units, 200 per file, sorted by organizer then title so one organizer's
     series are classified together. One row per line so an agent can read a bucket in one pass.
2. **One Opus agent per bucket** reads `buckets/bucket-NN.json` and writes `results/bucket-NN.json` (schema below).
3. **`npx tsx scripts/groups/merge-results.ts`** joins results back onto units, checks every index was
   classified exactly once, and writes `classified.json` (all units with verdicts, plus evidence when present)
   and `grey.json` (one entry per distinct grey group name with its unit indices).
4. **One Sonnet agent per grey group** reads the full event records
   (`npx tsx scripts/groups/show-units.ts <index> ...`), web-searches for the group, and writes
   `evidence/<slug>.json` (schema below). Re-running step 3 folds the evidence into `classified.json`.
5. **One Opus normalization agent** reads `normalize-input.json` (the 455 group/grey units plus the Meetup
   group list, generated from `classified.json`) and writes `aliases.json`: clusters of units that are the
   same real-world group, with a canonical name, kind, and a `meetup_urlname` when the same organization also
   posts on Meetup.
6. **`npx tsx scripts/groups/build-candidates.ts`** validates the alias map (every group/grey unit in exactly
   one cluster) and writes `candidates.json`: one entry per candidate group with `status`
   (`group` | `grey` | `rejected`), the classifier verdicts, the evidence verdict and confidence, website,
   aliases, sources, unit indices, event ids, first/last seen, and the Meetup link. Status rules are in the
   script header; the evidence fields stay on every entry so a human can second-guess them.
7. **Human review** goes in `reviewed.json` (`slug -> { status, note }`), which `build-candidates.ts` applies
   on top of the derived status and records as `review_note`. Re-run step 6 after editing it. Editing
   `candidates.json` by hand does not survive a rebuild; `reviewed.json` does.

### Results of the 2026-09-18 run

| Stage                                                  | Result                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Meetup groups (SQL only)                               | 226                                                                  |
| Non-Meetup repeated units classified (11 Opus buckets) | 2,128: 307 group, 148 grey, 1,673 not group                          |
| Grey groups given a Sonnet evidence pass               | 122: 33 group, 80 not group, 9 still unsure                          |
| Candidate clusters after normalization                 | 316: 235 group, 9 grey, 72 rejected; 12 linked to a Meetup group     |
| After human review                                     | 229 group, 8 grey, 79 rejected (see `reviewed.json` for the 8 calls) |

Known caveats: 2 clusters still mix a classifier `group` verdict with an evidence `not_group` verdict on a
sibling unit (they keep status `group`; see `classifier_verdicts` and `evidence_verdict`) - the King Street
open jam and the Pack Memorial teen D&D group. The other five were the IBN chapters, rejected on review. Six evidence files note
that web search ran out mid-pass and lean on the event records plus fetched listing pages. Shop-hosted
weekly rides (Liberty, Motion Makers, Youngblood, Gravelo) were kept as separate groups because they have a
regular riding crew, though a shop is a host rather than a club you join. Singletons were not classified.

`organizer` is usually the **venue**, not the group (roughly three of four rows across the big sources),
so the group name most often lives in the title or description. Some organizers are aggregator calendars
(Asheville on Bikes lists many clubs' rides).

## Result schema (`results/bucket-NN.json`)

```json
{
  "bucket": "bucket-01",
  "rows": [
    {
      "index": 0,
      "verdict": "group",
      "kind": "club",
      "group_name": "Blue Ridge Bicycle Club",
      "name_source": "description",
      "other_groups": ["Epic Cycles"],
      "reason": "club ride listed via Asheville on Bikes; BRBC hosts"
    },
    {
      "index": 1,
      "verdict": "not_group",
      "kind": "hosted_series",
      "group_name": null,
      "name_source": null,
      "other_groups": [],
      "reason": "weekly trivia, only the host recurs"
    }
  ]
}
```

- `verdict`: `group` | `grey` | `not_group`. Grey means "plausibly a community, can't tell" and is treated
  as a group for human review. Trivia and open mics are never grey.
- `kind`: group kinds `club`, `support_or_recovery`, `spiritual_community`, `social_group`,
  `civic_or_advocacy`, `arts_collective`; non-group kinds `hosted_series`, `performance`,
  `class_or_workshop`, `institution_program`, `exhibition_or_attraction`, `market_or_festival`,
  `promo_or_special`, `business_service`, `other`.
- `group_name`: canonical name the group would call itself; null for `not_group`.
- `name_source`: `title` | `organizer` | `description` | `inferred` | null.
- `other_groups`: co-hosts or parent orgs.
- `reason`: at most 20 words.

## Evidence schema (`evidence/<slug>.json`)

```json
{
  "group_name": "Blue Ridge Bicycle Club",
  "canonical_name": null,
  "unit_indices": [12, 13],
  "verdict": "group",
  "confidence": 0.9,
  "website": "https://www.blueridgebikeclub.org/",
  "summary": "Membership cycling club founded 1997; weekly rides listed via Asheville on Bikes.",
  "evidence": [
    {
      "source": "web",
      "url": "https://www.blueridgebikeclub.org/about",
      "note": "describes itself as a member club with annual dues"
    },
    { "source": "events", "url": null, "note": "same ride leaders named across 40 listings" }
  ]
}
```

- `verdict`: `group` | `not_group` | `still_unsure` - the evidence agent's own call, kept separate from the
  bucket classifier's `grey` so the two can be compared at the end.
- `confidence`: 0 to 1.
- `canonical_name`: the group's real name when the web turned up something different from the label, else null.

Every unit keeps `first_seen` / `last_seen`, so dormant groups can be filtered later rather than dropped now.
