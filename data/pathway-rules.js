/* ============================================================================
   Passage by StaGove — Country Pathway Rules Layer
   ----------------------------------------------------------------------------
   This is NOT a legal database. It is a lightweight STRUCTURAL map used only for
   triage: which pathway *families* generally exist for a destination, the rough
   structural logic of each, and where the official source lives. Exact fees,
   forms, quotas, processing times and document rules are deliberately NOT here —
   those must come from official source text the user pastes into the app.

   Assigned to window.PATHWAY_RULES so it loads with a plain <script> tag,
   no build step and no module resolution needed.
   ========================================================================== */

window.PATHWAY_RULES = {
  "United States": {
    officialDomains: ["uscis.gov", "travel.state.gov"],
    notes: "Family petitions are limited to specific close relationships of a US citizen or green-card holder. Most work routes need an employer. Visitor status does not normally authorise work.",
    cautionNotes: "Extended relatives (uncle, aunt, cousin, friend) are not normally direct petition categories. Annual caps and waiting lines apply to several routes — verify officially.",
    pathways: {
      visitor:  { label: "Visitor visa (B-1/B-2)", structuralNotes: "For temporary visits or tourism. Does not normally authorise work or study. Strong ties to home country usually help.", sourceSearch: "site:travel.state.gov visitor visa B-2 requirements" },
      student:  { label: "Student visa (F-1)", structuralNotes: "Usually requires admission to an approved school and proof of funds. Limited work rights tied to the programme.", sourceSearch: "site:travel.state.gov student visa F-1 requirements" },
      work:     { label: "Work visa / employment sponsorship", structuralNotes: "Usually requires an employer petition or a qualifying employment category. Several categories are capped annually.", sourceSearch: "site:uscis.gov temporary workers nonimmigrant" },
      family:   { label: "Family sponsorship", structuralNotes: "A US citizen or green-card holder may petition only for specific close relatives (spouse, parent, child, sibling). Extended relatives generally do not qualify.", sourceSearch: "site:uscis.gov family based immigration" },
      spouse:   { label: "Spouse / fiancé(e) route", structuralNotes: "Marriage or engagement to a US citizen or resident is usually a recognised close-family route; relationship evidence is central.", sourceSearch: "site:uscis.gov spouse of US citizen" },
      investor: { label: "Investor / business route", structuralNotes: "Investment-based routes exist but require substantial capital and qualifying business activity.", sourceSearch: "site:uscis.gov immigrant investor EB-5" },
      pr:       { label: "Permanent residency (Green Card)", structuralNotes: "Usually reached through an approved family, employment, or other qualifying category rather than applied for directly.", sourceSearch: "site:uscis.gov green card eligibility" }
    }
  },

  "Canada": {
    officialDomains: ["canada.ca"],
    notes: "Points-based economic routes (Express Entry) reward age, education, language and work experience. Study and work routes are well defined. Family sponsorship covers close relatives.",
    cautionNotes: "Program criteria and draws change frequently. Verify current eligibility and document lists on canada.ca.",
    pathways: {
      visitor:  { label: "Visitor visa / eTA", structuralNotes: "For temporary visits. Does not normally authorise work or long-term study.", sourceSearch: "site:canada.ca visitor visa eligibility" },
      student:  { label: "Study permit", structuralNotes: "Usually requires a letter of acceptance from a designated learning institution and proof of funds.", sourceSearch: "site:canada.ca study permit eligibility" },
      work:     { label: "Work permit", structuralNotes: "Usually requires a job offer and often a labour-market assessment, with some exemptions.", sourceSearch: "site:canada.ca work permit eligibility" },
      skilled:  { label: "Skilled migration (Express Entry)", structuralNotes: "Points-based; strongest for younger applicants with higher education, language scores and skilled experience.", sourceSearch: "site:canada.ca express entry eligibility" },
      family:   { label: "Family sponsorship", structuralNotes: "Citizens and permanent residents may sponsor specific close relatives such as spouse, partner, dependent children and parents.", sourceSearch: "site:canada.ca sponsor family member" },
      pr:       { label: "Permanent residency", structuralNotes: "Reached through economic, family or other qualifying programs.", sourceSearch: "site:canada.ca permanent resident eligibility" }
    }
  },

  "United Kingdom": {
    officialDomains: ["gov.uk"],
    notes: "Most work routes are points-based and require a licensed sponsor. Study routes need an approved sponsor and funds. Family routes have income and relationship rules.",
    cautionNotes: "Salary thresholds, sponsor lists and fees change often. Verify on gov.uk.",
    pathways: {
      visitor:  { label: "Standard visitor visa", structuralNotes: "For tourism or short visits. Does not normally authorise work or long courses.", sourceSearch: "site:gov.uk standard visitor visa" },
      student:  { label: "Student visa", structuralNotes: "Usually requires a confirmed place with a licensed student sponsor and proof of funds and English.", sourceSearch: "site:gov.uk student visa eligibility" },
      work:     { label: "Skilled Worker visa", structuralNotes: "Points-based; usually requires a job offer from a licensed sponsor at the required skill and salary level.", sourceSearch: "site:gov.uk skilled worker visa eligibility" },
      family:   { label: "Family visa", structuralNotes: "For partners, children or relatives of someone settled in the UK; relationship and financial requirements apply.", sourceSearch: "site:gov.uk family visa" },
      ancestry: { label: "UK Ancestry visa", structuralNotes: "For Commonwealth citizens with a grandparent born in the UK who plan to work. Ancestry evidence is central.", sourceSearch: "site:gov.uk uk ancestry visa" },
      pr:       { label: "Settlement (Indefinite Leave to Remain)", structuralNotes: "Usually reached after a qualifying period on an eligible route.", sourceSearch: "site:gov.uk indefinite leave to remain" }
    }
  },

  "Germany": {
    officialDomains: ["make-it-in-germany.com", "auswaertiges-amt.de", "bamf.de"],
    notes: "EU Blue Card and skilled-worker routes reward recognised qualifications and a job offer. Study routes are well established. EU citizens have free movement.",
    cautionNotes: "Qualification recognition and salary thresholds matter and change. Verify on official German government sources.",
    pathways: {
      visitor:  { label: "Schengen visitor visa", structuralNotes: "Short stays in the Schengen area for tourism or business; does not authorise long-term work.", sourceSearch: "site:auswaertiges-amt.de schengen visa requirements" },
      student:  { label: "Student visa / residence permit", structuralNotes: "Usually requires university admission and proof of funds (often a blocked account).", sourceSearch: "site:make-it-in-germany.com student visa" },
      work:     { label: "Work visa / skilled worker", structuralNotes: "Usually requires a recognised qualification and a job offer; recognition of foreign credentials is often required.", sourceSearch: "site:make-it-in-germany.com skilled workers visa" },
      blue_card:{ label: "EU Blue Card", structuralNotes: "For higher-qualified workers with a qualifying job offer at or above a salary threshold.", sourceSearch: "site:make-it-in-germany.com eu blue card" },
      family:   { label: "Family reunion", structuralNotes: "Spouses and minor children of residents may join under relationship and accommodation rules.", sourceSearch: "site:make-it-in-germany.com family reunification" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens generally do not need a visa to live and work; registration may apply.", sourceSearch: "site:europa.eu free movement EU citizens" },
      ancestry: { label: "Citizenship by descent / restoration", structuralNotes: "German citizenship can pass by descent or be restored in specific historical cases; documentary proof is central.", sourceSearch: "site:bva.bund.de german citizenship by descent" }
    }
  },

  "Bulgaria": {
    officialDomains: ["mfa.bg", "migration.bg"],
    notes: "As an EU member, EU citizens have free movement. Non-EU routes include work, study, family and long-term residence. Citizenship by descent/origin exists with documentary proof.",
    cautionNotes: "Bulgarian-origin and descent claims need solid documents. Verify on official Bulgarian sources.",
    pathways: {
      visitor:  { label: "Short-stay (Schengen) visa", structuralNotes: "Short visits; does not authorise long-term work or residence.", sourceSearch: "site:mfa.bg short stay visa Bulgaria" },
      student:  { label: "Student residence", structuralNotes: "Usually requires admission to a Bulgarian institution and proof of means.", sourceSearch: "site:mfa.bg long stay visa study Bulgaria" },
      work:     { label: "Work / long-stay visa", structuralNotes: "Usually requires a job and a long-stay visa followed by a residence permit.", sourceSearch: "site:mfa.bg long stay visa work Bulgaria" },
      family:   { label: "Family reunification", structuralNotes: "Close relatives of residents may join under relationship rules.", sourceSearch: "site:migration.bg family reunification Bulgaria" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens may live and work with registration rather than a visa.", sourceSearch: "site:europa.eu EU citizen rights Bulgaria" },
      ancestry: { label: "Citizenship by Bulgarian origin / descent", structuralNotes: "Persons of Bulgarian origin may have a facilitated route; documentary proof of origin is central.", sourceSearch: "site:mfa.bg Bulgarian citizenship by origin" }
    }
  },

  "Australia": {
    officialDomains: ["immi.homeaffairs.gov.au"],
    notes: "Points-based skilled migration rewards age, English, qualifications and experience. Study and work routes are well defined. Family routes cover partners and close relatives.",
    cautionNotes: "Occupation lists, points tests and caps change regularly. Verify on the Department of Home Affairs site.",
    pathways: {
      visitor:  { label: "Visitor visa", structuralNotes: "For tourism or short visits; does not normally authorise work.", sourceSearch: "site:immi.homeaffairs.gov.au visitor visa" },
      student:  { label: "Student visa", structuralNotes: "Usually requires enrolment with a registered provider and proof of funds and English.", sourceSearch: "site:immi.homeaffairs.gov.au student visa 500" },
      work:     { label: "Skilled / employer-sponsored work", structuralNotes: "Routes may need employer sponsorship or a skills assessment in a listed occupation.", sourceSearch: "site:immi.homeaffairs.gov.au skilled visa" },
      skilled:  { label: "Points-based skilled migration", structuralNotes: "Points test rewards younger age, strong English, qualifications and skilled experience.", sourceSearch: "site:immi.homeaffairs.gov.au points tested skilled" },
      family:   { label: "Partner / family visa", structuralNotes: "Partners and close relatives of citizens or residents may apply under relationship rules.", sourceSearch: "site:immi.homeaffairs.gov.au partner visa" }
    }
  },

  "Ireland": {
    officialDomains: ["irishimmigration.ie", "dfa.ie"],
    notes: "EU citizens have free movement. Work permits target skills shortages. Citizenship by descent (foreign birth registration) is a notable route for those with an Irish grandparent.",
    cautionNotes: "Foreign birth registration requires a documented chain back to the Irish-born ancestor. Verify officially.",
    pathways: {
      visitor:  { label: "Short-stay visa", structuralNotes: "For short visits; does not authorise long-term work.", sourceSearch: "site:irishimmigration.ie short stay visa Ireland" },
      student:  { label: "Student permission", structuralNotes: "Usually requires enrolment and proof of funds.", sourceSearch: "site:irishimmigration.ie study in Ireland" },
      work:     { label: "Employment permit", structuralNotes: "Usually requires a job offer; critical-skills and general permits exist.", sourceSearch: "site:enterprise.gov.ie employment permits Ireland" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens may live and work without a visa.", sourceSearch: "site:europa.eu EU citizen rights Ireland" },
      ancestry: { label: "Citizenship by descent (Foreign Birth Registration)", structuralNotes: "Those with an Irish-born grandparent may claim citizenship by descent; an unbroken documentary chain is central.", sourceSearch: "site:dfa.ie foreign birth registration Irish descent" }
    }
  },

  "Italy": {
    officialDomains: ["esteri.it", "interno.gov.it"],
    notes: "EU citizens have free movement. Citizenship by descent (jure sanguinis) is a major route for those with Italian ancestors. Work and study routes exist with quotas.",
    cautionNotes: "Jure sanguinis depends on an unbroken line and rules on when an ancestor naturalised. Recent changes may apply — verify officially.",
    pathways: {
      visitor:  { label: "Schengen visitor visa", structuralNotes: "Short stays; does not authorise long-term work.", sourceSearch: "site:esteri.it schengen visa Italy" },
      student:  { label: "Student visa", structuralNotes: "Usually requires admission and proof of means.", sourceSearch: "site:esteri.it student visa Italy" },
      work:     { label: "Work visa (within quotas)", structuralNotes: "Often tied to annual quota decrees and an employer; verify current openings.", sourceSearch: "site:esteri.it work visa Italy decreto flussi" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens may live and work with registration.", sourceSearch: "site:europa.eu EU citizen rights Italy" },
      ancestry: { label: "Citizenship by descent (jure sanguinis)", structuralNotes: "Italian citizenship can pass through the bloodline; a documented, unbroken chain to an Italian ancestor is central.", sourceSearch: "site:esteri.it italian citizenship by descent jure sanguinis" }
    }
  },

  "Spain": {
    officialDomains: ["exteriores.gob.es", "inclusion.gob.es"],
    notes: "EU citizens have free movement. Spain offers work, study, non-lucrative and digital-nomad routes. Citizenship by descent/origin exists in specific cases.",
    cautionNotes: "Income thresholds and route conditions change. Verify on official Spanish government sources.",
    pathways: {
      visitor:  { label: "Schengen visitor visa", structuralNotes: "Short stays; does not authorise long-term work.", sourceSearch: "site:exteriores.gob.es schengen visa Spain" },
      student:  { label: "Student visa", structuralNotes: "Usually requires admission and proof of means.", sourceSearch: "site:exteriores.gob.es student visa Spain" },
      work:     { label: "Work / residence visa", structuralNotes: "Usually requires a job offer or qualifying activity.", sourceSearch: "site:exteriores.gob.es work residence visa Spain" },
      digital_nomad: { label: "Digital nomad visa", structuralNotes: "For remote workers meeting income and activity conditions.", sourceSearch: "site:exteriores.gob.es digital nomad visa Spain" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens may live and work with registration.", sourceSearch: "site:europa.eu EU citizen rights Spain" },
      ancestry: { label: "Citizenship by origin / descent", structuralNotes: "Specific descent and historical-origin routes exist; documentary proof is central.", sourceSearch: "site:exteriores.gob.es spanish nationality by origin" }
    }
  },

  "France": {
    officialDomains: ["france-visas.gouv.fr", "service-public.fr"],
    notes: "EU citizens have free movement. France offers work, study, talent and visitor long-stay routes. Family routes cover close relatives.",
    cautionNotes: "Conditions and thresholds vary by route and change. Verify on france-visas and service-public.",
    pathways: {
      visitor:  { label: "Short-stay (Schengen) visa", structuralNotes: "Short visits; does not authorise long-term work.", sourceSearch: "site:france-visas.gouv.fr short stay visa France" },
      student:  { label: "Student visa", structuralNotes: "Usually requires admission and proof of means.", sourceSearch: "site:france-visas.gouv.fr student visa France" },
      work:     { label: "Work / talent passport", structuralNotes: "Routes may need a job offer or qualifying talent category.", sourceSearch: "site:france-visas.gouv.fr talent passport France" },
      family:   { label: "Family route", structuralNotes: "Close relatives of residents may join under relationship rules.", sourceSearch: "site:service-public.fr family reunification France" },
      eu_free:  { label: "EU free movement", structuralNotes: "EU/EEA citizens may live and work with registration.", sourceSearch: "site:europa.eu EU citizen rights France" }
    }
  }
};

/* A generic fallback set for destinations not in the map above. */
window.GENERIC_PATHWAYS = {
  visitor:  { label: "Visitor / short-stay visa", structuralNotes: "For temporary visits. Does not normally authorise work or long-term stay.", sourceSearch: "official visitor visa requirements" },
  student:  { label: "Student visa", structuralNotes: "Usually requires admission to a recognised institution and proof of funds.", sourceSearch: "official student visa requirements" },
  work:     { label: "Work visa / employment route", structuralNotes: "Usually requires a job offer or qualifying employment category.", sourceSearch: "official work visa requirements" },
  family:   { label: "Family sponsorship", structuralNotes: "Usually limited to close relationships of a citizen or resident.", sourceSearch: "official family visa requirements" },
  ancestry: { label: "Citizenship / residence by descent", structuralNotes: "Some countries grant status through ancestry; documentary proof of the family line is central.", sourceSearch: "official citizenship by descent" },
  pr:       { label: "Permanent residency", structuralNotes: "Usually reached through a qualifying family, work or other route over time.", sourceSearch: "official permanent residence requirements" }
};

window.COUNTRY_LIST = Object.keys(window.PATHWAY_RULES);
