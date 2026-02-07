# TEDx Asheville Matching System — V2 Plan

## Overview

A matchmaking system for TEDx Asheville attendees that creates personalized "top matches" lists based on rich profile data. Users provide context (resume, links, media preferences) and answer provocative personal questions. AI synthesizes this into profile summaries, which are then matched using embeddings + LLM scoring.

### Core Philosophy

- **Low friction, high signal**: Make it easy to provide rich context (drop links, paste stuff) rather than forcing long-form writing
- **Provocative > Generic**: Questions should surface personality, values, and weirdness—not job titles
- **Optional everything**: Nothing required, but more input = better matches
- **Fun, not homework**: Should feel like a personality quiz, not a job application

---

## User Flow

```
Landing Page (TEDx branded)
    ↓
Intro/Explainer Page (what this is, how it works, privacy)
    ↓
Consent Page (display name + agreement)
    ↓
Context Page (resume, links about you, links/media you love)
    ↓
Questions Page (10-15 collapsible questions, answer what resonates)
    ↓
Confirmation Page (summary, option to edit later)
    ↓
[Later] Results Page (your top matches revealed)
```

---

## Page-by-Page Specification

### Page 0: Landing Page

**URL**: `/tedx` (hidden, not linked publicly)

**Purpose**: Entry point, sets the vibe, prompts sign-in/sign-up

**Content**:

- TEDx Asheville branding
- Headline: "Find Your People at TEDx Asheville"
- Subhead: "Get matched with the attendees you'll actually want to meet"
- CTA: "Get Started" → triggers sign-in/sign-up flow

**Notes**:

- If already signed in, redirect to current step in flow
- Track that user came from TEDx landing page (for filtering later)

---

### Page 1: Intro/Explainer Page

**Purpose**: Explain the concept, build excitement, address privacy, set expectations

**Content**:

```
# How This Works

We're building something special for TEDx Asheville: a way to connect you 
with the attendees you'll actually click with.

## The Idea
You'll share a bit about yourself—your background, your interests, what 
makes you tick. Our AI reads everything and finds the people at TEDx who 
you'd have the best conversations with.

## What You'll Get
Before the event, you'll receive a personalized list of 5-10 people to meet, 
along with conversation starters for each one. No more awkward networking—
just genuine connections.

## Your Privacy
- Your specific answers are NOT shared with other attendees
- We only use your data to find great matches
- You control what you share (everything is optional)

## One Thing to Know
The more you share, the better your matches. But don't stress—even 5 minutes 
of input helps. Share what feels natural.

[Continue →]
```

**Design Notes**:

- Keep it scannable (headers, short paragraphs)
- Friendly, casual tone
- Could add a simple graphic showing: You → AI → Matches

---

### Page 2: Consent Page

**Purpose**: Capture display name, get explicit consent for data usage

**Fields**:


| Field        | Type       | Required | Notes                                       |
| -------------- | ------------ | ---------- | --------------------------------------------- |
| Display Name | Text input | Yes      | Pre-filled with email username if available |

**Consent Checkbox** (required):

> ☐ I understand my profile data will be analyzed by AI and used to match me with other TEDx Asheville attendees. My specific answers will not be shared directly—only used to find great matches.

**CTA**: "Continue →"

---

### Page 3: Context Page

**Purpose**: Collect passive/easy context—stuff they can drop in without much writing

**Header**:

```
# Share Some Context

Drop in links, upload your resume, share what you're into. 
Everything is optional—but the more context, the better your matches.
```

**Sections**:

#### Section 1: Resume (Optional)

```
Upload your resume or paste the text. We'll extract your background, 
skills, and experience automatically.

[Upload PDF] or [Paste Text]

Status: ✓ Parsed successfully / ⏳ Parsing... / [empty]
```

**Technical Notes**:

- PDF upload → Gemini parses to markdown
- Show progress indicator during parsing
- Display parsed preview (collapsible) so they can verify

#### Section 2: Links About You (Optional)

```
Share 1-3 links that help us understand who you are.

Examples: LinkedIn, personal website, portfolio, articles about you, 
talks you've given, interviews, project pages

[+ Add Link]
```

**UI**:

- Simple repeating URL input fields
- "Add another" button (max 5)
- We scrape/analyze these on the backend

#### Section 3: Links & Media You Love (Optional)

