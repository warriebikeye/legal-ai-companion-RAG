// src/services/jurisdiction.service.js
//
// Detects which jurisdiction(s) a query concerns, purely from the
// query text — regardless of whatever country is selected in the
// UI dropdown. Pure keyword matching against SUPPORTED_COUNTRIES;
// no LLM call, negligible latency.

import { SUPPORTED_COUNTRIES } from "../config/countries.js";

const MAX_JURISDICTIONS = 3;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[JURISDICTION] [${timestamp}] ${step}`, data)
    : console.log(`[JURISDICTION] [${timestamp}] ${step}`);
}

/* =========================================================
   FIND MENTIONS
   Returns each matched country's canonical name + the earliest
   position it was mentioned at (for stable "first named" ordering).
========================================================= */
function findMentionedCountries(query = "") {
  const lower = query.toLowerCase();
  const mentions = [];

  for (const country of SUPPORTED_COUNTRIES) {
    let earliestIndex = -1;

    for (const alias of country.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = lower.match(new RegExp(`\\b${escaped}\\b`));
      if (match && (earliestIndex === -1 || match.index < earliestIndex)) {
        earliestIndex = match.index;
      }
    }

    if (earliestIndex !== -1) {
      mentions.push({ name: country.name, slug: country.slug, index: earliestIndex });
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

/* =========================================================
   DETECT JURISDICTIONS

   - 0 mentioned  → fall back to the dropdown-selected country
                    (today's exact behavior).
   - 1 mentioned  → use it, overriding the dropdown if different
                    (the query is more specific than ambient UI state).
   - 2+ mentioned → multi-jurisdiction mode, capped at 3.
========================================================= */
export function detectJurisdictions(query, fallbackCountry) {
  const mentions = findMentionedCountries(query);

  if (mentions.length === 0) {
    return { mode: "single", countries: [{ name: fallbackCountry, slug: fallbackCountry.toLowerCase() }] };
  }

  if (mentions.length === 1) {
    const [{ name, slug }] = mentions;
    log("Single jurisdiction detected from query text", { name });
    return { mode: "single", countries: [{ name, slug }] };
  }

  const capped = mentions.slice(0, MAX_JURISDICTIONS);
  log("Multi-jurisdiction query detected", { countries: capped.map((c) => c.name) });
  return { mode: "multi", countries: capped.map(({ name, slug }) => ({ name, slug })) };
}
