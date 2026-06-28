# Passage by StaGove

**An autonomous immigration pathway & case‑manager agent.**
A static Progressive Web App that helps a person understand which visa, permit, residency, or citizenship routes may realistically apply to their situation — then manages that situation as a persistent **case file**, not a one‑off chat.

> ⚠️ **This is not legal advice.** Immigration rules change frequently. Always verify with the official government source or a licensed immigration professional. Passage is a triage, planning, and organization tool. It does **not** replace official government guidance or legal counsel.

---

## What Passage does

You enter your profile **once** — citizenship, residence, target country, goal, education, work, finances, immigration history, **family & ancestry** (parents'/grandparents' citizenships), and any **sponsor/relationship** in the target country. Passage then runs an autonomous loop:

1. **Intake** – builds a personal immigration case file.
2. **Detect** – detects which pathway *families* exist for the target country (visitor, student, work/skilled, family, spouse, ancestry/descent, EU free movement, digital nomad, investor, PR, citizenship, humanitarian).
3. **Filter** – rejects dead‑end routes (e.g. *an uncle is usually not a direct qualifying family sponsor*).
4. **Rank** – scores realistic pathways 0–100 with reasons for and against.
5. **Ground** – asks you to paste the **official government source text**, then builds the checklist **only** from that text.
6. **Plan** – produces a document checklist, risk report, and timeline.
7. **Track** – saves the case locally, with a 10‑stage progress tracker and an always‑visible **Next Best Action**.
8. **Adapt** – re‑evaluates completeness, risk, and the next step every time you update the case.

You can keep **multiple cases**, export/import them as JSON, and continue later exactly where you left off.

---

## Why it is autonomous (not a chatbot)

A chatbot answers a question and forgets it. Passage:

- collects a **structured profile** and builds a **persistent case file**;
- **decides** which pathway families to pursue and which to reject, with logged reasons;
- **ranks** routes with a deterministic scoring engine, then refines the reasoning with an LLM;
- **identifies missing information** and asks targeted follow‑ups;
- **grounds** every checklist in official source text instead of inventing rules;
- **tracks** progress across sessions and always tells you the single next best action;
- keeps a **decision log** of its own reasoning.

It runs a real **plan → decide → execute → evaluate → adapt** loop over a stored case, so it is hard to replace with a single ChatGPT message.

### The autonomous case-management layer

Beyond the initial scan, Passage performs continuous case-management work — all of it deterministic, so it runs instantly, offline, and even without a Groq key:

1. **Official Source Finder.** When you focus a route, the agent shows the recommended official search query, the trusted government domains for that country, a warning about unofficial sources, and one-tap official search links. A four-step status — *Not searched → Search opened → Source text pasted → Checklist grounded* — tracks where you are. The agent guides you to the right official page instead of waiting passively.
2. **Routes the agent rejected.** A dedicated section shows what the agent decided *not* to pursue, why, whether each route is impossible or merely weak, what would make it viable, and its decision (ignore / revisit later). This surfaces real decision-making, not just a list of options.
3. **Document readiness score.** Separate from overall completion. Bands: *Not ready (0–25) · Early preparation (26–50) · Partially ready (51–75) · Nearly ready (76–90) · Application-ready (91–100)*. Shows missing critical documents, the next document to collect, and the risk from gaps.
4. **Missing-information detector.** After every scan it lists what it still needs (sponsor status, relationship proof, job offer, admission, funds, ancestry documents, refusal details, official source, timeline) — each with why it matters, the pathway it affects, a priority, and a recommended action.
5. **Autonomous case review.** A **Run case review** button re-evaluates the whole case and reports the best and second-best route, rejected routes, the biggest blocker, the most urgent document, readiness, risk, confidence, the next best action, and what changed. If nothing changed, it says so.
6. **"What changed?" detection.** The agent snapshots the case and diffs it on review, producing plain lines like *"Job offer changed from No to Yes," "Work route score moved from 32 to 74," "Strongest route changed."*
7. **Proof of autonomy.** A section generated from real runtime state (not marketing copy) listing exactly what the agent did: case built, N pathway families scanned, M routes rejected, route focused, official source required before any checklist, grounded checklist built from pasted text only, documents tracked, missing info identified, decisions logged.
8. **Source-grounding quality score (0–100).** When you paste official text, a deterministic meter checks whether it looks official, contains eligibility rules, lists documents, describes applicant actions, mentions fees/deadlines/forms, is long enough, and is relevant — then tells you how to strengthen a thin source. It never invents the missing parts.
9. **Explained next best action.** Every next action now carries its reason, urgency, expected outcome, and what happens after you complete it.
10. **Decision audit panel.** A plain-language summary above the raw log: what the agent decided, why, which alternatives it rejected, what information is missing, its confidence, and the next action.

### Why not just ChatGPT?

ChatGPT can answer an immigration question, but **you** have to know what to ask, and you manage everything yourself — there is no case, no memory, no tracking. Passage is the case manager around the model:

- it keeps a **persistent case file** and continues from where you stopped;
- it **decides and rejects** routes structurally, and shows its reasoning;
- it **refuses to invent** current fees, forms, quotas, or thresholds, grounding checklists only in official text you paste;
- it **tracks documents and readiness**, detects **missing information**, and **re-evaluates** the case when anything changes;
- it maintains a **decision log and audit**, and always shows one explained **next best action**.