```
Share anything that represents your interests, values, or curiosities.

This could be: articles, blogs, podcasts, YouTube channels, books, movies, 
authors, researchers, organizations, music, art—anything you vibe with.

Don't worry about finding URLs—just drop titles, names, or descriptions 
and we'll do the research.

[+ Add Item]
```

**UI**:

- Flexible text input (not just URLs)
- Examples inline: "e.g., 'Tim Urban's blog Wait But Why' or 'The movie Arrival' or 'anything by Brené Brown'"
- Repeating fields, "Add another" button (max 10)

**CTA**: "Continue to Questions →"

**Progress Indicator**: Show "Step 2 of 3" or similar

---

### Page 4: Questions Page

**Purpose**: Collect personal, provocative, personality-revealing answers

**Header**:

```
# A Few Questions

Every question is optional. Only answer the ones that resonate with you.

The more you share, the better your matches—but don't feel overwhelmed. 
Even 2-3 thoughtful answers help a lot.
```

**UI Pattern**: Collapsible accordion sections

- Each question shows as a collapsed row with the question text
- Click to expand and reveal textarea
- Once answered (any text entered), show green checkmark ✓ next to question
- Show count: "4 of 10 answered" somewhere visible

**Questions** (in order):

---

#### Q1: What makes you weird?

```
Expanded state:
┌─────────────────────────────────────────────────────────────┐
│ What makes you weird?                                    ✓  │
├─────────────────────────────────────────────────────────────┤
│ The quirks, unusual interests, or unexpected things about   │
│ you that most people don't know.                            │
│                                                             │
│ [                                                         ] │
│ [                         textarea                        ] │
│ [                                                         ] │
└─────────────────────────────────────────────────────────────┘
```

---

#### Q2: What mess did you most recently embrace?

```
Subtext: A failure, a chaotic situation, an imperfect thing you 
leaned into instead of running from. (Ties to our theme: Embrace the Mess)
```

---

#### Q3: What mess are you NOT embracing?

```
Subtext: Something messy in your life or work that you're avoiding, 
resisting, or pretending doesn't exist.
```

---

#### Q4: What do you believe that most people here would disagree with?

```
Subtext: A contrarian take, unpopular opinion, or unconventional view 
you hold—about your industry, society, or life in general.
```

---

#### Q5: What can you not stop thinking about?

```
Subtext: An idea, question, project, or rabbit hole that keeps 
pulling you back. Could be professional or personal.
```

---

#### Q6: What do you know deeply and love sharing?

```
Subtext: Expertise, skills, or hard-won knowledge that you could 
teach others or talk about for hours.
```

---

#### Q7: Who are your people?

```
Subtext: Your tribe, community, or the types of people you feel 
most at home with. Could be a scene, a profession, a mindset, a subculture.
```

---

#### Q8: How would your closest friends describe you?

```
Subtext: Personality traits, archetypes, vibes. Feel free to mention 
Enneagram, Myers-Briggs, or any framework—or just describe yourself 
in your own words.
```

---

#### Q9: Your life in a bumper sticker

```
Subtext: A phrase, motto, or one-liner that captures your approach 
to life. Serious or funny, your call.
```

---

#### Q10: What else should we know about you?

```
Subtext: Anything we didn't ask that you want to share. Go wild.
```

---

**CTA**: "Submit Profile →"

**Validation**:

- 1 minimum answer required
- Show gentle nudge if 1 question answered: "Are you sure? Even one answer helps us find better matches."

---

### Page 5: Confirmation Page

**Purpose**: Confirm submission, set expectations for next steps

**Content**:

```
# You're All Set! 🎉

Your profile has been submitted. Here's what happens next:

1. Our AI will analyze your profile and find your best matches
2. Before TEDx Asheville, you'll receive your personalized match list
3. Each match includes conversation starters to break the ice

## Want to add more?
You can edit your profile anytime before [DEADLINE DATE].

[Edit My Profile]

## Questions?
Reach out to [contact info]
```

**Notes**:

- Show summary of what they submitted (collapsed/expandable)
- Clear "Edit" path back into the flow

---

### Page 6: Results Page (Future)

**Purpose**: Display their matches once generated

**Content** (sketch):

```
# Your Top Matches for TEDx Asheville

These are the people we think you'd have the best conversations with.

[Match 1: Name + Photo]
Why you'd click: [AI-generated reason]
Conversation starter: [AI-generated prompt]

[Match 2: Name + Photo]
...

(Repeat for 5-10 matches)
```

**Notes**:

