/* ============================================================================
   Passage by StaGove — autonomous immigration pathway & case-manager agent.
   Plain script (no build, no modules). Reads window.PATHWAY_RULES from
   data/pathway-rules.js and talks to the Groq proxy at /api/groq.
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------------------- consts */
  var RULES = window.PATHWAY_RULES || {};
  var GENERIC = window.GENERIC_PATHWAYS || {};
  var COUNTRIES = (window.COUNTRY_LIST || Object.keys(RULES));
  var DISCLAIMER = "This is not legal advice. Immigration rules change frequently. Always verify with the official government source or a licensed immigration professional.";

  var MODELS = { balanced: "llama-3.3-70b-versatile", fast: "llama-3.1-8b-instant", deep: "openai/gpt-oss-120b" };

  var EU_EEA = ["Austria","Belgium","Bulgaria","Croatia","Cyprus","Czechia","Czech Republic","Denmark","Estonia","Finland","France","Germany","Greece","Hungary","Iceland","Ireland","Italy","Latvia","Liechtenstein","Lithuania","Luxembourg","Malta","Netherlands","Norway","Poland","Portugal","Romania","Slovakia","Slovenia","Spain","Sweden"];

  var ISO3 = { "United States":"USA","Canada":"CAN","United Kingdom":"GBR","Germany":"DEU","Bulgaria":"BGR","Australia":"AUS","Ireland":"IRL","Italy":"ITA","Spain":"ESP","France":"FRA" };

  var GOALS = {
    visit: "Tourism / visit", study: "Study", work: "Work", family: "Join family",
    pr: "Permanent residency", citizenship: "Citizenship", citizenship_descent: "Citizenship by descent",
    digital_nomad: "Digital nomad / remote work", investment: "Investment / business",
    humanitarian: "Humanitarian / protection", unsure: "Not sure yet"
  };
  var TIMELINES = { urgent: "Urgent", m3: "Within 3 months", m6: "Within 6 months", y1: "Within a year", norush: "No rush" };

  var REL_OPTIONS = [
    ["spouse","Spouse"],["partner","Fiancé / partner"],["parent","Parent"],["child","Child"],
    ["sibling","Sibling"],["grandparent","Grandparent"],["uncle_aunt","Uncle / aunt"],["cousin","Cousin"],
    ["friend","Friend"],["employer","Employer"],["university","University"],["business","Business partner"],["other","Other"]
  ];
  var REL_STRENGTH = {
    spouse:"strong", parent:"strong", child:"strong",
    partner:"possible", sibling:"possible", grandparent:"possible",
    uncle_aunt:"weak", cousin:"weak", friend:"weak",
    employer:"work", university:"study", business:"work", other:"unknown", "":"none"
  };

  /* The 10-stage case journey (spec §8). */
  var STAGES = [
    ["Profile completed","Your situation is on file"],
    ["Pathways scanned","Routes detected and ranked"],
    ["Best path selected","Focus chosen for this case"],
    ["Official source verified","Real rules pasted from the government site"],
    ["Documents identified","Grounded checklist built"],
    ["Documents collected","Papers gathered and marked"],
    ["Application prepared","Package assembled"],
    ["Application submitted","Filed with the authority"],
    ["Waiting for decision","Under review"],
    ["Decision received","Approved or refused"]
  ];

  var POLICY_CAP = 14000;

  /* ----------------------------------------------------------------- state */
  var state = {
    route: "dashboard",
    activeId: null,
    model: (load("passage.settings") || {}).model || MODELS.balanced,
    busy: false
  };

  /* -------------------------------------------------------------- storage */
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function getCases() { return load("passage.cases") || {}; }
  function putCases(obj) { save("passage.cases", obj); }
  function getCase(id) { return getCases()[id] || null; }
  function saveCase(c) { c.updatedAt = new Date().toISOString(); var all = getCases(); all[c.id] = c; putCases(all); }
  function deleteCase(id) { var all = getCases(); delete all[id]; putCases(all); if (state.activeId === id) state.activeId = null; }
  function setSettings(p) { var s = load("passage.settings") || {}; Object.assign(s, p); save("passage.settings", s); }

  /* ----------------------------------------------------------------- utils */
  function $(s, r) { return (r || document).querySelector(s); }
  function uid() { return "case_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function nf(s) { return String(s || "").trim().toLowerCase(); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (_) { return ""; } }
  function iso3(country) { return ISO3[country] || nf(country).slice(0, 3).toUpperCase() || "—"; }
  function list(arr) { return Array.isArray(arr) ? arr.filter(Boolean) : (arr ? [arr] : []); }
  function splitList(s) { return nf(s) ? String(s).split(",").map(function (x) { return x.trim(); }).filter(Boolean) : []; }

  var toastT;
  function toast(msg) {
    var t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function getPath(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, path, val) {
    var keys = path.split("."), cur = o;
    for (var i = 0; i < keys.length - 1; i++) { if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") cur[keys[i]] = {}; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = val;
  }

  function matchesCountry(str, country) {
    var s = nf(str); if (!s || !country) return false;
    var c = nf(country);
    if (s.indexOf(c) >= 0 || c.indexOf(s) >= 0) return true;
    var stem = { "united states": "americ", "united kingdom": "brit", "germany": "german", "italy": "ital", "ireland": "irish", "spain": "spani", "france": "french", "bulgaria": "bulgar", "canada": "canad", "australia": "austral" }[c];
    return stem ? s.indexOf(stem) >= 0 : false;
  }
  function isEU(country) { return EU_EEA.some(function (x) { return nf(x) === nf(country); }); }

  /* -------------------------------------------------------- case factory */
  function newCase(seed) {
    var c = {
      id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      caseName: "",
      applicant: {
        name: "", age: "", dob: "", residenceCountry: "", city: "", citizenships: "",
        passportValid: "", maritalStatus: "", dependents: "", statusInResidence: "",
        education: "", fieldOfStudy: "", occupation: "", experienceYears: "",
        hasJobOffer: "", employerInTarget: "", professionRegulated: "", languages: "",
        hasAdmission: "", savings: "", canShowFunds: "", hasAccommodation: "",
        priorRefusals: "", overstays: "", priorDeportation: "", criminalRecord: "", travelledBefore: ""
      },
      target: { country: "", goal: "", timeline: "" },
      family: {
        mother: { citizenship: "", countryOfBirth: "", hadTargetCitizenship: "", docs: "" },
        father: { citizenship: "", countryOfBirth: "", hadTargetCitizenship: "", docs: "" },
        gpMaternal: { citizenship: "", countryOfBirth: "", docs: "" },
        gpPaternal: { citizenship: "", countryOfBirth: "", docs: "" },
        ancestryNotes: ""
      },
      sponsor: { hasSponsor: "", relationship: "", status: "", canProvideDocuments: "", canFinanciallySupport: "", willingToSponsor: "", relationshipProof: "" },
      pathwayScan: [], recommendedPathways: [], scanSummary: "", lastScanAt: "",
      officialPathwayKey: "", officialPathwayLabel: "", officialSourceText: "", groundedChecklist: null,
      documents: [], risks: [], notes: "",
      progress: { stageIndex: 0, completion: 0 },
      nextBestAction: "Complete the applicant profile, then run the pathway scan.",
      decisionLog: []
    };
    if (seed) deepMerge(c, seed);
    return c;
  }
  function deepMerge(t, s) { Object.keys(s).forEach(function (k) { if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) { t[k] = t[k] || {}; deepMerge(t[k], s[k]); } else { t[k] = s[k]; } }); return t; }

  function logDecision(c, category, decision, reason, opts) {
    opts = opts || {};
    c.decisionLog.unshift({
      ts: new Date().toISOString(), category: category, decision: decision, reason: reason || "",
      confidence: opts.confidence || "", pathway: opts.pathway || "", next: opts.next || ""
    });
    if (c.decisionLog.length > 60) c.decisionLog.length = 60;
  }

  /* =======================================================================
     DETERMINISTIC PATHWAY ENGINE  (Layer 1 — structural reasoning, no facts)
     ===================================================================== */
  function countryRules(country) {
    if (RULES[country]) return RULES[country];
    return { officialDomains: [], notes: "", cautionNotes: "Verify every detail with the official government source for this country.", pathways: GENERIC };
  }

  function kindOf(key) {
    if (key === "blue_card") return "work";
    if (key === "eu_free") return "eu";
    if (key === "digital_nomad") return "nomad";
    return key;
  }

  function relStrength(rel) { return REL_STRENGTH[rel] || "none"; }

  function yes(v) { return nf(v) === "yes" || v === true; }
  function no(v) { return nf(v) === "no" || v === false; }

  /* per-pathway score with for/against/missing reasons */
  function scorePathway(kind, c) {
    var a = c.applicant, t = c.target, sp = c.sponsor, fam = c.family;
    var score = 0, forR = [], against = [], missing = [];
    var goal = t.goal;

    function add(n, r) { score += n; if (r) forR.push(r); }
    function sub(n, r) { score -= n; if (r) against.push(r); }
    function need(x) { missing.push(x); }

    if (kind === "visitor") {
      if (goal === "visit" || goal === "unsure" || goal === "") add(30, "A short visit is a natural fit for a visitor route.");
      if (yes(a.canShowFunds) || yes(a.savings)) add(20, "You indicated you can show funds for the trip.");
      if (a.occupation && a.residenceCountry && no(a.dependents) === false) add(20, "Ongoing ties to your home country (job, home, family) usually support a visit.");
      else need("Evidence of ties to your home country (employment, property, family).");
      if (yes(a.priorRefusals)) sub(20, "A previous refusal can weigh against a visitor application.");
      if (yes(a.overstays)) sub(35, "A previous overstay is a significant negative for visitor routes.");
      if (goal === "work" || goal === "study" || goal === "pr") against.push("A visitor route does not normally authorise work, study, or settlement.");
    }

    else if (kind === "student") {
      if (yes(a.hasAdmission)) add(45, "You have (or expect) an admission offer — central to a study route."); else { sub(25, "No admission offer yet; study routes usually require one."); need("An acceptance/admission letter from an approved institution."); }
      if (yes(a.canShowFunds) || yes(a.savings)) add(25, "You can show funds, which study routes usually require."); else { sub(25, "Proof of funds is usually required for study routes."); need("Proof of funds / financial means."); }
      if (goal === "study") add(15, "Your stated goal is study.");
      if (a.education) add(5, "");
    }

    else if (kind === "work") {
      if (yes(a.hasJobOffer)) add(45, "You have a job offer — central to most work routes."); else { sub(30, "No job offer yet; most work routes need one."); need("A job offer from an employer in the destination."); }
      if (yes(a.employerInTarget)) add(30, "Your employer is in the destination country.");
      if (Number(a.experienceYears) >= 2) add(15, "Relevant work experience helps.");
      if (nf(a.professionRegulated) === "unknown" || a.professionRegulated === "") sub(10, "It is unclear whether your profession is regulated; this can add steps.");
      if (yes(a.professionRegulated)) need("Recognition/licensing for your regulated profession.");
    }

    else if (kind === "skilled") {
      if (/master|phd|doctor|bachelor|degree|tertiary|university/i.test(a.education || "")) add(20, "Higher education strengthens a points-based route.");
      var age = Number(a.age);
      if (age && age <= 35) add(15, "Your age band is favourable for points-based migration.");
      else if (age && age <= 45) add(5, "");
      else if (age > 45) sub(10, "Older age bands usually score lower on points tests.");
      if (Number(a.experienceYears) >= 3) add(15, "Several years of skilled experience help your points.");
      if (splitList(a.languages).length) add(10, "Declared language ability supports points-based routes."); else need("Recognised language test results.");
      if (yes(a.hasJobOffer)) add(10, "A job offer can add points or open employer streams.");
      if (goal === "work" || goal === "pr") add(8, "");
    }

    else if (kind === "family" || kind === "spouse") {
      var rel = sp.relationship, strength = relStrength(rel), sponsored = yes(sp.hasSponsor);
      if (!sponsored) { sub(20, "No sponsor indicated for a family route."); need("A qualifying family member in the destination who can sponsor you."); }
      if (kind === "spouse") {
        if (rel === "spouse" || rel === "partner") add(40, "A spouse/partner relationship is usually a recognised close-family route.");
        else { sub(30, "This route is specifically for a spouse or partner."); }
      } else {
        if (strength === "strong") add(40, "A close relationship (spouse, parent, child) is usually a qualifying family category.");
        else if (strength === "possible") add(8, "This relationship (e.g. sibling, grandparent, partner) may qualify in some systems, often with limits.");
        else if (strength === "weak") { sub(35, "An uncle, aunt, cousin or friend is usually NOT a direct qualifying family-sponsorship relationship."); need("A closer qualifying relative, or switch to a work/study/other route."); }
      }
      if (yes(sp.status === "citizen" || sp.status === "permanent_resident" || sp.status === "green_card") || ["citizen", "permanent_resident", "green_card"].indexOf(sp.status) >= 0) add(25, "Your sponsor's status (citizen/permanent resident) supports a family petition.");
      else if (sp.status) { /* temporary */ sub(10, "A sponsor on a temporary status may not be able to petition."); }
      else { sub(20, "Your sponsor's status is unknown."); need("Confirmation of the sponsor's immigration status."); }
      if (yes(sp.relationshipProof)) add(15, "You can provide relationship evidence."); else need("Proof of the family relationship.");
      if (yes(sp.canFinanciallySupport)) add(10, "Your sponsor can provide financial support.");
    }

    else if (kind === "ancestry") {
      var tc = t.country, hit = 0;
      [fam.mother, fam.father].forEach(function (p) {
        if (!p) return;
        if (yes(p.hadTargetCitizenship) || matchesCountry(p.citizenship, tc) || matchesCountry(p.countryOfBirth, tc)) { add(45, "A parent connected to the destination (citizenship/birth) is a strong basis for a descent route."); hit++; }
      });
      [fam.gpMaternal, fam.gpPaternal].forEach(function (g) {
        if (!g) return;
        if (matchesCountry(g.citizenship, tc) || matchesCountry(g.countryOfBirth, tc)) { add(25, "A grandparent connected to the destination can support a citizenship-by-descent route."); hit++; }
      });
      if (matchesCountry(fam.ancestryNotes, tc)) add(10, "Your ancestry notes mention a relevant connection.");
      if (!hit && !matchesCountry(fam.ancestryNotes, tc)) { sub(15, "No clear ancestral link to the destination was found in the family section."); need("Details of any ancestor with citizenship of, or birth in, the destination."); }
      var docs = [fam.mother && fam.mother.docs, fam.father && fam.father.docs, fam.gpMaternal && fam.gpMaternal.docs, fam.gpPaternal && fam.gpPaternal.docs].some(function (d) { return yes(d) || (d && nf(d) !== "no" && nf(d) !== "unknown" && d.length > 2); });
      if (hit) { if (docs) add(20, "You indicated some ancestry documents are available."); else { sub(10, "Descent routes need an unbroken documentary chain."); need("Birth/marriage certificates linking each generation to the ancestor."); } }
    }

    else if (kind === "eu") {
      var euCit = splitList(a.citizenships).some(function (cz) { return EU_EEA.some(function (e) { return matchesCountry(cz, e); }); });
      if (euCit && isEU(t.country)) add(95, "You appear to hold an EU/EEA citizenship and the destination is in the EU/EEA — free movement usually applies (registration rather than a visa).");
      else if (isEU(t.country)) { sub(20, "Free movement applies to EU/EEA citizens; you did not indicate an EU/EEA citizenship."); need("An EU/EEA citizenship, or use another route."); }
      else sub(60, "The destination is not in the EU/EEA, so free movement does not apply.");
    }

    else if (kind === "nomad") {
      if (goal === "digital_nomad") add(35, "Your goal matches a remote-work / digital-nomad route.");
      if (yes(a.canShowFunds) || yes(a.savings)) add(25, "Remote-work routes usually require a stable income or funds."); else need("Proof of remote income / financial means.");
      if (a.occupation) add(15, "A remote-friendly occupation supports this route.");
      if (!isEU(t.country) && goal !== "digital_nomad") sub(10, "");
    }

    else if (kind === "investor") {
      if (goal === "investment") add(35, "Your goal matches an investor/business route.");
      if (yes(a.savings)) add(25, "Investor routes require capital; you indicated savings."); else { sub(20, "Investor routes require substantial capital."); need("Evidence of qualifying capital to invest."); }
    }

    else if (kind === "pr" || kind === "citizenship") {
      add(20, "");
      if (goal === "pr" || goal === "citizenship" || goal === "citizenship_descent") add(15, "This matches your settlement goal.");
      against.push("This is usually reached AFTER a qualifying period on an entry route, not applied for directly.");
      need("First secure and hold a qualifying entry route, then verify the settlement timeline officially.");
    }

    score = clamp(Math.round(score), 0, 100);
    return { score: score, forR: forR, against: against, missing: missing };
  }

  function statusFromScore(s) {
    if (s >= 70) return { key: "strong", label: "Strong match", chip: "chip-ok" };
    if (s >= 45) return { key: "possible", label: "Possible", chip: "chip-info" };
    if (s >= 20) return { key: "weak", label: "Weak", chip: "chip-warn" };
    return { key: "na", label: "Likely not applicable", chip: "chip-muted" };
  }

  function runDeterministicScan(c) {
    var rules = countryRules(c.target.country);
    var paths = rules.pathways || GENERIC;
    var out = [];
    Object.keys(paths).forEach(function (key) {
      var def = paths[key], kind = kindOf(key);
      var sc = scorePathway(kind, c);
      var st = statusFromScore(sc.score);
      out.push({
        key: key, kind: kind, label: def.label, structuralNotes: def.structuralNotes,
        sourceSearch: def.sourceSearch, officialDomains: rules.officialDomains || [],
        score: sc.score, status: st.key, statusLabel: st.label, statusChip: st.chip,
        for: sc.forR, against: sc.against, missing: sc.missing,
        why: "", whyNot: "", confidence: ""
      });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }

  /* deterministic risk register (Layer 1) */
  function buildRisks(c, scan) {
    var r = [], a = c.applicant, sp = c.sponsor, t = c.target;
    function push(title, sev, reason, mit) { r.push({ title: title, severity: sev, reason: reason, mitigation: mit, verify: true }); }
    if (yes(sp.hasSponsor) && relStrength(sp.relationship) === "weak")
      push("Weak sponsor relationship", "high", "An uncle, aunt, cousin or friend is usually not a direct qualifying family sponsor.", "Check work, study, or other routes; only rely on family sponsorship with a close qualifying relative.");
    if (!c.officialSourceText)
      push("Official rules not yet verified", "medium", "The current eligibility, documents and fees have not been confirmed from an official source.", "Open the official government page for your route and paste its text into Official Source.");
    if (no(a.canShowFunds) || nf(a.canShowFunds) === "unknown")
      push("Funds not confirmed", "medium", "Many routes require proof of financial means.", "Prepare bank statements or a sponsorship/financial-support letter.");
    if (yes(a.priorRefusals))
      push("Previous refusal on record", "medium", "A prior refusal can affect future applications and must usually be disclosed.", "Gather details of the previous decision and address the refusal reasons.");
    if (yes(a.overstays))
      push("Previous overstay on record", "high", "An overstay can lead to bans or refusals and usually must be disclosed.", "Verify any re-entry consequences officially before applying.");
    if (nf(a.criminalRecord) === "yes")
      push("Declared criminal history", "high", "Criminal history can affect admissibility for many routes.", "Seek qualified legal advice on admissibility before applying.");
    if (t.timeline === "urgent") {
      var best = scan[0];
      if (best && (best.kind === "skilled" || best.kind === "ancestry" || best.kind === "pr"))
        push("Urgent timeline vs slow route", "medium", "Your timeline is urgent but the strongest route is typically slow.", "Consider a faster temporary route first, or adjust expectations on timing.");
    }
    var topAnc = scan.filter(function (p) { return p.kind === "ancestry" && p.score >= 45; })[0];
    if (topAnc) push("Ancestry document chain", "medium", "Descent routes need an unbroken set of certificates across generations.", "Start collecting birth/marriage certificates for each generation early.");
    return r;
  }

  function computeCompletion(c) {
    var pts = 0, a = c.applicant;
    var profile = a.name && a.residenceCountry && a.citizenships && c.target.country && c.target.goal;
    if (profile) pts += 12;
    if ((c.family.mother && c.family.mother.citizenship) || (c.family.father && c.family.father.citizenship) || nf(c.family.ancestryNotes)) pts += 8;
    if (c.sponsor.hasSponsor) pts += 4; if (yes(c.sponsor.hasSponsor) && c.sponsor.relationship && c.sponsor.status) pts += 4;
    if (c.pathwayScan && c.pathwayScan.length) pts += 12;
    if (c.officialPathwayKey) pts += 10;
    if (c.officialSourceText && c.officialSourceText.length > 40) pts += 12;
    if (c.groundedChecklist) pts += 10;
    if (c.documents && c.documents.length) {
      var col = c.documents.filter(function (d) { return d.status === "collected" || d.status === "submitted" || d.status === "translated" || d.status === "apostilled"; }).length;
      pts += Math.round((col / c.documents.length) * 16);
    }
    if (c.progress.stageIndex >= 6) pts += 6;
    if (c.progress.stageIndex >= 7) pts += 6;
    return clamp(pts, 0, 100);
  }

  function computeNextAction(c) {
    var a = c.applicant;
    if (!(a.name && a.residenceCountry && a.citizenships && c.target.country && c.target.goal)) return "Complete the applicant profile and target, then run the pathway scan.";
    if (!c.pathwayScan || !c.pathwayScan.length) return "Run the pathway scan to detect and rank your realistic routes.";
    if (!c.officialPathwayKey) return "Select your recommended pathway to focus the case.";
    if (!c.officialSourceText || c.officialSourceText.length < 40) return "Open the official source for \u201c" + (c.officialPathwayLabel || "your route") + "\u201d and paste its eligibility/document text.";
    if (!c.groundedChecklist) return "Generate the grounded checklist from the official text you pasted.";
    var docs = c.documents || [];
    var pending = docs.filter(function (d) { return d.status === "not_started" || d.status === "requested"; });
    if (docs.length && pending.length) return "Collect and mark your documents — next: " + pending[0].name + ".";
    if (c.progress.stageIndex < 6) return "Assemble and prepare your application package.";
    if (c.progress.stageIndex < 7) return "Submit your application and set the status to Submitted.";
    if (c.progress.stageIndex < 9) return "Track the decision and update the case when you hear back.";
    return "Record the decision outcome to close out the case.";
  }

  function refreshDerived(c) {
    c.progress.completion = computeCompletion(c);
    c.nextBestAction = computeNextAction(c);
    if (c.progress.stageIndex < 1 && (c.applicant.name && c.target.country && c.target.goal)) c.progress.stageIndex = Math.max(c.progress.stageIndex, 0);
  }

  /* =======================================================================
     AGENT INTELLIGENCE EXTENSIONS  (all deterministic — no invented facts)
     Rejected routes, document readiness, missing-info detector, source
     quality meter, next-action explainer, proof-of-autonomy, case review.
     ===================================================================== */
  var DOC_DONE = ["collected", "translated", "apostilled", "submitted"];
  function docIsDone(d) { return DOC_DONE.indexOf(d.status) >= 0; }

  /* #2 — routes the agent decided NOT to pursue */
  function routeFix(kind) {
    return ({
      family: "A closer qualifying relative (spouse, parent or child) in the destination.",
      spouse: "A spouse or registered partner in the destination.",
      work: "A job offer from an employer in the destination.",
      student: "An admission offer and proof of funds.",
      ancestry: "A documented ancestor with citizenship of, or birth in, the destination.",
      eu: "An EU/EEA citizenship — free movement applies only to EU/EEA nationals.",
      investor: "Evidence of qualifying capital to invest.",
      nomad: "Proof of stable remote income.",
      visitor: "A genuinely short-term purpose with strong ties to your home country."
    })[kind] || "A qualifying basis for this route.";
  }
  function rejectedRoutes(c) {
    return (c.pathwayScan || []).filter(function (p) {
      return p.status === "na" || ((p.kind === "family" || p.kind === "spouse") && p.status === "weak");
    }).map(function (p) {
      var impossible = p.score <= 5;
      return {
        label: p.label, score: p.score,
        verdict: impossible ? "Not available for your situation" : "Weak / not a direct route",
        reason: p.whyNot || (p.against && p.against[0]) || p.structuralNotes || "Low structural fit for your situation.",
        fix: (p.missing && p.missing[0]) || routeFix(p.kind),
        decision: impossible ? "Do not pursue this route." : "Do not pursue as primary; revisit if your situation changes."
      };
    });
  }

  /* #3 — document readiness (separate from overall completion) */
  function documentReadiness(c) {
    var docs = c.documents || [], g = c.groundedChecklist;
    var hasSource = !!(c.officialSourceText && c.officialSourceText.length > 40);
    var hasChecklist = !!g;
    var reqFromG = hasChecklist
      ? list(g.documents).concat(list(g.sponsorDocuments)).filter(function (x) { return !/not found in pasted/i.test(x); }).length : 0;
    var universe = Math.max(docs.length, reqFromG, 1);
    var collected = docs.filter(docIsDone).length;
    var frac = clamp(collected / universe, 0, 1);
    var score = 0;
    if (hasSource) score += 15;
    if (hasChecklist) score += 15;
    score += Math.round(frac * 70);
    if (!hasSource) score = Math.min(score, 25);
    else if (!hasChecklist) score = Math.min(score, 45);
    score = clamp(score, 0, 100);
    var band = score <= 25 ? "Not ready" : score <= 50 ? "Early preparation" : score <= 75 ? "Partially ready" : score <= 90 ? "Nearly ready" : "Application-ready";
    var pending = docs.filter(function (d) { return !docIsDone(d); });
    var critRe = /passport|birth|marriage|sponsor|police|medical|admission|employ|fund|bank|certificate/i;
    var missingCritical = pending.filter(function (d) { return critRe.test(d.name); });
    var nextDoc = (missingCritical[0] || pending[0]) ? (missingCritical[0] || pending[0]).name : "";
    var risk = !hasSource ? "Required documents are unknown until you paste the official source."
      : missingCritical.length ? (missingCritical.length + " core document(s) still missing — these usually block submission.")
        : pending.length ? (pending.length + " document(s) still to collect.") : "";
    return { score: score, band: band, universe: universe, collected: collected, pending: pending.length, missingCritical: missingCritical.map(function (d) { return d.name; }), nextDoc: nextDoc, risk: risk, hasSource: hasSource, hasChecklist: hasChecklist };
  }

  /* #4 — information the agent still needs */
  function missingInfo(c) {
    var a = c.applicant, sp = c.sponsor, t = c.target, fam = c.family, out = [];
    var scan = c.pathwayScan || [];
    function add(item, why, pathway, priority, action) { out.push({ item: item, why: why, pathway: pathway, priority: priority, action: action }); }
    function scored(kind, min) { return scan.some(function (p) { return p.kind === kind && p.score >= (min || 20); }); }
    if (yes(sp.hasSponsor)) {
      if (!sp.status || nf(sp.status) === "unknown") add("Sponsor's immigration status", "Family routes depend on whether the sponsor is a citizen, permanent resident or temporary resident.", "Family sponsorship", "high", "Ask your sponsor for proof of their status.");
      if (!yes(sp.relationshipProof)) add("Proof of the relationship", "Family routes require documentary proof of the relationship.", "Family sponsorship", "medium", "Collect certificates linking you to the sponsor.");
    }
    var g = nf(t.goal);
    if (!yes(a.hasJobOffer) && (g === "work" || g === "pr" || g === "unsure" || scored("work"))) add("A job offer in the destination", "Most work routes require an employer's offer — it is usually the main thing that opens a strong work route.", "Work route", g === "work" ? "high" : "medium", "Pursue or confirm a job offer from an employer there.");
    if (!yes(a.hasAdmission) && (g === "study" || g === "unsure" || scored("student"))) add("A university admission offer", "Study routes usually require an admission offer from an approved institution.", "Study route", g === "study" ? "high" : "medium", "Apply to an approved institution and secure admission.");
    if (no(a.canShowFunds) || nf(a.canShowFunds) === "unknown" || a.canShowFunds === "") add("Proof of funds", "Most routes require evidence of financial means.", "Most routes", "medium", "Prepare bank statements or a financial-support letter.");
    if (scored("ancestry", 25)) {
      var docsOk = [fam.mother, fam.father, fam.gpMaternal, fam.gpPaternal].some(function (p) { return p && yes(p.docs); });
      if (!docsOk) add("Ancestry documents", "Descent routes need an unbroken documentary chain across generations.", "Ancestry / descent", "high", "Locate birth/marriage certificates for each generation.");
    }
    if (yes(a.priorRefusals)) add("Previous refusal details", "A prior refusal usually must be disclosed and addressed.", "All routes", "medium", "Gather the date, country and reason of the previous decision.");
    if (c.officialPathwayKey && !(c.officialSourceText && c.officialSourceText.length > 40)) add("Official source text for the focused route", "The agent will not invent current rules — it grounds checklists only in official text.", c.officialPathwayLabel || "Focused route", "high", "Open the official page and paste its eligibility/document text.");
    if (!t.timeline) add("Your target timeline", "Timeline affects which routes are realistic.", "Planning", "low", "Set how soon you need to move.");
    var order = { high: 0, medium: 1, low: 2 };
    out.sort(function (x, y) { return order[x.priority] - order[y.priority]; });
    return out;
  }

  /* #8 — official-source quality meter (deterministic signal scan) */
  function sourceQuality(text, p, c) {
    var t = String(text || ""); if (t.trim().length < 40) return null;
    var low = t.toLowerCase(), signals = [], score = 0;
    function sig(ok, pts, label) { signals.push({ ok: !!ok, label: label }); if (ok) score += pts; }
    var domains = (p && p.officialDomains) || countryRules(c.target.country).officialDomains || [];
    var onDomain = domains.some(function (d) { return low.indexOf(d.toLowerCase()) >= 0; }) || /\.gov\b|gov\.[a-z]{2}|official/i.test(t);
    sig(onDomain, 18, "Looks like official / government text");
    sig(/eligib|require|must\b|qualif|criteria|condition/i.test(t), 18, "Contains eligibility rules");
    sig(/document|passport|certificate|evidence|proof|photograph|\bform\b/i.test(t), 18, "Lists document requirements");
    sig(/appl(y|ication)|submit|complete|book|appointment|register|\bpay\b/i.test(t), 14, "Describes applicant actions");
    sig(/fee|\$|€|£|valid for|within \d|\bdays\b|\bmonths\b|form [a-z]?-?\d|ds-\d|i-\d/i.test(t), 12, "Mentions fees / deadlines / forms");
    sig(t.length > 600, 10, "Has enough detail (length)");
    var relWords = ((p && p.label) || "").toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3; });
    var relevant = (c.target.country && low.indexOf(nf(c.target.country)) >= 0) || relWords.some(function (w) { return low.indexOf(w) >= 0; });
    sig(relevant, 10, "Relevant to the selected route / country");
    score = clamp(score, 0, 100);
    var band = score >= 70 ? "Strong source" : score >= 45 ? "Usable — could be fuller" : "Too thin to rely on";
    var guidance = [];
    if (score < 70) {
      if (!/eligib|require|criteria/i.test(t)) guidance.push("Paste the section about eligibility / who can apply.");
      if (!/document|passport|certificate|evidence/i.test(t)) guidance.push("Include the required-documents section.");
      if (!onDomain) guidance.push("Copy from the official government domain — avoid blogs, forums and agencies.");
      if (t.length <= 600) guidance.push("Paste a longer extract so the checklist is complete.");
    }
    return { score: score, band: band, signals: signals, guidance: guidance };
  }

  /* #9 — next best action, explained */
  function nextActionDetail(c) {
    var a = c.applicant, action = computeNextAction(c), reason = "", urgency = "Medium", outcome = "", after = "";
    var profileDone = a.name && a.residenceCountry && a.citizenships && c.target.country && c.target.goal;
    if (!profileDone) { reason = "The agent needs your core profile to detect routes."; urgency = "High"; outcome = "A scored list of realistic pathways."; after = "Review and focus the best route."; }
    else if (!(c.pathwayScan && c.pathwayScan.length)) { reason = "No routes have been scanned yet."; urgency = "High"; outcome = "Ranked pathways with reasons."; after = "Pick a route to focus."; }
    else if (!c.officialPathwayKey) { reason = "Focusing a route lets the agent ground its checklist."; urgency = "Medium"; outcome = "An official-source step for that route."; after = "Paste the official text."; }
    else if (!(c.officialSourceText && c.officialSourceText.length > 40)) { reason = "The agent will not invent current rules — it needs the official text first."; urgency = "High"; outcome = "A checklist grounded only in official text."; after = "Collect the listed documents."; }
    else if (!c.groundedChecklist) { reason = "You've pasted the source; now turn it into a checklist."; urgency = "Medium"; outcome = "A grounded document checklist."; after = "Track each document to readiness."; }
    else {
      var rd = documentReadiness(c);
      if (rd.pending) { reason = "Documents drive your readiness score (" + rd.score + "%)."; urgency = rd.missingCritical.length ? "High" : "Medium"; outcome = "Higher document readiness."; after = "Prepare and submit when ready."; }
      else { reason = "Documents are in place; move the case forward."; urgency = "Medium"; outcome = "Application prepared and submitted."; after = "Track the decision."; }
    }
    return { action: action, reason: reason, urgency: urgency, outcome: outcome, after: after };
  }

  /* #7 — proof of autonomy, generated from real runtime state */
  function proofOfAutonomy(c) {
    var scan = c.pathwayScan || [], lines = [];
    function done(t) { lines.push({ done: true, t: t }); }
    function todo(t) { lines.push({ done: false, t: t }); }
    if (c.applicant.name && c.target.country) done("Built a persistent case file: " + c.applicant.name + " \u2192 " + c.target.country); else todo("Build the case file (profile + target)");
    if (scan.length) done("Scanned " + scan.length + " pathway families for " + (c.target.country || "the destination")); else todo("Scan pathway families");
    var rej = rejectedRoutes(c);
    if (rej.length) done("Rejected " + rej.length + " weak / dead-end route(s), with reasons");
    var viable = scan.filter(function (p) { return p.status !== "na"; });
    if (viable.length) done("Ranked " + viable.length + " viable route(s) by structural fit");
    if (yes(c.sponsor.hasSponsor) && relStrength(c.sponsor.relationship) === "weak") done("Flagged a weak sponsor relationship and steered to other routes");
    if (c.officialPathwayKey) { done("Selected " + (c.officialPathwayLabel || "a route") + " as the focus"); done("Required official source text before building any checklist"); }
    else if (scan.length) todo("Select a focused route");
    if (c.officialSourceText && c.officialSourceText.length > 40) done("Received official source text to ground the checklist"); else if (c.officialPathwayKey) todo("Paste the official source text");
    if (c.groundedChecklist) { var n = list(c.groundedChecklist.documents).filter(function (x) { return !/not found in pasted/i.test(x); }).length; done("Built a grounded checklist (" + n + " document item(s)) from pasted text only"); }
    var mi = missingInfo(c);
    if (mi.length) done("Identified " + mi.length + " missing-information item(s)");
    if (c.documents && c.documents.length) done("Tracking " + c.documents.length + " document(s) — " + c.documents.filter(docIsDone).length + " collected");
    if (c.nextBestAction) done("Updated the next best action");
    if (c.decisionLog && c.decisionLog.length) done("Logged " + c.decisionLog.length + " agent decision(s)");
    return lines;
  }

  /* #6 — snapshot + diff for change detection */
  function caseSnapshot(c) {
    var scan = c.pathwayScan || [], top = scan.slice().sort(function (a, b) { return b.score - a.score; })[0] || {};
    var byKind = {}; scan.forEach(function (p) { byKind[p.kind] = p.score; });
    return {
      goal: c.target.goal, hasJobOffer: nf(c.applicant.hasJobOffer), hasAdmission: nf(c.applicant.hasAdmission),
      sponsorRel: c.sponsor.relationship || "", sponsorStatus: c.sponsor.status || "", priorRefusals: nf(c.applicant.priorRefusals),
      focus: c.officialPathwayKey || "", source: !!(c.officialSourceText && c.officialSourceText.length > 40),
      grounded: !!c.groundedChecklist, docsCollected: (c.documents || []).filter(docIsDone).length,
      topKey: top.key || "", topScore: top.score || 0, scores: byKind
    };
  }
  function diffCase(prev, cur) {
    if (!prev) return [];
    var ch = [];
    function yn(v) { return v === "yes" ? "Yes" : v === "no" ? "No" : v ? v : "\u2014"; }
    if (prev.hasJobOffer !== cur.hasJobOffer) ch.push("Job offer changed from " + yn(prev.hasJobOffer) + " to " + yn(cur.hasJobOffer) + ".");
    if (prev.hasAdmission !== cur.hasAdmission) ch.push("University admission changed from " + yn(prev.hasAdmission) + " to " + yn(cur.hasAdmission) + ".");
    if (prev.sponsorRel !== cur.sponsorRel) ch.push("Sponsor relationship changed to " + (cur.sponsorRel ? cur.sponsorRel.replace(/_/g, "/") : "none") + ".");
    if (prev.sponsorStatus !== cur.sponsorStatus) ch.push("Sponsor status was updated.");
    if (prev.goal !== cur.goal) ch.push("Goal changed to " + (GOALS[cur.goal] || cur.goal) + ".");
    if (!prev.source && cur.source) ch.push("Official source text was pasted.");
    if (!prev.grounded && cur.grounded) ch.push("A grounded checklist was generated.");
    if (prev.focus !== cur.focus && cur.focus) ch.push("Focused route changed.");
    if (cur.docsCollected !== prev.docsCollected) ch.push("Collected documents: " + prev.docsCollected + " \u2192 " + cur.docsCollected + ".");
    Object.keys(cur.scores || {}).forEach(function (k) {
      var x = (prev.scores && prev.scores[k]) || 0, y = cur.scores[k];
      if (Math.abs(y - x) >= 12) ch.push(k.charAt(0).toUpperCase() + k.slice(1) + " route score moved from " + x + " to " + y + ".");
    });
    if (prev.topKey && cur.topKey && prev.topKey !== cur.topKey) ch.push("Strongest route changed.");
    return ch;
  }

  /* #5 — autonomous case review (deterministic; works even with no API key) */
  function mergeScanReasoning(oldScan, fresh) {
    var byKey = {}; (oldScan || []).forEach(function (p) { byKey[p.key] = p; });
    fresh.forEach(function (p) { var o = byKey[p.key]; if (o) { p.why = o.why || ""; p.whyNot = o.whyNot || ""; p.confidence = o.confidence || ""; } });
    return fresh;
  }
  function runCaseReview(c) {
    var prevSnap = c.reviewSnapshot || null;
    var fresh = runDeterministicScan(c);
    c.pathwayScan = mergeScanReasoning(c.pathwayScan, fresh);
    var det = buildRisks(c, c.pathwayScan);
    var llmRisks = (c.risks || []).filter(function (r) { return r.llm; });
    c.risks = det.concat(llmRisks);
    refreshDerived(c);
    var curSnap = caseSnapshot(c);
    var changes = diffCase(prevSnap, curSnap);
    var sorted = c.pathwayScan.slice().sort(function (a, b) { return b.score - a.score; });
    var best = sorted[0], second = sorted[1];
    var rej = rejectedRoutes(c), rd = documentReadiness(c), rl = riskLevel(c);
    var topRisk = (c.risks || []).slice().sort(function (a, b) { var o = { high: 0, medium: 1, low: 2 }; return o[a.severity] - o[b.severity]; })[0];
    var review = {
      ts: new Date().toISOString(),
      best: best ? best.label + " (" + best.score + "/100)" : "\u2014",
      second: second ? second.label + " (" + second.score + "/100)" : "\u2014",
      rejectedCount: rej.length,
      biggestBlocker: topRisk ? topRisk.title : "No major blocker flagged.",
      urgentDoc: rd.nextDoc || (rd.hasSource ? "Documents in hand." : "Official source not yet pasted."),
      readiness: rd.score, readinessBand: rd.band, risk: rl.k, nextAction: c.nextBestAction,
      confidence: best ? (best.score >= 70 ? "high" : best.score >= 45 ? "medium" : "low") : "low",
      changes: changes, noChange: !!prevSnap && changes.length === 0
    };
    c.reviewSnapshot = curSnap;
    c.lastReview = review;
    c.changeLog = (changes.map(function (x) { return { ts: review.ts, text: x }; })).concat(c.changeLog || []).slice(0, 30);
    logDecision(c, "case update", review.noChange ? "Case review: no major change detected." : ("Case review complete \u2014 " + changes.length + " change(s) detected."), "Re-scored routes, recomputed readiness and risk, and refreshed the next best action.", { confidence: review.confidence, next: c.nextBestAction });
    saveCase(c);
    return review;
  }

  /* =======================================================================
     LLM LAYER  (enrich reasoning + ground checklist in official text)
     ===================================================================== */
  function parseJSON(text) {
    if (!text) return null;
    var t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    try { return JSON.parse(t); } catch (_) {}
    var i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (_) {} }
    return null;
  }

  function groq(messages, opts) {
    opts = opts || {};
    return fetch("/api/groq", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages, model: state.model,
        temperature: opts.temperature == null ? 0.2 : opts.temperature,
        max_tokens: opts.max_tokens || 2800,
        response_format: opts.json === false ? undefined : { type: "json_object" }
      })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : "The analysis service returned an error.");
        return data.content || "";
      });
    });
  }

  function caseDigest(c) {
    var a = c.applicant, sp = c.sponsor, fam = c.family, t = c.target;
    return {
      target: { country: t.country, goal: GOALS[t.goal] || t.goal, timeline: TIMELINES[t.timeline] || t.timeline },
      applicant: {
        age: a.age, residence: a.residenceCountry, citizenships: splitList(a.citizenships),
        maritalStatus: a.maritalStatus, education: a.education, occupation: a.occupation,
        experienceYears: a.experienceYears, hasJobOffer: a.hasJobOffer, employerInTarget: a.employerInTarget,
        hasAdmission: a.hasAdmission, canShowFunds: a.canShowFunds, savings: a.savings,
        languages: splitList(a.languages), priorRefusals: a.priorRefusals, overstays: a.overstays
      },
      family: {
        mother: fam.mother, father: fam.father, grandparents: [fam.gpMaternal, fam.gpPaternal], ancestryNotes: fam.ancestryNotes
      },
      sponsor: yes(sp.hasSponsor) ? { relationship: sp.relationship, status: sp.status, willing: sp.willingToSponsor, canSupport: sp.canFinanciallySupport, proof: sp.relationshipProof } : null
    };
  }

  function enrichScan(c) {
    var scanLite = c.pathwayScan.map(function (p) {
      return { key: p.key, label: p.label, kind: p.kind, score: p.score, status: p.statusLabel, structuralNotes: p.structuralNotes };
    });
    var sys = "You are Passage, an autonomous immigration TRIAGE agent. You reason ONLY about STRUCTURE: which routes fit a person's situation and why. You must NEVER state current fees, quotas, processing times, income thresholds, exact form numbers, or claim guaranteed eligibility — for any such specifics say 'verify officially'. Output STRICT JSON only.";
    var usr =
      "CASE:\n" + JSON.stringify(caseDigest(c)) +
      "\n\nDETERMINISTIC SCAN (already scored):\n" + JSON.stringify(scanLite) +
      "\n\nReturn JSON exactly:\n{\n" +
      '  "pathways":[{"key":"...","why":"1 sentence why it may apply for THIS person","whyNot":"1 sentence why it may not / what limits it","missing":["info still needed"],"confidence":"low|medium|high"}],\n' +
      '  "recommended":[{"key":"...","rank":1,"why":"why recommended","viability":"what makes it viable","blockers":"what could block it","likelyDocuments":["..."],"verifyOfficially":"what to confirm on the official site","nextAction":"single concrete next step"}],\n' +
      '  "extraRisks":[{"title":"...","severity":"low|medium|high","reason":"...","mitigation":"..."}],\n' +
      '  "summaryLine":"one neutral sentence summarising the case",\n' +
      '  "nextBestAction":"the single most useful next step"\n}\n' +
      "Pick 1-3 recommended (highest structural fit). Be honest about weak relationships (uncle/aunt/cousin/friend are usually NOT direct family sponsors). Keep every string short.";
    return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { temperature: 0.25, max_tokens: 3000 })
      .then(function (txt) { return parseJSON(txt); });
  }

  function groundChecklist(c, pathway, officialText) {
    var sys = "You build an immigration document checklist STRICTLY from official source text the user pasted. You must use ONLY what is present in that text. If the text does not contain something, put exactly 'Not found in pasted source text.' as the only item for that field. Never invent fees, forms, deadlines, or requirements. Output STRICT JSON only.";
    var usr =
      "DESTINATION: " + (c.target.country || "(unspecified)") +
      "\nPATHWAY: " + (pathway.label || pathway.key) +
      "\n\nOFFICIAL SOURCE TEXT (verbatim, may be partial):\n\"\"\"\n" + officialText.slice(0, POLICY_CAP) + "\n\"\"\"\n\n" +
      "Return JSON exactly:\n{\n" +
      '  "eligibility":["requirement found in text"],\n' +
      '  "documents":["required document found in text"],\n' +
      '  "optionalDocuments":["supporting document found in text"],\n' +
      '  "sponsorDocuments":["sponsor/employer/host document found in text"],\n' +
      '  "applicantActions":["step the applicant must take, found in text"],\n' +
      '  "deadlines":["deadline/validity period found in text"],\n' +
      '  "fees":["fee found in text"],\n' +
      '  "forms":["form name/number found in text"],\n' +
      '  "unclear":["item present but ambiguous in the text"],\n' +
      '  "questions":["question to verify with the authority"],\n' +
      '  "riskWarnings":["warning grounded in the text"]\n}\n' +
      "For any field with nothing in the text, use [\"Not found in pasted source text.\"].";
    return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { temperature: 0.1, max_tokens: 2800 })
      .then(function (txt) { return parseJSON(txt); });
  }

  /* run the full scan (deterministic + LLM enrich) */
  function runScan(c) {
    var scan = runDeterministicScan(c);
    c.pathwayScan = scan;
    c.risks = buildRisks(c, scan);
    c.lastScanAt = new Date().toISOString();
    if (c.progress.stageIndex < 1) c.progress.stageIndex = 1;

    logDecision(c, "pathway detection", "Detected " + scan.length + " pathway families for " + (c.target.country || "destination") + ".", "Based on the country's available route families and your profile.", { confidence: "high" });
    var weak = scan.filter(function (p) { return p.status === "na" || (p.kind === "family" && p.status === "weak"); });
    if (weak.length) logDecision(c, "pathway rejection", "Down-ranked " + weak.length + " route(s) as weak / likely not applicable.", "They scored low for your situation (e.g. extended-relative sponsorship, or routes needing something you don't have).", { confidence: "medium" });
    var top = scan[0];
    if (top) logDecision(c, "pathway ranking", "Top structural route: " + top.label + " (" + top.score + "/100).", "Highest structural fit before official verification.", { confidence: "medium", pathway: top.label });

    refreshDerived(c);

    return enrichScan(c).then(function (en) {
      if (en) {
        if (Array.isArray(en.pathways)) {
          en.pathways.forEach(function (p) {
            var match = c.pathwayScan.filter(function (x) { return x.key === p.key; })[0];
            if (match) { match.why = p.why || ""; match.whyNot = p.whyNot || ""; if (p.missing && p.missing.length) match.missing = list(p.missing); match.confidence = p.confidence || ""; }
          });
        }
        c.recommendedPathways = Array.isArray(en.recommended) ? en.recommended.slice(0, 3) : [];
        if (Array.isArray(en.extraRisks)) en.extraRisks.forEach(function (r) { if (r && r.title) c.risks.push({ title: r.title, severity: (r.severity || "medium"), reason: r.reason || "", mitigation: r.mitigation || "", verify: true, llm: true }); });
        c.scanSummary = en.summaryLine || "";
        if (en.nextBestAction) c.nextBestAction = en.nextBestAction;
        logDecision(c, "risk assessment", "Compiled risk register (" + c.risks.length + " item(s)).", "Combines structural checks with agent reasoning.", { confidence: "medium" });
      } else {
        c.recommendedPathways = deterministicRecommend(c);
      }
      refreshDerived(c);
      c.reviewSnapshot = caseSnapshot(c);
      saveCase(c);
      return c;
    }).catch(function (err) {
      c.recommendedPathways = deterministicRecommend(c);
      refreshDerived(c);
      c.reviewSnapshot = caseSnapshot(c);
      saveCase(c);
      throw err;
    });
  }

  function deterministicRecommend(c) {
    var goal = nf(c.target.goal);
    var shortTerm = goal === "visit" || goal === "tourism" || goal === "unsure" || goal === "";
    // entry routes only: drop PR/citizenship "outcome" containers; drop visitor when the goal is long-term
    var pool = (c.pathwayScan || []).filter(function (p) {
      if (p.kind === "pr" || p.kind === "citizenship") return false;
      if (!shortTerm && p.kind === "visitor") return false;
      return true;
    }).slice().sort(function (a, b) { return b.score - a.score; });
    // primary: genuinely viable routes; fallback: always surface the best direction even if it needs a prerequisite
    var picks = pool.filter(function (p) { return p.score >= 40; }).slice(0, 3);
    if (!picks.length) picks = pool.filter(function (p) { return p.score > 0; }).slice(0, 2);
    return picks.map(function (p, i) {
      var weakish = p.score < 45;
      return {
        key: p.key, rank: i + 1,
        why: (p.for && p.for[0]) || p.structuralNotes || "",
        viability: p.structuralNotes || "",
        blockers: (p.against && p.against[0]) || (p.missing && p.missing[0]) || "",
        likelyDocuments: [],
        verifyOfficially: "Confirm current eligibility and documents on the official source.",
        nextAction: weakish
          ? "This is your most realistic direction, but it needs a prerequisite (e.g. " + ((p.missing && p.missing[0]) || "a sponsor, admission, or job offer") + "). Work toward that, then verify the official source."
          : "Open the official source for " + p.label + " and paste its text to generate a grounded checklist."
      };
    });
  }

  /* =======================================================================
     SAMPLE CASES (spec §31)
     ===================================================================== */
  function sampleSeeds() {
    return [
      {
        title: "Stefan — Bulgaria → USA (uncle in the US)",
        sub: "Shows why an uncle is usually not a direct family sponsor",
        seed: {
          caseName: "Stefan — US study/work pathway",
          applicant: { name: "Stefan", age: "24", residenceCountry: "Bulgaria", citizenships: "Bulgaria", maritalStatus: "single", education: "Bachelor's degree", occupation: "Software developer", experienceYears: "2", hasJobOffer: "no", employerInTarget: "no", hasAdmission: "no", savings: "yes", canShowFunds: "yes", languages: "Bulgarian, English", priorRefusals: "no", overstays: "no" },
          target: { country: "United States", goal: "work", timeline: "y1" },
          sponsor: { hasSponsor: "yes", relationship: "uncle_aunt", status: "citizen", canProvideDocuments: "yes", canFinanciallySupport: "yes", willingToSponsor: "yes", relationshipProof: "yes" }
        }
      },
      {
        title: "Maria — Bulgaria → Italy (Italian grandparent)",
        sub: "Flags citizenship by descent (jure sanguinis)",
        seed: {
          caseName: "Maria — Italian citizenship by descent",
          applicant: { name: "Maria", age: "31", residenceCountry: "Bulgaria", citizenships: "Bulgaria", maritalStatus: "married", education: "Master's degree", occupation: "Architect", experienceYears: "6", hasJobOffer: "no", canShowFunds: "yes", savings: "yes", languages: "Bulgarian, Italian", priorRefusals: "no", overstays: "no" },
          target: { country: "Italy", goal: "citizenship_descent", timeline: "norush" },
          family: { gpPaternal: { citizenship: "Italy", countryOfBirth: "Italy", docs: "yes" }, ancestryNotes: "Paternal grandfather born in Italy; have his birth certificate." }
        }
      },
      {
        title: "Ivan — job offer in Germany",
        sub: "Strong work / EU Blue Card style route (non-EU national)",
        seed: {
          caseName: "Ivan — Germany work route",
          applicant: { name: "Ivan", age: "29", residenceCountry: "Serbia", citizenships: "Serbia", education: "Master's degree", occupation: "Mechanical engineer", experienceYears: "5", hasJobOffer: "yes", employerInTarget: "yes", professionRegulated: "no", canShowFunds: "yes", savings: "yes", languages: "Serbian, English, German" },
          target: { country: "Germany", goal: "work", timeline: "m3" }
        }
      },
      {
        title: "Lena — study route to Canada",
        sub: "Student route grounded in official text",
        seed: {
          caseName: "Lena — Canada study plan",
          applicant: { name: "Lena", age: "20", residenceCountry: "Bulgaria", citizenships: "Bulgaria", education: "High school", occupation: "Student", hasAdmission: "yes", canShowFunds: "yes", savings: "yes", languages: "Bulgarian, English" },
          target: { country: "Canada", goal: "study", timeline: "m6" }
        }
      }
    ];
  }

  /* =======================================================================
     VIEWS
     ===================================================================== */
  var app = $("#app");
  function render() {
    if (state.route === "case" && state.activeId && getCase(state.activeId)) renderCase(getCase(state.activeId));
    else if (state.route === "intake") renderIntake();
    else renderDashboard();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }
  function go(route, id) { state.route = route; if (id !== undefined) state.activeId = id; save("passage.activeCaseId", state.activeId); render(); }

  /* ---- stamp ring ---- */
  function stampRing(pct, big) {
    var C = 2 * Math.PI * 44, off = C * (1 - clamp(pct, 0, 100) / 100);
    return '<div class="stamp' + (big ? " lg" : "") + '"><svg viewBox="0 0 100 100">' +
      '<circle class="ring-bg" cx="50" cy="50" r="44"></circle>' +
      '<circle class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
      '</svg><span class="pct">' + Math.round(pct) + '%</span></div>';
  }

  function riskLevel(c) {
    var hi = (c.risks || []).some(function (r) { return r.severity === "high"; });
    var md = (c.risks || []).some(function (r) { return r.severity === "medium"; });
    return hi ? { k: "High", chip: "chip-bad" } : md ? { k: "Medium", chip: "chip-warn" } : { k: "Low", chip: "chip-ok" };
  }

  /* ------------------------------------------------------------ DASHBOARD */
  function renderDashboard() {
    var cases = getCases();
    var ids = Object.keys(cases).sort(function (a, b) { return (cases[b].updatedAt || "").localeCompare(cases[a].updatedAt || ""); });
    var cardsHtml = ids.length ? ids.map(function (id) { return caseCard(cases[id]); }).join("") :
      '<div class="empty"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#8593A0" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h10"/></svg><p>No cases yet. Start one to let the agent map your routes.</p></div>';

    app.innerHTML =
      '<div class="view">' +
      '<section class="hero">' +
        '<div class="eyebrow">Autonomous immigration case manager</div>' +
        '<h1>Your situation, mapped to the routes that <em>actually fit</em>.</h1>' +
        '<p>Passage builds a personal case file, detects realistic visa, residency and citizenship routes, rejects dead ends, and grounds every checklist in the official source — then tracks each step.</p>' +
        '<div class="hero-cta">' +
          '<button class="btn btn-primary" data-act="new">+ Start a new case</button>' +
          '<button class="btn btn-ghost" data-act="samples">Try a sample case</button>' +
        '</div>' +
      '</section>' +
      '<div class="page-head"><div><div class="eyebrow">Your cases</div><h1 style="font-size:24px">' + (ids.length ? ids.length + (ids.length === 1 ? " case on file" : " cases on file") : "No cases yet") + '</h1></div></div>' +
      '<div class="cards-grid">' + cardsHtml + '</div>' +
      '<p class="disclaimer" style="margin-top:24px"><b>Not legal advice.</b> ' + esc(DISCLAIMER) + '</p>' +
      '</div>';
  }

  function caseCard(c) {
    var rl = riskLevel(c);
    var rec = (c.recommendedPathways && c.recommendedPathways[0]) ? labelForKey(c, c.recommendedPathways[0].key) : (c.pathwayScan && c.pathwayScan[0] ? c.pathwayScan[0].label : "—");
    var stage = STAGES[c.progress.stageIndex] ? STAGES[c.progress.stageIndex][0] : "Not started";
    var meta = iso3(c.applicant.residenceCountry) + " \u2192 " + iso3(c.target.country) + " \u00b7 " + (GOALS[c.target.goal] || "—");
    return '<article class="case-card" data-open="' + c.id + '">' +
      '<div class="cc-top"><div style="min-width:0"><h3>' + esc(c.caseName || c.applicant.name || "Untitled case") + '</h3>' +
        '<div class="cc-sub mono">' + esc(meta) + '</div></div>' + stampRing(c.progress.completion) + '</div>' +
      '<div class="cc-row"><span class="chip ' + rl.chip + '">Risk ' + rl.k + '</span><span class="chip chip-muted">' + esc(stage) + '</span></div>' +
      '<div class="cc-path"><span class="muted" style="font-size:12px">Recommended</span><br>' + esc(rec) + '</div>' +
      '<div class="cc-next">Next: ' + esc(c.nextBestAction) + '</div>' +
      '<div class="cc-foot"><span class="muted mono" style="font-size:11px">' + esc(fmtDate(c.updatedAt)) + '</span>' +
        '<div class="cc-actions">' +
          '<button class="btn btn-ghost btn-sm" data-open="' + c.id + '">Open</button>' +
          '<button class="btn btn-ghost btn-sm" data-export="' + c.id + '">Export</button>' +
          '<button class="btn btn-danger btn-sm" data-del="' + c.id + '">Delete</button>' +
        '</div></div>' +
      '</article>';
  }

  function labelForKey(c, key) {
    var m = (c.pathwayScan || []).filter(function (p) { return p.key === key; })[0];
    return m ? m.label : key;
  }

  /* -------------------------------------------------------------- INTAKE */
  var FORM = [
    { title: "Applicant", fields: [
      { p: "applicant.name", l: "Full name", t: "text", col2: false },
      { p: "applicant.age", l: "Age", t: "number" },
      { p: "applicant.residenceCountry", l: "Current country of residence", t: "text" },
      { p: "applicant.city", l: "Current city (optional)", t: "text" },
      { p: "applicant.citizenships", l: "Citizenship(s)", t: "text", help: "Comma-separated if more than one", col2: true },
      { p: "applicant.maritalStatus", l: "Marital status", t: "select", o: [["", "—"], ["single", "Single"], ["married", "Married"], ["partnered", "In a partnership"], ["divorced", "Divorced"], ["widowed", "Widowed"]] },
      { p: "applicant.dependents", l: "Dependents?", t: "yesno" },
      { p: "applicant.passportValid", l: "Valid passport?", t: "yesnou" },
      { p: "applicant.statusInResidence", l: "Current immigration status where you live", t: "text" }
    ]},
    { title: "Target", fields: [
      { p: "target.country", l: "Destination country", t: "country", col2: true },
      { p: "target.goal", l: "Goal", t: "chips", o: Object.keys(GOALS).map(function (k) { return [k, GOALS[k]]; }), col2: true },
      { p: "target.timeline", l: "Timeline", t: "chips", o: Object.keys(TIMELINES).map(function (k) { return [k, TIMELINES[k]]; }), col2: true }
    ]},
    { title: "Education & work", fields: [
      { p: "applicant.education", l: "Highest education", t: "select", o: [["", "—"], ["High school", "High school"], ["Vocational", "Vocational"], ["Bachelor's degree", "Bachelor's"], ["Master's degree", "Master's"], ["PhD / Doctorate", "PhD / Doctorate"]] },
      { p: "applicant.fieldOfStudy", l: "Field of study (optional)", t: "text" },
      { p: "applicant.occupation", l: "Occupation", t: "text" },
      { p: "applicant.experienceYears", l: "Years of experience", t: "number" },
      { p: "applicant.hasJobOffer", l: "Job offer in destination?", t: "yesno" },
      { p: "applicant.employerInTarget", l: "Employer based in destination?", t: "yesno" },
      { p: "applicant.professionRegulated", l: "Profession regulated/licensed?", t: "yesnou" },
      { p: "applicant.hasAdmission", l: "University admission offer?", t: "yesnou" },
      { p: "applicant.languages", l: "Languages spoken", t: "text", help: "Comma-separated", col2: true }
    ]},
    { title: "Financial", fields: [
      { p: "applicant.savings", l: "Have savings?", t: "yesno" },
      { p: "applicant.canShowFunds", l: "Can show financial support?", t: "yesnou" },
      { p: "applicant.hasAccommodation", l: "Accommodation in destination?", t: "yesno" }
    ]},
    { title: "Immigration history", fields: [
      { p: "applicant.priorRefusals", l: "Previous visa refusals?", t: "yesno" },
      { p: "applicant.overstays", l: "Previous overstays?", t: "yesno" },
      { p: "applicant.priorDeportation", l: "Previous removal/deportation?", t: "yesno" },
      { p: "applicant.criminalRecord", l: "Criminal record?", t: "yesnup" },
      { p: "applicant.travelledBefore", l: "Travelled internationally before?", t: "yesno" }
    ]},
    { title: "Family & ancestry", note: "This is what makes Passage stronger than a generic visa guide — descent routes hide here.", fields: [
      { sub: "Mother" },
      { p: "family.mother.citizenship", l: "Mother — citizenship", t: "text" },
      { p: "family.mother.countryOfBirth", l: "Mother — country of birth", t: "text" },
      { p: "family.mother.hadTargetCitizenship", l: "Mother had destination citizenship?", t: "yesnou" },
      { p: "family.mother.docs", l: "Mother — documents available?", t: "yesnou" },
      { sub: "Father" },
      { p: "family.father.citizenship", l: "Father — citizenship", t: "text" },
      { p: "family.father.countryOfBirth", l: "Father — country of birth", t: "text" },
      { p: "family.father.hadTargetCitizenship", l: "Father had destination citizenship?", t: "yesnou" },
      { p: "family.father.docs", l: "Father — documents available?", t: "yesnou" },
      { sub: "Grandparents" },
      { p: "family.gpMaternal.citizenship", l: "Maternal grandparent — citizenship/origin", t: "text" },
      { p: "family.gpMaternal.countryOfBirth", l: "Maternal grandparent — country of birth", t: "text" },
      { p: "family.gpPaternal.citizenship", l: "Paternal grandparent — citizenship/origin", t: "text" },
      { p: "family.gpPaternal.countryOfBirth", l: "Paternal grandparent — country of birth", t: "text" },
      { p: "family.ancestryNotes", l: "Ancestry notes", t: "textarea", help: "Old citizenships, birthplaces, migration history that may matter", col2: true }
    ]},
    { title: "Sponsor & relationship", note: "The agent will not assume any sponsor works — it weighs whether the relationship actually qualifies.", fields: [
      { p: "sponsor.hasSponsor", l: "Anyone in the destination?", t: "yesno", col2: true },
      { p: "sponsor.relationship", l: "Their relationship to you", t: "select", o: [["", "—"]].concat(REL_OPTIONS) },
      { p: "sponsor.status", l: "Their status", t: "select", o: [["", "—"], ["citizen", "Citizen"], ["permanent_resident", "Permanent resident"], ["green_card", "Green-card holder"], ["temporary_resident", "Temporary resident"], ["work_permit", "Work-permit holder"], ["student", "Student"], ["unknown", "Unknown"]] },
      { p: "sponsor.willingToSponsor", l: "Willing to sponsor?", t: "yesnou" },
      { p: "sponsor.canFinanciallySupport", l: "Can financially support you?", t: "yesnou" },
      { p: "sponsor.relationshipProof", l: "Relationship proof available?", t: "yesnou" }
    ]}
  ];

  var draft = null;
  function renderIntake() {
    draft = state.editId && getCase(state.editId) ? getCase(state.editId) : (draft && !state.editId ? draft : newCase());
    var editing = !!state.editId;
    var html = '<div class="view"><div class="page-head"><div>' +
      '<div class="eyebrow">' + (editing ? "Edit case" : "New case") + '</div>' +
      '<h1>Tell Passage your situation</h1>' +
      '<p>Fill in what you can — every field sharpens the triage. You can edit it later. Nothing is sent anywhere until you run the scan.</p>' +
      '</div></div>';

    html += '<form id="intake-form">';
    FORM.forEach(function (sec, si) {
      html += '<details class="section"' + (si < 2 ? " open" : "") + '><summary><span class="s-num">' + (si + 1) + '</span><h2>' + esc(sec.title) + '</h2><span class="s-meta"><span class="chev">›</span></span></summary><div class="s-body">';
      if (sec.note) html += '<p class="muted" style="font-size:13px;margin-top:6px">' + esc(sec.note) + '</p>';
      html += '<div class="form-grid">';
      sec.fields.forEach(function (f) {
        if (f.sub) { html += '<div class="field col-2"><div class="subhead">' + esc(f.sub) + '</div></div>'; return; }
        html += fieldHtml(f, draft);
      });
      html += '</div></div></details>';
    });
    html += '</form>';

    html += '<div class="run-row">' +
      '<button class="btn btn-primary" id="run-scan-btn">Run pathway scan →</button>' +
      '<button class="btn btn-ghost" data-act="cancel-intake">Cancel</button>' +
      '<span class="muted" style="font-size:12.5px">The agent will detect, rank and explain your routes.</span>' +
      '</div>';
    html += '<p class="disclaimer"><b>Not legal advice.</b> ' + esc(DISCLAIMER) + '</p></div>';

    app.innerHTML = html;
    bindFieldInputs();
  }

  function fieldHtml(f, c) {
    var val = getPath(c, f.p); if (val == null) val = "";
    var col = f.col2 ? " col-2" : "";
    var inner;
    if (f.t === "select" || f.t === "country") {
      var opts = f.t === "country" ? [["", "Select a country…"]].concat(COUNTRIES.map(function (x) { return [x, x]; })).concat([["__other", "Other / not listed"]]) : f.o;
      inner = '<select data-path="' + f.p + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select>';
    } else if (f.t === "textarea") {
      inner = '<textarea data-path="' + f.p + '">' + esc(val) + '</textarea>';
    } else if (f.t === "chips") {
      inner = '<div class="chip-select" data-path="' + f.p + '">' + f.o.map(function (o) { return '<button type="button" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(val) === String(o[0]) ? "true" : "false") + '">' + esc(o[1]) + '</button>'; }).join("") + '</div>';
    } else if (f.t === "yesno" || f.t === "yesnou" || f.t === "yesnup") {
      var ops = [["yes", "Yes"], ["no", "No"]];
      if (f.t === "yesnou") ops.push(["unknown", "Unknown"]);
      if (f.t === "yesnup") ops.push(["prefer_not", "Prefer not to say"]);
      inner = '<div class="chip-select" data-path="' + f.p + '">' + ops.map(function (o) { return '<button type="button" data-val="' + o[0] + '" aria-pressed="' + (String(val) === o[0] ? "true" : "false") + '">' + o[1] + '</button>'; }).join("") + '</div>';
    } else {
      inner = '<input type="' + (f.t === "number" ? "number" : "text") + '" data-path="' + f.p + '" value="' + esc(val) + '" />';
    }
    return '<div class="field' + col + '"><label>' + esc(f.l) + '</label>' + (f.help ? '<span class="help">' + esc(f.help) + '</span>' : "") + inner + '</div>';
  }

  function bindFieldInputs() {
    app.querySelectorAll("[data-path]").forEach(function (node) {
      if (node.classList.contains("chip-select")) {
        node.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-val]"); if (!b) return;
          var cur = getPath(draft, node.getAttribute("data-path"));
          var v = b.getAttribute("data-val");
          var nextVal = (String(cur) === v) ? "" : v;
          setPath(draft, node.getAttribute("data-path"), nextVal);
          node.querySelectorAll("button[data-val]").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-val") === nextVal ? "true" : "false"); });
        });
      } else {
        node.addEventListener("change", function () { setPath(draft, node.getAttribute("data-path"), node.value); });
        node.addEventListener("input", function () { setPath(draft, node.getAttribute("data-path"), node.value); });
      }
    });
  }

  function startScan() {
    var c = draft;
    if (!c.applicant.name) { toast("Add the applicant's name first."); openSection(0); return; }
    if (!c.target.country) { toast("Choose a destination country."); openSection(1); return; }
    if (!c.target.goal) { toast("Pick an immigration goal."); openSection(1); return; }
    if (!c.applicant.citizenships) { toast("Add at least one citizenship."); openSection(0); return; }
    if (!c.caseName) c.caseName = c.applicant.name + " — " + c.target.country;

    logDecision(c, "profile intake", "Profile captured for " + c.applicant.name + " → " + c.target.country + ".", "Applicant, target, family and sponsor data recorded.", { confidence: "high" });
    saveCase(c);
    state.editId = null; draft = null;
    state.activeId = c.id; save("passage.activeCaseId", c.id);
    state.route = "case"; render();
    // kick the scan after the case view paints
    triggerScan(c.id);
  }

  function openSection(i) { var d = app.querySelectorAll("details.section")[i]; if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); } }

  /* ---------------------------------------------------------------- CASE */
  var scanningId = null;
  function triggerScan(id) {
    var c = getCase(id); if (!c) return;
    scanningId = id; renderCase(c);
    runScan(c).then(function () { scanningId = null; if (state.activeId === id && state.route === "case") renderCase(getCase(id)); toast("Pathway scan complete."); })
      .catch(function (err) { scanningId = null; if (state.activeId === id && state.route === "case") renderCase(getCase(id)); toast(err.message || "Scan finished with limited detail."); });
  }

  function renderCase(c) {
    var rl = riskLevel(c);
    var scanning = scanningId === c.id;
    var stageName = STAGES[c.progress.stageIndex] ? STAGES[c.progress.stageIndex][0] : "—";
    var meta = "CASE " + c.id.slice(5, 11).toUpperCase() + " \u00b7 " + iso3(c.applicant.residenceCountry) + "\u2192" + iso3(c.target.country) + " \u00b7 " + (GOALS[c.target.goal] || "—").toUpperCase();

    var html = '<div class="view">';
    /* case bar */
    html += '<div class="case-bar"><div class="cb-top">' +
      stampRing(c.progress.completion, true) +
      '<div style="min-width:0"><h1>' + esc(c.caseName || "Case") + '</h1><div class="cb-meta">' + esc(meta) + '</div></div>' +
      '<div class="cb-spacer"></div>' +
      '<span class="chip ' + rl.chip + '">Risk ' + rl.k + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-act="edit">Edit profile</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="rescan">Re-scan</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="export-active">Export</button>' +
      '</div>' +
      '<div class="nba-banner"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B98A2E" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
        '<div style="min-width:0"><div class="nba-label">Next best action' + (function () { var nd = nextActionDetail(c); return ' \u00b7 <span class="nba-urgency ' + nf(nd.urgency) + '">' + esc(nd.urgency) + ' urgency</span>'; })() + '</div><div class="nba-text">' + esc(c.nextBestAction) + '</div>' +
        (function () { var nd = nextActionDetail(c); return (nd.reason || nd.outcome) ? '<div class="nba-why">' + (nd.reason ? '<span><b>Why:</b> ' + esc(nd.reason) + '</span>' : "") + (nd.outcome ? '<span><b>You\'ll get:</b> ' + esc(nd.outcome) + '</span>' : "") + (nd.after ? '<span><b>Then:</b> ' + esc(nd.after) + '</span>' : "") + '</div>' : ""; })() +
        '</div></div>' +
      '</div>';

    /* anchor nav */
    html += '<div class="anchor-nav">' +
      ['summary|Summary', 'review|Agent review', 'pathways|Pathways', 'rejected|Rejected', 'recommended|Recommended', 'missing|Missing info', 'risks|Risks', 'source|Official source', 'documents|Documents', 'progress|Progress', 'log|Decision log']
        .map(function (a) { var p = a.split("|"); return '<button data-jump="sec-' + p[0] + '">' + p[1] + '</button>'; }).join("") +
      '</div>';

    /* A. summary */
    html += section("summary", "A", "Case summary", true,
      '<div class="form-grid">' +
        sumItem("Applicant", esc(c.applicant.name || "—") + (c.applicant.age ? ", " + esc(c.applicant.age) : "")) +
        sumItem("From → To", esc(c.applicant.residenceCountry || "—") + " \u2192 " + esc(c.target.country || "—")) +
        sumItem("Citizenships", esc(splitList(c.applicant.citizenships).join(", ") || "—")) +
        sumItem("Goal", esc((GOALS[c.target.goal] || "—") + " \u00b7 " + (TIMELINES[c.target.timeline] || ""))) +
        sumItem("Stage", esc(stageName)) +
        sumItem("Completion", c.progress.completion + "%") +
      '</div>' +
      (c.scanSummary ? '<p style="margin-top:12px">' + esc(c.scanSummary) + '</p>' : "")
    );

    /* ★ agent review & proof of work (improvements #5, #6, #7) */
    html += section("review", "\u2713", "Agent review & proof of work", true, reviewBlock(c));

    /* B. pathways */
    var pwBody;
    if (scanning) pwBody = scanLoop();
    else if (!c.pathwayScan.length) pwBody = '<p class="muted">No scan yet. <button class="btn btn-ghost btn-sm" data-act="rescan">Run the scan</button></p>';
    else {
      var viable = c.pathwayScan.filter(function (p) { return p.status !== "na"; });
      var rejected = c.pathwayScan.filter(function (p) { return p.status === "na"; });
      pwBody = '<div class="pathway-grid">' + viable.map(pwCard).join("") + '</div>';
      if (rejected.length) pwBody += '<div class="subhead" style="margin-top:18px">Rejected / not directly applicable</div><div class="pathway-grid">' + rejected.map(pwCard).join("") + '</div>';
    }
    html += section("pathways", "B", "Pathway scan", true, pwBody);

    /* B2. routes the agent rejected (improvement #2) */
    html += section("rejected", "\u2715", "Routes the agent rejected", true, rejectedBlock(c, scanning));

    /* C. recommended */
    var recBody = (c.recommendedPathways && c.recommendedPathways.length)
      ? c.recommendedPathways.map(function (r, i) { return recCard(c, r, i); }).join("")
      : '<p class="muted">' + (scanning ? "Ranking your best routes…" : "Run the scan to see recommended routes.") + '</p>';
    html += section("recommended", "C", "Recommended route", true, recBody);

    /* C2. information the agent still needs (improvement #4) */
    html += section("missing", "?", "Information the agent still needs", true, missingInfoBlock(c, scanning));

    /* D. risks */
    var riskBody = (c.risks && c.risks.length)
      ? c.risks.map(function (r) {
        return '<div class="risk-item"><span class="risk-sev ' + esc(r.severity || "medium") + '"></span><div><h4>' + esc(r.title) + '</h4>' +
          '<p>' + esc(r.reason) + '</p>' + (r.mitigation ? '<p class="mit">→ ' + esc(r.mitigation) + '</p>' : "") + '</div></div>';
      }).join("")
      : '<p class="muted">' + (scanning ? "Assessing risks…" : "No risks flagged yet.") + '</p>';
    html += section("risks", "D", "Risk report", true, riskBody);

    /* E. official source grounding */
    html += section("source", "E", "Official source grounding", true, sourceBlock(c, scanning));

    /* F. documents + readiness (improvement #3) */
    html += section("documents", "F", "Document checklist & readiness", true, readinessMeter(c) + documentsBlock(c));

    /* G. progress */
    html += section("progress", "G", "Progress tracker", true, progressBlock(c) + timelineBlock(c, true));

    /* H. timeline */
    html += section("timeline", "—", "Timeline", false, timelineBlock(c, false));

    /* notes */
    html += section("notes", "—", "Case notes", false,
      '<textarea class="notes-area" id="notes-area" placeholder="Embassy notes, appointment dates, lawyer questions, document status…">' + esc(c.notes || "") + '</textarea>' +
      '<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-act="save-notes">Save notes</button></div>');

    /* decision log */
    var logBody = (c.decisionLog && c.decisionLog.length)
      ? c.decisionLog.map(function (l) {
        return '<div class="log-item"><div class="lt">' + esc(new Date(l.ts).toLocaleString()) + '</div><div class="lc">' + esc(l.category) + '</div>' +
          '<div class="ld">' + esc(l.decision) + '</div>' + (l.reason ? '<div class="lr">' + esc(l.reason) + (l.confidence ? " · confidence: " + esc(l.confidence) : "") + '</div>' : "") + '</div>';
      }).join("")
      : '<p class="muted">The agent\'s decisions will appear here as it works.</p>';
    html += section("log", "—", "Agent decision log & audit", false, auditPanel(c) + '<div style="height:14px"></div>' + logBody);

    /* why agent + disclaimer */
    html += '<div class="section"><div class="section-head" data-act="toggle-self"><span class="s-num">i</span><h2>Why this is an agent, not a chatbot</h2></div>' +
      '<div class="s-body"><p class="muted" style="font-size:13.5px">Passage collects a structured profile, builds a persistent case file, detects pathway families, rejects unsuitable routes, ranks realistic ones, identifies missing information, grounds checklists in official text you provide, builds a document plan, tracks progress, monitors risks, recommends the next action, and remembers where you stopped. A chatbot answers one question; Passage manages the process.</p></div></div>';

    html += '<p class="disclaimer"><b>Not legal advice.</b> ' + esc(DISCLAIMER) + (countryRules(c.target.country).cautionNotes ? " " + esc(countryRules(c.target.country).cautionNotes) : "") + '</p>';

    html += '</div>';
    app.innerHTML = html;
    afterCaseRender(c);
  }

  function section(id, num, title, open, body) {
    return '<details class="section" id="sec-' + id + '"' + (open ? " open" : "") + '><summary><span class="s-num">' + num + '</span><h2>' + esc(title) + '</h2><span class="s-meta"><span class="chev">›</span></span></summary><div class="s-body">' + body + '</div></details>';
  }
  function sumItem(k, v) { return '<div class="field"><span class="help">' + esc(k) + '</span><div style="font-size:14.5px;font-weight:600">' + v + '</div></div>'; }

  /* ---- agent review & proof of work (improvements #5/#6/#7) ---- */
  function reviewBlock(c) {
    var rv = c.lastReview, reviewHtml;
    if (rv) {
      reviewHtml = '<div class="review-report">' +
        '<div class="subhead" style="margin-top:0">Last review \u00b7 ' + esc(new Date(rv.ts).toLocaleString()) + '</div>' +
        (rv.noChange ? '<p class="chip chip-muted" style="display:inline-block;margin:0 0 8px">No major change detected — continue with the current next best action.</p>' : "") +
        '<div class="rec-grid">' +
          '<div class="rg"><span class="k">Best route</span>' + esc(rv.best) + '</div>' +
          '<div class="rg"><span class="k">Second best</span>' + esc(rv.second) + '</div>' +
          '<div class="rg"><span class="k">Routes rejected</span>' + rv.rejectedCount + '</div>' +
          '<div class="rg"><span class="k">Biggest blocker</span>' + esc(rv.biggestBlocker) + '</div>' +
          '<div class="rg"><span class="k">Most urgent document</span>' + esc(rv.urgentDoc) + '</div>' +
          '<div class="rg"><span class="k">Document readiness</span>' + rv.readiness + '% \u00b7 ' + esc(rv.readinessBand) + '</div>' +
          '<div class="rg"><span class="k">Risk level</span>' + esc(rv.risk) + '</div>' +
          '<div class="rg"><span class="k">Confidence</span>' + esc(rv.confidence) + '</div>' +
        '</div>' +
        (rv.changes && rv.changes.length ? '<div class="subhead">What changed since last review</div><ul class="change-list">' + rv.changes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : "") +
        '</div>';
    } else {
      reviewHtml = '<p class="muted" style="margin-top:0">Run a review and the agent re-evaluates the whole case: best routes, rejected routes, biggest blocker, document readiness, risk, and what changed since last time.</p>';
    }
    var proof = proofOfAutonomy(c);
    var proofHtml = '<div class="subhead">Proof of autonomy — what the agent actually did</div><ul class="proof-list">' +
      proof.map(function (l) { return '<li class="' + (l.done ? "ok" : "todo") + '"><span class="pm">' + (l.done ? "\u2713" : "\u25cb") + '</span>' + esc(l.t) + '</li>'; }).join("") + '</ul>';
    return '<div class="review-actions"><button class="btn btn-primary btn-sm" data-act="run-review">Run case review</button>' +
      '<span class="muted" style="font-size:12.5px">Re-scores routes, recomputes readiness &amp; risk, and detects what changed.</span></div>' +
      reviewHtml + proofHtml;
  }

  /* ---- routes the agent rejected (improvement #2) ---- */
  function rejectedBlock(c, scanning) {
    if (scanning) return '<p class="muted">Deciding which routes to reject…</p>';
    var rej = rejectedRoutes(c);
    if (!rej.length) return '<p class="muted">' + ((c.pathwayScan && c.pathwayScan.length) ? "No route was fully rejected — every detected route has at least some viability for your situation." : "Run the scan to see which routes the agent rejects and why.") + '</p>';
    return '<p class="muted" style="margin-top:0;font-size:13px">Real decision-making: the agent doesn\u2019t only show what might work — here is what it decided <b>not</b> to pursue, and why.</p>' +
      rej.map(function (r) {
        return '<div class="rej-item"><div class="rej-top"><h4>' + esc(r.label) + '</h4><span class="chip ' + (r.score <= 5 ? "chip-bad" : "chip-warn") + '">' + esc(r.verdict) + '</span></div>' +
          '<p><b>Why rejected:</b> ' + esc(r.reason) + '</p>' +
          '<p><b>Could become viable if:</b> ' + esc(r.fix) + '</p>' +
          '<p class="mit"><b>Agent decision:</b> ' + esc(r.decision) + '</p></div>';
      }).join("");
  }

  /* ---- information the agent still needs (improvement #4) ---- */
  function missingInfoBlock(c, scanning) {
    if (scanning) return '<p class="muted">Detecting information gaps…</p>';
    var mi = missingInfo(c);
    if (!(c.pathwayScan && c.pathwayScan.length)) return '<p class="muted">Run the scan and the agent will list the information it still needs.</p>';
    if (!mi.length) return '<p class="muted">The agent has what it needs for the current step — nothing critical is missing.</p>';
    return mi.map(function (m) {
      var chip = m.priority === "high" ? "chip-bad" : m.priority === "medium" ? "chip-warn" : "chip-muted";
      return '<div class="mi-item"><div class="mi-top"><h4>' + esc(m.item) + '</h4><span class="chip ' + chip + '">' + esc(m.priority) + ' priority</span></div>' +
        '<p><b>Why it matters:</b> ' + esc(m.why) + '</p>' +
        '<p class="muted" style="font-size:12.5px;margin:2px 0">Affects: ' + esc(m.pathway) + '</p>' +
        '<p class="mit">\u2192 ' + esc(m.action) + '</p></div>';
    }).join("");
  }

  /* ---- document readiness meter (improvement #3) ---- */
  function readinessMeter(c) {
    var rd = documentReadiness(c);
    var chip = rd.score <= 25 ? "chip-bad" : rd.score <= 50 ? "chip-warn" : rd.score <= 75 ? "chip-info" : "chip-ok";
    return '<div class="readiness">' +
      '<div class="rd-head"><div class="rd-left"><span class="rd-score">' + rd.score + '%</span><span class="chip ' + chip + '">' + esc(rd.band) + '</span></div>' +
        '<div class="rd-meta"><span><b>' + rd.collected + '</b> / ' + rd.universe + ' collected</span>' + (rd.nextDoc ? '<span>Next: ' + esc(rd.nextDoc) + '</span>' : "") + '</div></div>' +
      '<div class="rd-bar"><span style="width:' + rd.score + '%"></span></div>' +
      (rd.missingCritical.length ? '<p class="rd-risk"><b>Missing core documents:</b> ' + esc(rd.missingCritical.slice(0, 4).join(", ")) + '</p>' : (rd.risk ? '<p class="rd-risk">' + esc(rd.risk) + '</p>' : "")) +
      '</div>';
  }

  /* ---- decision audit, in plain language (improvement #10) ---- */
  function auditPanel(c) {
    var sorted = (c.pathwayScan || []).slice().sort(function (a, b) { return b.score - a.score; });
    var best = sorted[0], rej = rejectedRoutes(c), mi = missingInfo(c);
    var conf = best ? (best.score >= 70 ? "high" : best.score >= 45 ? "medium" : "low") : "\u2014";
    return '<div class="audit"><div class="subhead" style="margin-top:0">Decision audit — in plain language</div><div class="rec-grid">' +
      '<div class="rg"><span class="k">What the agent decided</span>' + (best ? "Pursue " + esc(best.label) + " as the strongest structural route" + (c.officialPathwayKey ? ", and focus " + esc(c.officialPathwayLabel) : "") + "." : "Awaiting a scan.") + '</div>' +
      '<div class="rg"><span class="k">Why</span>' + (best ? esc(best.why || (best.for && best.for[0]) || best.structuralNotes || "Highest structural fit for your profile.") : "\u2014") + '</div>' +
      '<div class="rg"><span class="k">Alternatives rejected</span>' + (rej.length ? esc(rej.map(function (r) { return r.label; }).slice(0, 4).join(", ")) : "None fully rejected.") + '</div>' +
      '<div class="rg"><span class="k">Information still missing</span>' + (mi.length ? esc(mi.slice(0, 3).map(function (m) { return m.item; }).join(", ")) : "Nothing critical.") + '</div>' +
      '<div class="rg"><span class="k">Confidence</span>' + esc(conf) + '</div>' +
      '<div class="rg"><span class="k">Next action</span>' + esc(c.nextBestAction) + '</div>' +
      '</div></div>';
  }

  function scanLoop() {
    var steps = ["Reading your case file", "Detecting pathway families", "Scoring & ranking routes", "Compiling risks", "Writing recommendations"];
    return '<ul class="loop">' + steps.map(function (s, i) { return '<li class="' + (i === 0 ? "active" : "") + '"><span class="ldot">' + (i + 1) + '</span>' + esc(s) + (i === 0 ? ' <span class="spinner dark" style="margin-left:6px"></span>' : "") + '</li>'; }).join("") + '</ul>';
  }

  function pwCard(p) {
    var miss = (p.missing && p.missing.length) ? '<div class="pw-missing"><b>Still needed:</b> ' + esc(p.missing.slice(0, 3).join("; ")) + '</div>' : "";
    var forLine = p.why || p.for[0] || p.structuralNotes || "";
    var againstLine = p.whyNot || p.against[0] || "";
    return '<div class="pw-card' + (p.status === "na" ? " rejected" : "") + '">' +
      '<div class="pw-top"><h4>' + esc(p.label) + '</h4><span class="pw-score mono">' + p.score + '</span></div>' +
      '<div class="pw-meta"><span class="chip ' + p.statusChip + '">' + esc(p.statusLabel) + '</span>' + (p.confidence ? '<span class="chip chip-muted">' + esc(p.confidence) + ' confidence</span>' : "") + '</div>' +
      (forLine ? '<div class="pw-line"><b>For:</b> ' + esc(forLine) + '</div>' : "") +
      (againstLine ? '<div class="pw-line against"><b>Against:</b> ' + esc(againstLine) + '</div>' : "") +
      miss +
      '<div style="margin-top:4px"><button class="btn btn-ghost btn-sm" data-select="' + esc(p.key) + '">Focus this route</button></div>' +
      '</div>';
  }

  function recCard(c, r, i) {
    var label = labelForKey(c, r.key) || r.key;
    var docs = list(r.likelyDocuments);
    return '<div class="rec-card"><div class="rec-rank">Recommended #' + (r.rank || i + 1) + '</div><h4>' + esc(label) + '</h4>' +
      (r.why ? '<p>' + esc(r.why) + '</p>' : "") +
      '<div class="rec-grid">' +
        (r.viability ? '<div class="rg"><span class="k">What makes it viable</span>' + esc(r.viability) + '</div>' : "") +
        (r.blockers ? '<div class="rg"><span class="k">What could block it</span>' + esc(r.blockers) + '</div>' : "") +
        (docs.length ? '<div class="rg"><span class="k">Documents likely needed</span>' + esc(docs.join(", ")) + '</div>' : "") +
        (r.verifyOfficially ? '<div class="rg"><span class="k">Verify officially</span>' + esc(r.verifyOfficially) + '</div>' : "") +
      '</div>' +
      '<div style="margin-top:12px"><button class="btn btn-primary btn-sm" data-select="' + esc(r.key) + '">Select &amp; get official source →</button></div>' +
      '</div>';
  }

  /* official source block + finder (improvements #1, #8) */
  function sourceStatusOf(c) {
    if (c.groundedChecklist) return { key: "grounded", label: "Checklist grounded", step: 4 };
    if (c.officialSourceText && c.officialSourceText.length > 40) return { key: "text_pasted", label: "Source text pasted", step: 3 };
    if (c.sourceStatus === "search_opened") return { key: "search_opened", label: "Search opened", step: 2 };
    return { key: "not_searched", label: "Not searched", step: 1 };
  }
  function sourceBlock(c, scanning) {
    if (!c.officialPathwayKey) {
      return '<p class="muted">Pick a recommended route above (or “Focus this route”) to load its official-source step here.</p>';
    }
    var p = (c.pathwayScan || []).filter(function (x) { return x.key === c.officialPathwayKey; })[0] || { label: c.officialPathwayLabel, sourceSearch: "", officialDomains: [] };
    var domains = p.officialDomains || countryRules(c.target.country).officialDomains || [];
    var queries = [];
    if (p.sourceSearch) queries.push(p.sourceSearch);
    domains.forEach(function (d) { queries.push("site:" + d + " " + (p.label || "") + " requirements"); });
    if (!queries.length) queries.push((c.target.country || "") + " " + (p.label || "") + " official requirements");
    var links = queries.slice(0, 4).map(function (q) {
      return '<a href="https://www.google.com/search?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener" data-source-search="1">' + esc(q) + '</a>';
    }).join("");

    /* status stepper */
    var st = sourceStatusOf(c);
    var steps = ["Not searched", "Search opened", "Source text pasted", "Checklist grounded"];
    var stepper = '<div class="src-status">' + steps.map(function (s, i) {
      var n = i + 1, cls = n < st.step ? "done" : n === st.step ? "current" : "";
      return '<span class="ss ' + cls + '"><i>' + (n < st.step ? "\u2713" : n) + '</i>' + esc(s) + '</span>';
    }).join("") + '</div>';

    /* finder panel */
    var finder = '<div class="source-finder">' +
      '<div class="sf-head"><b>Find the official source</b><span class="chip chip-brass">' + esc(st.label) + '</span></div>' +
      (domains.length ? '<div class="sf-domains"><span class="muted" style="font-size:12px">Trust only:</span> ' + domains.map(function (d) { return '<span class="chip chip-ok">' + esc(d) + '</span>'; }).join("") + '</div>' : "") +
      '<p class="sf-warn">\u26a0 Use the official government domain only. Ignore agencies, blogs, forums and ad results — they are often outdated or wrong.</p>' +
      '<div class="src-links">' + links + '</div>' +
      '</div>';

    var grounded = c.groundedChecklist;
    var groundedHtml = grounded ? renderGrounded(grounded) : "";

    /* quality meter for pasted text */
    var sq = (c.officialSourceText && c.officialSourceText.length > 40) ? sourceQuality(c.officialSourceText, p, c) : null;
    var qualityHtml = "";
    if (sq) {
      var qchip = sq.score >= 70 ? "chip-ok" : sq.score >= 45 ? "chip-warn" : "chip-bad";
      qualityHtml = '<div class="quality"><div class="q-head"><b>Source quality</b><span class="chip ' + qchip + '">' + sq.score + '/100 \u00b7 ' + esc(sq.band) + '</span></div>' +
        '<ul class="q-signals">' + sq.signals.map(function (s) { return '<li class="' + (s.ok ? "ok" : "no") + '"><span class="qm">' + (s.ok ? "\u2713" : "\u2715") + '</span>' + esc(s.label) + '</li>'; }).join("") + '</ul>' +
        (sq.guidance.length ? '<div class="q-guide"><b>To strengthen it:</b><ul>' + sq.guidance.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join("") + '</ul></div>' : "") +
        '</div>';
    }

    return stepper + finder +
      '<div class="source-box">' +
      '<div style="font-weight:600;color:var(--navy-deep)">Focused route: ' + esc(p.label || c.officialPathwayLabel) + '</div>' +
      '<ol class="src-steps"><li>Open the official government page for this route.</li><li>Copy the eligibility and document-requirement text.</li><li>Paste it below and generate a grounded checklist.</li></ol>' +
      '<textarea id="source-text" class="notes-area" placeholder="Paste the official eligibility & document requirements here…">' + esc(c.officialSourceText || "") + '</textarea>' +
      qualityHtml +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-primary btn-sm" id="ground-btn"' + (scanning ? " disabled" : "") + '>Generate grounded checklist</button>' +
        (grounded ? '<button class="btn btn-ghost btn-sm" data-act="add-grounded-docs">Add documents to checklist</button>' : "") +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">The checklist is built only from the text you paste. Anything not in it is marked “not found”.</p>' +
      '</div>' + groundedHtml;
  }

  function renderGrounded(g) {
    var blocks = [
      ["eligibility", "Eligibility requirements"], ["documents", "Required documents"], ["optionalDocuments", "Optional supporting documents"],
      ["sponsorDocuments", "Sponsor / host documents"], ["applicantActions", "Applicant actions"], ["deadlines", "Deadlines / validity"],
      ["fees", "Fees (from source only)"], ["forms", "Forms (from source only)"], ["unclear", "Unclear / ambiguous"],
      ["questions", "Questions to verify"], ["riskWarnings", "Risk warnings"]
    ];
    var out = '<div style="margin-top:14px"><div class="subhead" style="margin-top:0">Grounded checklist — from your pasted source</div>';
    blocks.forEach(function (b) {
      var items = list(g[b[0]]); if (!items.length) return;
      out += '<div class="gc-block"><h4>' + esc(b[1]) + '</h4><ul class="gc-list">' +
        items.map(function (it) { var nf2 = /not found in pasted/i.test(it); return '<li class="' + (nf2 ? "notfound" : "") + '">' + esc(it) + '</li>'; }).join("") +
        '</ul></div>';
    });
    out += '</div>';
    return out;
  }

  /* documents */
  var DOC_STATUS = [["not_started", "Not started"], ["requested", "Requested"], ["collected", "Collected"], ["translated", "Translated"], ["apostilled", "Apostilled / legalised"], ["submitted", "Submitted"]];
  function documentsBlock(c) {
    var rows = (c.documents || []).map(function (d, i) {
      return '<div class="doc-row"><input class="doc-check" type="checkbox" data-doc-toggle="' + i + '"' + ((d.status === "collected" || d.status === "submitted" || d.status === "translated" || d.status === "apostilled") ? " checked" : "") + ' />' +
        '<div class="doc-main"><div class="dn">' + esc(d.name) + '</div>' + (d.who ? '<div class="dm">' + esc(d.who) + (d.risk ? " · risk if missing: " + esc(d.risk) : "") + '</div>' : "") + '</div>' +
        '<select class="doc-status" data-doc-status="' + i + '">' + DOC_STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (d.status === s[0] ? " selected" : "") + '>' + s[1] + '</option>'; }).join("") + '</select>' +
        '<button class="doc-del" data-doc-del="' + i + '" title="Remove">✕</button></div>';
    }).join("");
    if (!rows) rows = '<p class="muted">No documents yet. Generate a grounded checklist above, or add documents manually.</p>';
    return rows +
      '<div class="add-doc"><input id="add-doc-input" placeholder="Add a document (e.g. Birth certificate)" /><button class="btn btn-ghost btn-sm" data-act="add-doc">Add</button></div>';
  }

  /* progress */
  function progressBlock(c) {
    var idx = c.progress.stageIndex;
    var stages = STAGES.map(function (s, i) {
      var cls = i < idx ? "done" : (i === idx ? "current" : "");
      var mark = i < idx ? "✓" : (i + 1);
      return '<div class="stage ' + cls + '"><div class="stage-col"><div class="dot">' + mark + '</div>' + (i < STAGES.length - 1 ? '<div class="bar"></div>' : "") + '</div>' +
        '<div class="stage-label">' + esc(s[0]) + '<small>' + esc(s[1]) + '</small></div></div>';
    }).join("");
    return '<div class="stages">' + stages + '</div>' +
      '<div class="stage-actions">' +
        (idx > 0 ? '<button class="btn btn-ghost btn-sm" data-act="stage-back">← Previous stage</button>' : "") +
        (idx < STAGES.length - 1 ? '<button class="btn btn-primary btn-sm" data-act="stage-next">Advance to: ' + esc(STAGES[idx + 1][0]) + ' →</button>' : '<span class="chip chip-ok">Case complete</span>') +
      '</div>';
  }

  function timelineBlock(c, embedded) {
    var steps = ["Complete profile", "Pathway scan", "Official source verification", "Document collection", "Translations / legalisation", "Application preparation", "Submission", "Waiting period", "Follow-up / extra evidence", "Decision"];
    var out = (embedded ? '<div class="subhead">Logical order</div>' : "") + '<ul class="timeline">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join("") + '</ul>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">Exact processing times are shown only if they appear in your pasted official source text.</p>';
    return out;
  }

  /* ----------------------------------------------- post-render wiring (case) */
  function afterCaseRender(c) {
    // ground button
    var gb = $("#ground-btn");
    if (gb) gb.addEventListener("click", function () {
      var ta = $("#source-text"); var txt = ta ? ta.value.trim() : "";
      if (txt.length < 40) { toast("Paste a bit more official text (at least a paragraph)."); return; }
      c.officialSourceText = txt;
      if (c.progress.stageIndex < 3) c.progress.stageIndex = 3;
      logDecision(c, "official source grounding", "Official source text received for " + (c.officialPathwayLabel || "the route") + ".", "Checklist will be built only from this text.", { confidence: "high" });
      saveCase(c);
      gb.disabled = true; gb.innerHTML = 'Grounding <span class="spinner dark" style="margin-left:6px"></span>';
      var p = (c.pathwayScan || []).filter(function (x) { return x.key === c.officialPathwayKey; })[0] || { key: c.officialPathwayKey, label: c.officialPathwayLabel };
      groundChecklist(c, p, txt).then(function (g) {
        if (!g) throw new Error("Could not read a checklist from that text.");
        c.groundedChecklist = g;
        if (c.progress.stageIndex < 4) c.progress.stageIndex = 4;
        logDecision(c, "checklist generation", "Grounded checklist generated from the official source.", "Items not present in the text were marked “not found”.", { confidence: "high" });
        refreshDerived(c); saveCase(c);
        if (state.activeId === c.id) renderCase(getCase(c.id));
        toast("Grounded checklist ready.");
      }).catch(function (err) {
        if (gb) { gb.disabled = false; gb.textContent = "Generate grounded checklist"; }
        toast(err.message || "Grounding failed. Try again.");
      });
    });

    // notes textarea autosave handled by save-notes button (delegated)
  }

  /* add grounded docs into the manual checklist */
  function addGroundedDocs(c) {
    var g = c.groundedChecklist; if (!g) return;
    var names = list(g.documents).concat(list(g.sponsorDocuments)).filter(function (x) { return !/not found in pasted/i.test(x); });
    var existing = (c.documents || []).map(function (d) { return nf(d.name); });
    var added = 0;
    names.forEach(function (n) { if (existing.indexOf(nf(n)) < 0) { c.documents.push({ name: n, who: "", status: "not_started", risk: "" }); added++; } });
    if (added) { if (c.progress.stageIndex < 4) c.progress.stageIndex = 4; logDecision(c, "document tracking", "Added " + added + " document(s) from the grounded checklist.", "", { confidence: "high" }); refreshDerived(c); saveCase(c); renderCase(getCase(c.id)); toast(added + " document(s) added."); }
    else toast("Those documents are already in your checklist.");
  }

  /* ---------------------------------------------------- selecting a route */
  function selectRoute(c, key) {
    var p = (c.pathwayScan || []).filter(function (x) { return x.key === key; })[0];
    if (!p) return;
    c.officialPathwayKey = key; c.officialPathwayLabel = p.label;
    if (c.progress.stageIndex < 2) c.progress.stageIndex = 2;
    logDecision(c, "pathway ranking", "Focused route set to " + p.label + ".", "User selected this route to ground and plan.", { confidence: "high", pathway: p.label });
    refreshDerived(c); saveCase(c);
    renderCase(getCase(c.id));
    var s = $("#sec-source"); if (s) { s.open = true; s.scrollIntoView({ behavior: "smooth", block: "start" }); }
    toast("Focused on " + p.label + ". Now paste its official source.");
  }

  /* ------------------------------------------------------- export/import */
  function exportCase(id) {
    var c = getCase(id); if (!c) return;
    var blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "passage-case-" + nf(c.caseName || c.applicant.name || "case").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("Case exported.");
  }
  function importCaseFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var obj = JSON.parse(rd.result);
        if (!obj || !obj.applicant) throw new Error("Not a Passage case file.");
        obj.id = obj.id && !getCase(obj.id) ? obj.id : uid();
        obj.updatedAt = new Date().toISOString();
        refreshDerived(obj); saveCase(obj);
        toast("Case imported."); go("case", obj.id);
      } catch (e) { toast("Could not import: " + (e.message || "invalid file")); }
    };
    rd.readAsText(file);
  }

  /* --------------------------------------------------------------- modals */
  function modal(html) { $("#modal-root").innerHTML = '<div class="modal-back" data-close-modal>' + '<div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>'; }
  function closeModal() { $("#modal-root").innerHTML = ""; }

  function openSamples() {
    var s = sampleSeeds();
    modal('<div class="modal-head"><h3>Start from a sample</h3><button class="icon-btn" data-close-modal style="width:32px;height:32px;border-color:var(--line);background:#fff;color:var(--ink)">✕</button></div>' +
      '<div class="modal-body"><p>Each sample shows the agent reasoning on a real situation. You can edit everything afterwards.</p>' +
      '<div class="sample-list">' + s.map(function (x, i) { return '<button class="sample-btn" data-sample="' + i + '"><b>' + esc(x.title) + '</b><span>' + esc(x.sub) + '</span></button>'; }).join("") + '</div></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-close-modal>Close</button></div>');
  }

  function openInfo(kind) {
    var title, body;
    if (kind === "privacy") {
      title = "Privacy";
      body = '<ul><li>No account, no login, no server database.</li><li>Your cases are stored only in this browser (localStorage).</li><li>When you run the agent, the text you submit is sent to Groq for analysis via a serverless proxy, then discarded — StaGove keeps no copy.</li><li>Avoid entering highly sensitive details unless necessary.</li><li>Export your case if you want a backup — clearing browser storage can delete it.</li></ul>';
    } else if (kind === "autonomy") {
      title = "Why Passage is an agent";
      body = '<ul><li>Collects a structured profile and builds a persistent case file.</li><li>Detects pathway families and rejects unsuitable ones.</li><li>Ranks realistic routes and explains why.</li><li>Identifies missing information and asks for the official source.</li><li>Grounds checklists strictly in that official text.</li><li>Builds a document plan, tracks progress, monitors risk, and always shows the next best action.</li><li>Remembers where you stopped and continues from there.</li></ul>';
    } else {
      title = "Not legal advice";
      body = '<p>' + esc(DISCLAIMER) + '</p><p>Passage is a triage, planning and organisation tool. It does not replace official government guidance or a licensed immigration professional, and it does not guarantee eligibility.</p>';
    }
    modal('<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close-modal style="width:32px;height:32px;border-color:var(--line);background:#fff;color:var(--ink)">✕</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-act="import-open">Import a case file</button><button class="btn btn-primary" data-close-modal>Got it</button></div>');
  }

  /* ----------------------------------------------------- global handlers */
  document.addEventListener("click", function (e) {
    var t = e.target;
    var a = t.closest("[data-act]"); var actName = a && a.getAttribute("data-act");

    // open / delete / export from cards
    var openId = t.closest("[data-open]"); if (openId && !t.closest("[data-del],[data-export]")) { go("case", openId.getAttribute("data-open")); return; }
    var delId = t.closest("[data-del]"); if (delId) { e.stopPropagation(); var id = delId.getAttribute("data-del"); confirmDelete(id); return; }
    var exId = t.closest("[data-export]"); if (exId) { e.stopPropagation(); exportCase(exId.getAttribute("data-export")); return; }

    var selKey = t.closest("[data-select]"); if (selKey) { var cc = getCase(state.activeId); if (cc) selectRoute(cc, selKey.getAttribute("data-select")); return; }
    var jump = t.closest("[data-jump]"); if (jump) { var s = document.getElementById(jump.getAttribute("data-jump")); if (s) { s.open = true; s.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
    var sampleI = t.closest("[data-sample]"); if (sampleI) { var seed = sampleSeeds()[+sampleI.getAttribute("data-sample")]; closeModal(); var nc = newCase(seed.seed); if (!nc.caseName) nc.caseName = seed.title; saveCase(nc); state.activeId = nc.id; save("passage.activeCaseId", nc.id); state.route = "case"; render(); triggerScan(nc.id); return; }

    if (t.closest("[data-close-modal]")) { closeModal(); return; }

    // official-source search link opened → advance source status (does not preventDefault; link still opens)
    var ssrch = t.closest("[data-source-search]");
    if (ssrch) {
      var cs = getCase(state.activeId);
      if (cs && !(cs.officialSourceText && cs.officialSourceText.length > 40) && cs.sourceStatus !== "search_opened") {
        cs.sourceStatus = "search_opened";
        logDecision(cs, "official source grounding", "Opened an official-source search for " + (cs.officialPathwayLabel || "the route") + ".", "Guiding you to the correct government page before any checklist is built.", { confidence: "high" });
        saveCase(cs);
      }
      return;
    }

    // document interactions
    var dToggle = t.closest("[data-doc-toggle]"); if (dToggle) { var ci = getCase(state.activeId); var di = +dToggle.getAttribute("data-doc-toggle"); ci.documents[di].status = dToggle.checked ? "collected" : "not_started"; logDecision(ci, "document tracking", "Marked “" + ci.documents[di].name + "” as " + ci.documents[di].status + ".", ""); refreshDerived(ci); saveCase(ci); renderCase(getCase(ci.id)); return; }
    var dDel = t.closest("[data-doc-del]"); if (dDel) { var c2 = getCase(state.activeId); c2.documents.splice(+dDel.getAttribute("data-doc-del"), 1); refreshDerived(c2); saveCase(c2); renderCase(getCase(c2.id)); return; }

    if (!actName) return;
    var c = getCase(state.activeId);
    switch (actName) {
      case "new": draft = newCase(); state.editId = null; go("intake"); break;
      case "samples": openSamples(); break;
      case "cancel-intake": draft = null; state.editId = null; go("dashboard"); break;
      case "edit": state.editId = state.activeId; go("intake"); break;
      case "rescan": if (c) triggerScan(c.id); break;
      case "run-review": if (c) { var rv = runCaseReview(c); renderCase(getCase(c.id)); toast(rv.noChange ? "Review complete — no major change." : "Case review complete."); var rs = $("#sec-review"); if (rs) { rs.open = true; } } break;
      case "export-active": if (c) exportCase(c.id); break;
      case "save-notes": if (c) { var na = $("#notes-area"); c.notes = na ? na.value : ""; saveCase(c); toast("Notes saved."); } break;
      case "add-doc": { var inp = $("#add-doc-input"); if (inp && inp.value.trim()) { c.documents.push({ name: inp.value.trim(), who: "", status: "not_started", risk: "" }); if (c.progress.stageIndex < 4) c.progress.stageIndex = 4; refreshDerived(c); saveCase(c); renderCase(getCase(c.id)); } break; }
      case "add-grounded-docs": if (c) addGroundedDocs(c); break;
      case "stage-next": if (c && c.progress.stageIndex < STAGES.length - 1) { c.progress.stageIndex++; logDecision(c, "progress update", "Advanced to “" + STAGES[c.progress.stageIndex][0] + "”.", "", { next: computeNextAction(c) }); refreshDerived(c); saveCase(c); renderCase(getCase(c.id)); } break;
      case "stage-back": if (c && c.progress.stageIndex > 0) { c.progress.stageIndex--; refreshDerived(c); saveCase(c); renderCase(getCase(c.id)); } break;
      case "toggle-self": { var sf = t.closest(".section"); if (sf) sf.classList.toggle("open-self"); var b = t.parentNode.querySelector(".s-body"); break; }
      case "import-open": closeModal(); doImport(); break;
    }
  });

  // document status dropdown (delegated change)
  document.addEventListener("change", function (e) {
    var sel = e.target.closest && e.target.closest("[data-doc-status]");
    if (!sel) return;
    var c = getCase(state.activeId); if (!c) return;
    var di = +sel.getAttribute("data-doc-status");
    var d = c.documents[di]; if (!d) return;
    var label = (function () { for (var k = 0; k < DOC_STATUS.length; k++) if (DOC_STATUS[k][0] === sel.value) return DOC_STATUS[k][1]; return sel.value; })();
    d.status = sel.value;
    logDecision(c, "document tracking", "Set “" + d.name + "” to " + label + ".", "");
    if (c.progress.stageIndex < 5 && (d.status === "collected" || d.status === "submitted" || d.status === "translated" || d.status === "apostilled")) c.progress.stageIndex = Math.max(c.progress.stageIndex, 5);
    refreshDerived(c); saveCase(c); renderCase(getCase(c.id));
  });

  function confirmDelete(id) {
    var c = getCase(id); if (!c) return;
    modal('<div class="modal-head"><h3>Delete this case?</h3></div><div class="modal-body"><p>“' + esc(c.caseName || c.applicant.name || "Untitled") + '” will be permanently removed from this device. Export it first if you want a backup.</p></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-danger" id="confirm-del">Delete case</button></div>');
    $("#confirm-del").addEventListener("click", function () { deleteCase(id); closeModal(); go("dashboard"); toast("Case deleted."); });
  }

  function doImport() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
    inp.addEventListener("change", function () { if (inp.files && inp.files[0]) importCaseFile(inp.files[0]); });
    inp.click();
  }

  // intake run button (delegated via id, but bound on render too)
  document.addEventListener("click", function (e) {
    if (e.target.closest("#run-scan-btn")) { e.preventDefault(); startScan(); }
  });

  /* top bar + footer nav */
  function wireChrome() {
    $("#brand-home").addEventListener("click", function () { go("dashboard"); });
    $("#nav-new").addEventListener("click", function () { draft = newCase(); state.editId = null; go("intake"); });
    $("#nav-cases").addEventListener("click", function () { go("dashboard"); });
    $("#nav-info").addEventListener("click", function () { openInfo("privacy"); });
    $("#foot-autonomy").addEventListener("click", function () { openInfo("autonomy"); });
    $("#foot-privacy").addEventListener("click", function () { openInfo("privacy"); });
    $("#foot-disclaimer").addEventListener("click", function () { openInfo("disclaimer"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* --------------------------------------------------------------- PWA */
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; var b = $("#install-btn"); if (b) b.classList.remove("hidden"); });
  function wireInstall() {
    var b = $("#install-btn"); if (!b) return;
    b.addEventListener("click", function () { if (!deferredPrompt) { toast("Use your browser menu → Install / Add to Home Screen."); return; } deferredPrompt.prompt(); deferredPrompt.userChoice.finally(function () { deferredPrompt = null; b.classList.add("hidden"); }); });
  }
  if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("service-worker.js").catch(function () {}); });

  /* --------------------------------------------------------------- boot */
  function boot() {
    wireChrome(); wireInstall();
    state.activeId = load("passage.activeCaseId") || null;
    // start on dashboard for clarity
    state.route = "dashboard";
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