The model is one component inside an autonomous loop — not the whole product.

### Two‑layer anti‑hallucination design

- **Layer 1 — Structural reasoning (the model is good at this).** Whether a relationship is likely to qualify, whether a route needs an employer or admission, whether ancestry might matter. Used for triage.
- **Layer 2 — Current specific rules (the model must NOT invent this).** Fees, exact forms, quotas, processing times, income thresholds. These come **only** from official text you paste. If something is not in that text, Passage says **"Not found in pasted source text."** It never fabricates fees, forms, quotas, or thresholds.

---

## Tech & cost

- **Frontend:** plain HTML/CSS/JS — no build step, no npm, no React.
- **AI:** Groq, called through a Netlify Function proxy so the API key stays server‑side.
- **Storage:** `localStorage` in your browser. No database, no login, no accounts, no OAuth.
- **Cost:** **zero recurring cost** — Netlify free tier + a free Groq API key. No paid APIs.

---

## Deploy to Netlify (≈5 minutes)

1. **Create a free Groq API key** at <https://console.groq.com/keys>.
2. **Put these files in a GitHub repository**, keeping the folder structure exactly:

   ```text
   index.html
   styles.css
   app.js
   manifest.json
   service-worker.js
   netlify.toml
   README.md
   data/
     pathway-rules.js
   netlify/
     functions/
       groq.js
   icons/
     favicon.svg
     apple-touch-icon.png
     icon-192.png
     icon-512.png
     icon-maskable-512.png
   ```

3. **Connect the repo to Netlify** → *Add new site → Import an existing project* → pick the repo.
   Build settings are already in `netlify.toml` (publish directory `.`, functions directory `netlify/functions`, no build command).
4. **Add the Groq key as an environment variable** in Netlify → *Site settings → Environment variables*:

   ```text
   Key:   GROQ_API_KEY
   Value: <your Groq key from step 1>
   ```

5. **Deploy.** Open the site, click **Sample cases** to try the four demos, then create your own case.
6. **Install as an app (PWA):** in the browser, use *Install* / *Add to Home Screen*.

> Note: with this setup the Groq key is the **developer's** key on the server, so **one key serves all users**. That keeps it free for end users but means heavy traffic shares one free‑tier rate limit. For a personal/family deployment this is fine.

---

## Local case storage, export & import

- Every case is stored **only in this browser**, under the `localStorage` keys `passage.cases`, `passage.activeCaseId`, and `passage.settings`.
- Clearing your browser storage will delete your cases.
- Use **Export case file** to download a case as JSON (e.g. `passage-case-stefan-usa.json`) for backup or to move it to another device.
- Use **Import** to load a previously exported case.

---

## Sample cases included

- **Stefan — Bulgaria → USA (uncle in the US):** shows why an uncle is usually *not* a direct family sponsor, and points to study/work routes instead.
- **Maria — Bulgaria → Italy (Italian grandparent):** flags citizenship by descent (*jure sanguinis*) and, since she is an EU citizen, also free movement.
- **Ivan — Serbia → Germany (job offer):** strong work / EU Blue Card style route for a non‑EU national.
- **Lena — Bulgaria → Canada (study):** strong study route, grounded in pasted official text.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell (single page). |
| `styles.css` | "Passport dossier" styling. |
| `app.js` | Agent loop, deterministic scoring, views, storage, export/import. |
| `data/pathway-rules.js` | Lightweight structural map of pathway families + official source domains per country (triage only — **not** a legal database). |
| `netlify/functions/groq.js` | Server‑side proxy that hides `GROQ_API_KEY` and forwards requests to Groq. |
| `manifest.json`, `service-worker.js`, `icons/` | PWA installability and offline app shell. |
| `netlify.toml` | Netlify build, functions directory, and `/api/groq` redirect. |

---

## StaGove Delivery Directory entry

**Name:** Passage by StaGove

**Utility:** Autonomous immigration pathway and case-management agent that helps users identify realistic visa, residency, family, work, study, ancestry, citizenship, and settlement routes, reject weak paths, ground document checklists in official sources, and track a persistent case file until application readiness.

**Access:** PWA deployed on Netlify. Installable on phone and desktop. Case data stored locally in browser with export/import.

**Agentic nature:** Passage builds a persistent immigration case, scans all pathway families, rejects dead-end routes, ranks viable routes, detects missing information, requires official source grounding, generates checklists only from pasted official text, tracks document readiness, updates the next best action, and re-evaluates the case when information changes.

**Why not ChatGPT:** ChatGPT can answer immigration questions, but the user must know what to ask and must manage the case manually. Passage creates a stored case file, runs a structured pathway scan, rejects weak routes, tracks evidence, grounds checklists in official sources, maintains a decision log, and continuously updates the next best action.

**No recurring cost:** Netlify free hosting, localStorage, static PWA, and server-side Groq proxy using a free Groq key. For heavier usage, optional user-provided Groq key mode may be added later.

**Safety:** Not legal advice. All current rules must be verified from official government sources or a licensed immigration professional.

---

## Privacy

No account is created. Your data stays in your browser unless you export it. When you run the agent or generate a grounded checklist, the relevant text you submit is sent to Groq for analysis. Avoid entering extremely sensitive details unless necessary, and export your case if you want a backup. Passage does not overpromise privacy — it is honest about where your data goes.