- Design TBD
- May include "match strength" indicator
- Conversation starters should be specific to the pair

---

## Technical Requirements

### Database Schema Additions

**Profile Table Updates**:

```
- allow_editing: boolean (default true, manually flip to false at cutoff)
- submitted_at: timestamp
- event_id: foreign key (to scope profiles to TEDx vs other events)
```

**New Fields for Profile Data**:

```
- display_name: string
- resume_text: text (parsed markdown)
- resume_raw: blob (original PDF, optional)
- links_about_user: json array of URLs
- links_user_loves: json array of {type: 'url'|'text', value: string}
- question_responses: json object {q1: string, q2: string, ...}
- ai_summary_profile: text (generated)
- ai_summary_seeking: text (generated)
- ai_summary_offering: text (generated)
- profile_embedding: vector
- seeking_embedding: vector
- offering_embedding: vector
```

### AI Processing Pipeline

**Step 1: Generate Summaries (using Azure)**

For each submitted profile, generate three summaries:

**Profile Summary Prompt**:

```
Based on the following information about a TEDx attendee, write 2 paragraphs 
summarizing who they are. Include their background, expertise, current focus, 
values, personality, and personal interests. Capture what makes them distinctive 
and what they'd be interesting to talk about.

Resume:
{resume_text}

Links about them:
{links_about_user}

Things they love:
{links_user_loves}

Their answers:
- What makes you weird: {q1}
- What mess did you most recently embrace: {q2}
- What mess are you NOT embracing: {q3}
- Contrarian belief: {q4}
- Can't stop thinking about: {q5}
- What they know deeply: {q6}
- Their people/tribe: {q7}
- How friends describe them: {q8}
- Life in a bumper sticker: {q9}
- Anything else: {q10}
```

**Seeking Summary Prompt**:

```
Based on this person's profile, write 1 paragraph about what they might be 
looking for at TEDx—what they want to learn, who they'd want to meet, what 
kind of conversations would energize them.

[Include relevant fields]
```

**Offering Summary Prompt**:

```
Based on this person's profile, write 1 paragraph about what they could 
offer others—expertise they could share, perspectives they bring, how they 
might help or inspire other attendees.

[Include relevant fields]
```

**Step 2: Generate Embeddings (using Gemini)**

- Create embeddings for each of the three summaries
- Store in vector database or as arrays in postgres (pgvector)

**Step 3: Matching Algorithm**

See matching algorithm section below.

---

## Matching Algorithm

### Overview

1. **Embedding filter**: Find top 100 candidates per person using cosine similarity
2. **LLM batch scoring**: Score candidates in groups of 10
3. **Shortlist**: Take top 20 highest-scored
4. **LLM re-rank**: Final ranking of top 20 → select top 9
5. **Apply filters**: Bidirectional filter + capacity constraint

### Step 1: Embedding Similarity

```python
def get_top_candidates(person, all_profiles, n=100):
    scores = []
    for other in all_profiles:
        if other.id == person.id:
            continue
    
        # Weighted combination of three embeddings
        profile_sim = cosine_similarity(person.profile_embedding, other.profile_embedding)
    
        # Cross-match: what I offer vs what they seek
        offer_seek = cosine_similarity(person.offering_embedding, other.seeking_embedding)
        seek_offer = cosine_similarity(person.seeking_embedding, other.offering_embedding)
    
        combined = (0.6 * profile_sim) + (0.2 * offer_seek) + (0.2 * seek_offer)
        scores.append((other, combined))
  
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:n]
```

### Step 2: LLM Batch Scoring

Split 100 candidates into 10 batches of 10. For each batch:

```
You are matching attendees at TEDx Asheville for meaningful 1:1 conversations.

## Person We're Finding Matches For:
Name: {name}
Profile: {profile_summary}
What they might be seeking: {seeking_summary}
What they offer: {offering_summary}

## Candidates to Evaluate:

### Candidate 1: {name}
Profile: {profile_summary}
Seeking: {seeking_summary}
Offering: {offering_summary}

[Repeat for all 10]

---

For each candidate, provide a match score from 1-10:
- 9-10: Exceptional match—shared passions, clear mutual value, would definitely click
- 7-8: Strong match—good overlap, likely to have an engaging conversation
- 5-6: Decent match—some common ground, could be worthwhile
- 3-4: Weak match—limited overlap, conversation might feel forced
- 1-2: Poor match—little in common, unlikely to connect meaningfully

Respond in this exact format:
1. {Name}: {Score}/10 — {One sentence reason}
2. {Name}: {Score}/10 — {One sentence reason}
...
```

