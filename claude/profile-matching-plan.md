

# TEDxAsheville Attendee Matching Flow

## **Survey (2 parts)**

## **Passive Inputs**

These are things attendees provide that we feed to AI for analysis—they don't have to write anything, just upload or paste links.

**Resume Upload** (optional)

* Gives us their career history, skills, education, accomplishments  
* AI extracts key themes about their expertise and trajectory

**LinkedIn URL** (optional)

* We scrape their headline, about section, experience, and recent posts  
* Gives us professional context and how they describe themselves publicly

**Links About You** (1-3 links)

* Personal website, twitter account, blog, anything online that would give us more information about them  
* Helps us understand how they show up in the world and what they're known for

**Links About Topics You Care About** (1-3 links)

* Articles, research papers, organizations, blogs, podcasts—anything that represents their interests  
* Doesn't have to be about them; it's about what they find important or fascinating  
* Reveals values, curiosities, and intellectual interests that might not show up on a resume

---

### **Questions (10)**

**1\. What do you do?**

"One or two sentences—how would you describe your work to a curious stranger?"

**2\. What are you working on right now?**

"What project, problem, or idea is consuming most of your energy these days—professionally or personally?"

**3\. What do you know deeply?**

"What expertise, skill, or experience do you have that others often ask you about or that you could teach?"

**4\. What's an idea you think more people should hear?**

"A belief, insight, or perspective you hold—about your field, the world, or life in general"

**5\. What do you believe that most people here might disagree with?**

"A contrarian take, unpopular opinion, or unconventional view you hold"

**6\. What are you obsessed with outside of work?**

"Hobbies, interests, rabbit holes, side projects—what fills your time and mind when you're not working?"

**7\. What's something surprising about you?**

"Something that wouldn't be obvious from your LinkedIn—a hidden interest, unexpected background, or unusual skill"

**8\. What are you trying to learn or figure out?**

"What questions are you wrestling with? What skills are you developing? What do you wish you understood better?"

**9\. What kind of help or connections are you looking for?**

"Introductions, advice, collaborators, feedback, perspectives—what would be most valuable to you right now?"

**10\. What could you offer someone at this event?**

"What value can you bring—expertise, introductions, mentorship, a sounding board, a specific skill, a unique perspective?"

---

## **Embeddings Architecture**

### **Embedding 1: Profile (Who They Are)**

**Feeds from:**

* Resume/LinkedIn (AI-scraped)  
* Links about them  
* Links about topics they care about  
* Q1: What do you do?  
* Q2: What are you working on?  
* Q3: What do you know deeply?  
* Q4: Idea worth spreading  
* Q5: Contrarian view  
* Q6: Obsessions outside work  
* Q7: Surprising thing about you

**AI Summary Prompt:**

"Write 2 paragraphs summarizing who this person is. Include their background, expertise, current focus, values, worldview, personality, and personal interests. Write in a way that captures what makes them distinctive and what they'd be interesting to talk about."

---

### **Embedding 2: Seeking (What They Want)**

**Feeds from:**

* Q8: What are you trying to learn/figure out?  
* Q9: What help or connections are you looking for?

**AI Summary Prompt:**

"Write 1 paragraph summarizing what this person is looking for. What do they want to learn? What kind of help do they need? What type of person or expertise would be valuable to them?"

---

### **Embedding 3: Offering (What They Give)**

**Feeds from:**

* Q3: What do you know deeply?  
* Q10: What could you offer?

**AI Summary Prompt:**

"Write 1 paragraph summarizing what this person can offer others. What expertise can they share? What help can they provide? What unique value do they bring to a conversation or connection?"

---

## **How the matching will work**

**Step 1: AI creates three summaries for each person**

* **Profile Summary**: Who they are—background, expertise, current work, values, personality, interests (drawn from resume, LinkedIn, all links, and questions 1-7)  
* **Seeking Summary**: What they want—what they're trying to learn, what help they need, what kind of people would be valuable to them (drawn from questions 8-9)  
* **Offering Summary**: What they give—what expertise they can share, what help they can provide, what unique value they bring (drawn from questions 3 and 10\)

**Step 2: Create embeddings from each summary**

* Each summary becomes a numerical vector (embedding) that captures its meaning  
* Similar summaries will have similar vectors

**Step 3: Calculate match scores between every pair of attendees**

* **70% weight**: How similar are their overall profiles? (Do they have shared interests, backgrounds, worldviews?)  
* **15% weight**: Can Person A help Person B? (Does what A is offering match what B is seeking?)  
* **15% weight**: Can Person B help Person A? (Does what B is offering match what A is seeking?)

**Step 4: Apply bidirectional filter**

* Person B only shows up in Person A's recommendations if the interest is semi-mutual  
* For example: B must be in A's top 50 matches for A to be in B's top 10 matches  
* This prevents one-sided matches

**Step 5: Apply capacity constraint**

* No single person can appear in more than 15 people's final recommendation lists  
* When someone hits the cap, they remain in the lists where they ranked highest (where they're most wanted) and get bumped from lists where they were a weaker match  
* This prevents popular people from dominating everyone's lists and ensures matches are distributed more evenly

**Step 6: Deliver final lists**

* Each attendee sees their top 5-10 matches  
* We use AI to write 1 enticing sentence on why they matched (to inspire them to meet and as a conversation starter)