### Step 3: Shortlist Top 20

Collect all 100 scores across batches, take the top 20.

### Step 4: LLM Re-Rank (using Azure)

```
You are matching attendees at TEDx Asheville for meaningful 1:1 conversations.

## Person We're Finding Matches For:
Name: {name}
Profile: {profile_summary}
Seeking: {seeking_summary}
Offering: {offering_summary}

## Top 20 Candidates to Rank (currently unordered):

[Include all 20 candidates with their summaries]

---

Rank these 20 candidates from best match (#1) to weakest match (#20).

Consider:
- Shared interests, values, and worldview
- Mutual value exchange (can they help each other?)
- Conversation chemistry (would they enjoy talking?)
- Serendipity (unexpected but interesting connection?)

Respond with a numbered list:
1. {Name} — {One sentence reason they're the best match}
2. {Name} — {One sentence reason}
...
```

### Step 5: Apply Filters

**Bidirectional Filter**:

- Person B only appears in Person A's final list if A is in B's top 50 (before filtering)
- This ensures mutual relevance

**Capacity Constraint**:

- No person can appear in more than 15 final match lists
- When someone exceeds cap, keep them in lists where they ranked highest
- Bump them from lists where they were lower-ranked

### Final Output

Each person receives:

- Top 5-9 matches (depending on how many pass filters)
- For each match: name, photo, AI-generated "why you'd click" reason
- Conversation starter prompt specific to the pair

---

## LLM Call Estimates

For 500 attendees:


| Step                       | Calls per Person | Total Calls |
| ---------------------------- | ------------------ | ------------- |
| Generate 3 summaries       | 3                | 1,500       |
| Batch scoring (10 batches) | 10               | 5,000       |
| Re-rank top 20             | 1                | 500         |
| Generate match reasons     | ~9               | 4,500       |
| **Total**                  |                  | **~11,500** |

Estimated cost: $100-200 (depending on model and prompt length)

---

## Content to Write

### For Intro Page

- [X] Draft included above

### For Question Subtext

- [X] Included above

### For Emails

- [ ] Invitation email (to ticket holders)
- [ ] Reminder email (for those who haven't completed)
- [ ] Results email (when matches are ready)

### For On-Site

- [ ] QR code signage
- [ ] Program blurb explaining the feature

---

## Open Items / Future Considerations

### Deferred to Later

- Party matching (separate event, different questions)
- AVL Go integration (hearted events as signal)
- Profile reuse across events
- Automated deadline enforcement (currently manual boolean flip)

### To Decide Before Launch

- Exact deadline date/time for profile edits
- Whether to do a "halftime" regeneration for day-of submissions
- How to display matches (in-app? email? both?)
- Whether to show match "strength" indicator

### Nice-to-Haves for V2.5

- Conversation starter generation for each match pair
- "Request to meet" button that notifies the other person
- Post-event feedback ("Did you meet? How'd it go?")
- Match type labels (kindred spirit, complementary, wildcard)

---

## Timeline


| Task                                             | Owner        | Status |
| -------------------------------------------------- | -------------- | -------- |
| Update UI to two-page flow (Context + Questions) | Matt         | To Do  |
| Implement collapsible question accordion         | Matt         | To Do  |
| Add intro/explainer page                         | Matt         | To Do  |
| Write final question subtext                     | Matt         | To Do  |
| Push to hidden URL for Brett testing             | Matt         | To Do  |
| Both submit real test profiles                   | Matt + Brett | To Do  |
| Review AI summary quality                        | Matt + Brett | To Do  |
| Build matching algorithm pipeline                | Matt         | To Do  |
| Test matching with sample data                   | Matt         | To Do  |
| Soft launch to TEDx team                         | Matt         | To Do  |
| Announce to ticket holders                       | Brett/TEDx   | To Do  |

---

## Appendix: Question Bank (Alternates)

If we want to swap any questions or offer more variety:

- What's the most important thing you've changed your mind about?
- What would you do if you couldn't fail?
- What's a question you're sitting with right now?
- What's something you're irrationally passionate about?
- What's a skill you have that surprises people?
- What's the best advice you've ever ignored?
- What's something you're proud of that you rarely get to talk about?
- If you could have dinner with anyone (living or dead), who and why?
- What does "embrace the mess" mean to you?
- What are you building (literally or metaphorically)?
