/* TDI Index — interactive site logic (v6).
 *
 * Figure types:
 *   global_tdi        → global line chart
 *   global_gainloss   → global stacked-bar chart
 *   global_interp     → interpretation chart
 *   disagg            → unified disaggregated figure
 *
 * NEW ROUTING MODEL (v6) — "All = breakdown, Specific = filter".
 *
 * Each level has three states:
 *   Select   (null)      → inert. No breakdown, no filter.
 *   Specific (a value)   → filters the data to that value.
 *   All      ('__all__') → breaks the chart down into this level's children.
 *
 * Two lines:
 *   By geography: Income → Region → Country
 *   By industry : Sector → Product
 * Country and Sector are multi-select (cap 10); a 2+ selection is a
 * "comparison" breakdown.
 *
 * Axis precedence (first match wins):
 *   1. Country multi-select (2+)  → comparison; any other All becomes a filter.
 *   2. Sector multi-select (2+)   → comparison; any other All becomes a filter.
 *   3. Both Country(2+) AND Sector(2+) → BLOCKED (ask user to narrow one).
 *   4. Exactly one All            → that level is the breakdown axis.
 *   5. Two or more All (no 2+ multi) → BLOCKED (one All at a time).
 *   6. No axis                    → single bar for the deepest Specific pick;
 *                                    if everything is Select → default 3 income bars.
 *
 * Specifics never create an axis — only All or a 2+ multi-select does.
 * All breakdown axes are capped at top-10 by TDI.
 *
 * Single country picked → Income & Region auto-set to that country's
 * income/region (but remain changeable).
 *
 * Value/share toggle:
 *   ON  (default) → TDI bars + Imports (%) diamond
 *   OFF           → Share of TDI (%)
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // NOTES
  // Each entry separates the note body from the source line so we can render
  // the source on its own line on screen and as a separate row in downloads.
  // ─────────────────────────────────────────────────────────────────────────
  var SRC_LINE = 'Source: SPR Trade Deflection Index, Trade Data Monitor.';
  var NOTES = {
    global_tdi: {
      note:
        'Note: Positive values suggest possible trade deflection and negative values, ' +
        'a contraction across markets. See "How is it interpreted?" for further detail. ' +
        'The upper bound estimate in the top panel includes all trade flows ' +
        'that meet the index conditions, while the baseline estimate excludes ' +
        'changes below the 1st percentile or above the 99th percentile.',
      source: SRC_LINE
    },
    global_gainloss: {
      note:
        'Note: "Third-market gain" refers to the numerator and "Loss in the U.S." ' +
        'refers to the denominator of the index aggregated across all products within ' +
        'a given period.',
      source: SRC_LINE
    },
    global_region: {
      note:
        'Note: The chart decomposes third-market gains and losses (i.e., the sum of ' +
        'changes in Chinese exports of the same products in which they experienced ' +
        'losses in the U.S. market) by region.',
      source: SRC_LINE
    },
    global_sector: {
      note:
        'Note: The chart decomposes third-market gains and losses (i.e., the sum of ' +
        'changes in Chinese exports of the same products in which they experienced ' +
        'losses in the U.S. market) by sector.',
      source: SRC_LINE
    },
    panel: { note: '', source: '' }
  };

  // Render a {note, source} entry into the on-screen note element, with the
  // source on its own line.
  function setNote(entry) {
    if (!entry || (!entry.note && !entry.source)) {
      noteEl.textContent = '';
      return;
    }
    var html = '';
    if (entry.noteHtml)   html += entry.noteHtml;
    else if (entry.note)  html += escapeHTML(entry.note);
    if (entry.source) html += (html ? '<br>' : '') + escapeHTML(entry.source);
    noteEl.innerHTML = html;
  }

  // Build the rows (note row, then source row) appended to a downloaded sheet.
  function noteRows(entry) {
    var rows = [];
    if (entry && entry.note)   rows.push([''], [entry.note]);
    if (entry && entry.source) rows.push([entry.source]);
    return rows;
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLORS
  // ─────────────────────────────────────────────────────────────────────────
  var COLOR_BAR_POS         = '#004C97';
  var COLOR_BAR_NEG         = '#A33A3A';
  var COLOR_IMPORTS_DIAMOND = '#111111';
  // Share-view palette — three coherent earth-toned hues that read distinctly
  // even when shown alongside each other in the same chart.
  var COLOR_SHARE_GLOBAL_BAR    = '#C8922A';   // amber
  var COLOR_SHARE_GLOBAL_MARKER = '#8E5A1A';
  var COLOR_SHARE_INCOME_BAR    = '#6E8B3D';   // olive
  var COLOR_SHARE_INCOME_MARKER = '#4A5D29';
  var COLOR_SHARE_REGION_BAR    = '#9B6A8C';   // muted plum
  var COLOR_SHARE_REGION_MARKER = '#6B4760';

  var COLOR_GAIN_BASE  = '#1F6FB0';
  var COLOR_GAIN_EXTRA = '#A8C8E6';
  var COLOR_LOSS_BASE  = '#6C7480';
  var COLOR_LOSS_EXTRA = '#C4CAD2';

  var PLOTLY_CONFIG = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['zoom2d','pan2d','select2d','lasso2d',
                              'autoScale2d','toggleSpikelines'],
    displaylogo: false
  };
  var FONT_FAMILY = 'Georgia, "Times New Roman", serif';

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED DATA HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  var GLOBAL_DENOM = TDI_DATA.global.denominator;

  var COUNTRY_REGION = TDI_DATA.country_region_map || {};

  // ISO -> income bucket map (built from countries_by_income).
  var COUNTRY_INCOME = {};
  Object.keys(TDI_DATA.countries_by_income || {}).forEach(function (inc) {
    (TDI_DATA.countries_by_income[inc] || []).forEach(function (c) {
      COUNTRY_INCOME[c.iso] = inc;
    });
  });

  // EU member set
  var EU_SET = {};
  ((TDI_DATA.countries_by_region || {})['EU'] || []).forEach(function (c) {
    EU_SET[c.iso] = true;
  });

  var REGION_COL_B = ['AFR', 'APD', 'EUR', 'MCD', 'WHD'];
  var REGION_DROPDOWN_ORDER = REGION_COL_B.concat(['EU']);

  function isMemberOfRegion(iso, region) {
    if (region === 'EU') return !!EU_SET[iso];
    return COUNTRY_REGION[iso] === region;
  }

  // Income aggregates lookup
  var INCOME_AGG = {};
  TDI_DATA.income_aggregates.forEach(function (i) { INCOME_AGG[i.income] = i; });

  // Region aggregates lookup (used as Share of Region denominator).
  // Note: List_Figure rows 8-15 already exists in payload as region_aggregates,
  // covering AFR/APD/EUR/MCD/WHD plus EU (and ASEAN/USMCA which we don't use).
  var REGION_AGG = {};
  TDI_DATA.region_aggregates.forEach(function (r) { REGION_AGG[r.region] = r; });

  function shareOfIncome(v, income) {
    if (v == null || !income || income === ALL) return null;
    var d = (INCOME_AGG[income] || {}).tdi_index;
    if (d == null || d === 0) return null;
    return 100 * v / d;
  }
  function shareOfRegion(v, region) {
    if (v == null || !region || region === ALL) return null;
    var d = (REGION_AGG[region] || {}).tdi_index;
    if (d == null || d === 0) return null;
    return 100 * v / d;
  }

  // Income dropdown (EM, AE, LIC) — desc by TDI
  var INCOME_LIST = TDI_DATA.income_aggregates.slice()
    .sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); })
    .map(function (r) { return r.income; });

  // Country universe (alphabetic by name)
  var COUNTRY_UNIVERSE_BY_NAME = (TDI_DATA.country_universe || []).slice().sort(
    function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }
  );
  var COUNTRY_BY_ISO = {};
  (TDI_DATA.country_universe || []).forEach(function (c) {
    COUNTRY_BY_ISO[c.iso] = c;
  });

  // Sector universe (global), label -> aggregate record.
  var SECTOR_GLOBAL_BY_LABEL = {};
  (TDI_DATA.sectors_global || []).forEach(function (s) {
    SECTOR_GLOBAL_BY_LABEL[s.sector] = s;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOP-5 GROUP COMPUTATION (memoized)
  // Countries: top-5 ISOs by TDI in a scope (global, or within a region).
  // Sectors:   top-5 HS2 labels by TDI in a scope (global, or income/region).
  // These return arrays of {value, label} where value is iso / sector label.
  // ─────────────────────────────────────────────────────────────────────────
  var _top5Cache = {};

  function top5CountriesGlobal() {
    if (_top5Cache.cg) return _top5Cache.cg;
    var pool = (TDI_DATA.country_universe || []).filter(function (c) { return c.tdi_index != null; });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache.cg = pool.slice(0, TOP_N_GROUP).map(function (c) {
      return { value: c.iso, label: c.name || c.iso };
    });
    return _top5Cache.cg;
  }

  function top5CountriesInRegion(region) {
    if (!region || region === ALL) return [];
    var key = 'cr|' + region;
    if (_top5Cache[key]) return _top5Cache[key];
    var pool = (TDI_DATA.country_universe || []).filter(function (c) {
      return c.tdi_index != null && isMemberOfRegion(c.iso, region);
    });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache[key] = pool.slice(0, TOP_N_GROUP).map(function (c) {
      return { value: c.iso, label: c.name || c.iso };
    });
    return _top5Cache[key];
  }

  function top5CountriesInIncome(income) {
    if (!income || income === ALL) return [];
    var key = 'ci|' + income;
    if (_top5Cache[key]) return _top5Cache[key];
    var pool = (TDI_DATA.countries_by_income[income] || []).filter(function (c) {
      return c.tdi_index != null;
    });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache[key] = pool.slice(0, TOP_N_GROUP).map(function (c) {
      return { value: c.iso, label: (COUNTRY_BY_ISO[c.iso] ? COUNTRY_BY_ISO[c.iso].name : c.iso) };
    });
    return _top5Cache[key];
  }

  function top5CountriesInIncomeRegion(income, region) {
    if (!income || income === ALL || !region || region === ALL) return [];
    var key = 'cir|' + income + '|' + region;
    if (_top5Cache[key]) return _top5Cache[key];
    var pool = (TDI_DATA.countries_by_income[income] || []).filter(function (c) {
      return c.tdi_index != null && isMemberOfRegion(c.iso, region);
    });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache[key] = pool.slice(0, TOP_N_GROUP).map(function (c) {
      return { value: c.iso, label: (COUNTRY_BY_ISO[c.iso] ? COUNTRY_BY_ISO[c.iso].name : c.iso) };
    });
    return _top5Cache[key];
  }

  function top5SectorsGlobal() {
    if (_top5Cache.sg) return _top5Cache.sg;
    var pool = (TDI_DATA.sectors_global || []).filter(function (s) { return s.tdi_index != null; });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache.sg = pool.slice(0, TOP_N_GROUP).map(function (s) {
      return { value: s.sector, label: s.sector };
    });
    return _top5Cache.sg;
  }

  // Top-5 sectors in the current geographic scope (income and/or region, if specific).
  function top5SectorsInScope(income, region) {
    var key = 'ss|' + (income || '') + '|' + (region || '');
    if (_top5Cache[key]) return _top5Cache[key];
    var pool;
    if (income && region) {
      // intersect: aggregate sectors across countries in income∩region
      var totals = {};
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
        if (COUNTRY_INCOME[iso] !== income) return;
        if (!isMemberOfRegion(iso, region)) return;
        (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
          if (s.tdi_index == null) return;
          if (!totals[s.sector]) totals[s.sector] = 0;
          totals[s.sector] += s.tdi_index;
        });
      });
      pool = Object.keys(totals).map(function (k) { return { sector: k, tdi_index: totals[k] }; });
    } else if (income) {
      pool = (TDI_DATA.sectors_by_income[income] || []).filter(function (s) { return s.tdi_index != null; });
    } else if (region) {
      pool = (TDI_DATA.sectors_by_region[region] || []).filter(function (s) { return s.tdi_index != null; });
    } else {
      pool = (TDI_DATA.sectors_global || []).filter(function (s) { return s.tdi_index != null; });
    }
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    _top5Cache[key] = pool.slice(0, TOP_N_GROUP).map(function (s) {
      return { value: s.sector, label: s.sector };
    });
    return _top5Cache[key];
  }

  // Leading HS2 number from a sector label like "85 - Electrical equipment".
  function sectorNum(label) {
    var m = /^\s*(\d+)/.exec(label || '');
    return m ? parseInt(m[1], 10) : 9999;
  }
  // Ascending HS2-number comparator for sorting the sector picker list.
  function bySectorNum(a, b) { return sectorNum(a) - sectorNum(b); }

  // Leading HS4 code from a product label like "0101 - Live horses…".
  function productNum(label) {
    var m = /^\s*(\d+)/.exec(label || '');
    return m ? parseInt(m[1], 10) : 999999;
  }
  // Ascending HS4-number comparator for the product dropdown.
  function byProductNum(a, b) { return productNum(a) - productNum(b); }

  // All sectors in the current geographic scope, ranked DESC by TDI.
  // Mirrors the scope resolution in sectorsInScope() / top5SectorsInScope(),
  // but returns the full ranked list (used by "All sectors" → top 10, and by
  // the full-series download when All sectors is active).
  function rankedSectorsInScope(income, region, country) {
    var pool;
    if (country) {
      pool = (TDI_DATA.sectors_by_country[country] || [])
        .filter(function (s) { return s.tdi_index != null; })
        .map(function (s) { return { sector: s.sector, tdi_index: s.tdi_index }; });
    } else if (income && region) {
      var totals = {};
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
        if (COUNTRY_INCOME[iso] !== income) return;
        if (!isMemberOfRegion(iso, region)) return;
        (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
          if (s.tdi_index == null) return;
          if (!totals[s.sector]) totals[s.sector] = 0;
          totals[s.sector] += s.tdi_index;
        });
      });
      pool = Object.keys(totals).map(function (k) { return { sector: k, tdi_index: totals[k] }; });
    } else if (income) {
      pool = (TDI_DATA.sectors_by_income[income] || []).filter(function (s) { return s.tdi_index != null; });
    } else if (region) {
      pool = (TDI_DATA.sectors_by_region[region] || []).filter(function (s) { return s.tdi_index != null; });
    } else {
      pool = (TDI_DATA.sectors_global || []).filter(function (s) { return s.tdi_index != null; });
    }
    return pool.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSTANTS — wildcard tokens
  // ─────────────────────────────────────────────────────────────────────────
  var ALL = '__all__';

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  //   null      → "Select" (untouched)
  //   '__all__' → "All"    (explicit wildcard)
  //   <value>   → specific pick
  //
  //   countries is an array of ISOs (max 5); empty = wildcard.
  //   countryAllExplicit is true when the user explicitly picked "All" in
  //   the country popover (vs. just not touching it). Functionally equivalent
  //   for chart-routing.
  // ─────────────────────────────────────────────────────────────────────────
  var state = {
    figType:   'global_gainloss',
    income:    ALL,            // default to "All" so the disaggregated view loads with the 3-income chart immediately
    region:    null,
    countries: [],             // array of ISOs (max 10); empty = wildcard
    sectors:   [],             // array of HS2 sector labels (max 10); empty = wildcard
    allSectors: false,         // "All sectors" mode — chart shows top 10 in scope; download gives all
    product:   null,
    geoAutoFilled: false,      // true when income/region were set by single-country auto-fill
    shareView: false,
    shareOpts: { global: true, income: false, region: false }
  };

  var MAX_PICKS = 10;          // cap for country / sector multi-select
  var TOP_N_GROUP = 5;         // size of predefined Top-5 groups

  // wildcard helpers
  function isWildcard(v)        { return v == null || v === ALL; }
  function isAll(v)             { return v === ALL; }
  function isPicked(v)          { return v != null && v !== ALL; }
  function isWildcardCountries(){ return state.countries.length === 0; }
  function isPickedCountries()  { return state.countries.length > 0; }
  function isWildcardSectors()  { return state.sectors.length === 0; }
  function isPickedSectors()    { return state.sectors.length > 0; }
  // A single-value pick on a multi-select dim acts as a "specific" filter.
  function singleCountry()     { return state.countries.length === 1 ? state.countries[0] : null; }
  function singleSector()      { return state.sectors.length === 1 ? state.sectors[0] : null; }
  function multiCountry()      { return state.countries.length >= 2; }
  function multiSector()       { return state.sectors.length >= 2; }

  // ─────────────────────────────────────────────────────────────────────────
  // ON-THE-FLY AGGREGATION HELPERS
  // (Memoized so repeated chart renders don't pay the same cost twice.)
  // ─────────────────────────────────────────────────────────────────────────
  var _aggCache = {};

  function _key() { return Array.prototype.join.call(arguments, '|'); }

  // List_Country_Product is the master country×product source.
  // Iterate once, lazily on demand.

  // Sum TDI of countries-in-scope (income, region, country list) for a given
  // dimension key extractor. Used for the "by income / by region / by country"
  // bars when a product filter is active.
  //
  // dimExtractor(iso) → bucket label (or null to skip)
  function aggregateCountryByDim(productFilter, regionFilter, incomeFilter, dimExtractor) {
    var rows = TDI_DATA.products_by_country;
    var buckets = {};   // label -> { tdi_index, tdi_imports, n }

    // If no product filter, fall back to country_universe (faster, since
    // products_by_country is per-country×per-product, much larger).
    if (!productFilter) {
      (TDI_DATA.country_universe || []).forEach(function (c) {
        if (incomeFilter && COUNTRY_INCOME[c.iso] !== incomeFilter) return;
        if (regionFilter && !isMemberOfRegion(c.iso, regionFilter)) return;
        var dim = dimExtractor(c.iso);
        if (dim == null) return;
        if (!buckets[dim]) buckets[dim] = { tdi_index: 0, tdi_imports: 0, n: 0 };
        if (c.tdi_index != null)   { buckets[dim].tdi_index += c.tdi_index; }
        if (c.tdi_imports != null) { buckets[dim].tdi_imports += c.tdi_imports; }
        buckets[dim].n += 1;
      });
      return buckets;
    }

    // Product filter: walk per-country product entries
    Object.keys(rows).forEach(function (iso) {
      if (incomeFilter && COUNTRY_INCOME[iso] !== incomeFilter) return;
      if (regionFilter && !isMemberOfRegion(iso, regionFilter)) return;
      var dim = dimExtractor(iso);
      if (dim == null) return;
      var prodList = rows[iso] || [];
      for (var i = 0; i < prodList.length; i++) {
        if (prodList[i].product === productFilter) {
          if (!buckets[dim]) buckets[dim] = { tdi_index: 0, tdi_imports: 0, n: 0 };
          if (prodList[i].tdi_index != null)   buckets[dim].tdi_index += prodList[i].tdi_index;
          if (prodList[i].tdi_imports != null) buckets[dim].tdi_imports += prodList[i].tdi_imports;
          buckets[dim].n += 1;
          break;
        }
      }
    });
    return buckets;
  }

  // Sum TDI across countries-in-scope at a given (sector|product) filter for
  // a single label. Used when collapsing the country dimension down to a
  // scope total (e.g. "EM ∩ APD ∩ Sector 85" = one bar value).
  function aggregateScopeTotal(productFilter, sectorFilter, regionFilter, incomeFilter, countryFilter) {
    var total = 0, importsTotal = 0, n = 0;

    function countryMatches(iso) {
      if (countryFilter && countryFilter.length && countryFilter.indexOf(iso) === -1) return false;
      if (incomeFilter && COUNTRY_INCOME[iso] !== incomeFilter) return false;
      if (regionFilter && !isMemberOfRegion(iso, regionFilter)) return false;
      return true;
    }

    if (productFilter) {
      Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
        if (!countryMatches(iso)) return;
        var prods = TDI_DATA.products_by_country[iso] || [];
        for (var i = 0; i < prods.length; i++) {
          if (prods[i].product === productFilter) {
            if (prods[i].tdi_index != null)   { total += prods[i].tdi_index; n++; }
            if (prods[i].tdi_imports != null) importsTotal += prods[i].tdi_imports;
            break;
          }
        }
      });
    } else if (sectorFilter) {
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
        if (!countryMatches(iso)) return;
        var secs = TDI_DATA.sectors_by_country[iso] || [];
        for (var i = 0; i < secs.length; i++) {
          if (secs[i].sector === sectorFilter) {
            if (secs[i].tdi_index != null)   { total += secs[i].tdi_index; n++; }
            if (secs[i].tdi_imports != null) importsTotal += secs[i].tdi_imports;
            break;
          }
        }
      });
    } else {
      (TDI_DATA.country_universe || []).forEach(function (c) {
        if (!countryMatches(c.iso)) return;
        if (c.tdi_index != null)   { total += c.tdi_index; n++; }
        if (c.tdi_imports != null) importsTotal += c.tdi_imports;
      });
    }
    return {
      tdi_index:   n ? total : null,
      tdi_imports: n ? importsTotal / n : null
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHARE-OF helpers
  // ─────────────────────────────────────────────────────────────────────────
  function shareOfGlobal(v) {
    if (v === null || v === undefined || GLOBAL_DENOM === 0) return null;
    return 100 * v / GLOBAL_DENOM;
  }
  function fmt(v, digits) {
    digits = (digits == null) ? 4 : digits;
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
    return Number(v).toFixed(digits);
  }
  function fmtPct(v) { return fmt(v, 2); }

  // ─────────────────────────────────────────────────────────────────────────
  // HEADER STATS
  // ─────────────────────────────────────────────────────────────────────────
  (function renderHeaderStats() {
    var h = TDI_DATA.global.headline;
    var upper = document.getElementById('tdi-headline-upper');
    var lower = document.getElementById('tdi-headline-lower');
    var asof  = document.getElementById('tdi-headline-asof');
    if (upper) upper.textContent = fmt(h.cumulative_upper, 4);
    if (lower) lower.textContent = fmt(h.cumulative_lower, 4);
    if (asof)  asof.textContent  = h.as_of || '';
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // DOM REFERENCES
  // ─────────────────────────────────────────────────────────────────────────
  var figTypeSel    = document.getElementById('figtype-select');
  var rowIncomeEl   = document.getElementById('figbar-row-income');
  var rowGeoEl      = document.getElementById('figbar-row-geo');
  var rowIndEl      = document.getElementById('figbar-row-ind');
  var rowShareEl    = document.getElementById('figbar-row-share');

  var incomeSel     = document.getElementById('income-select');
  var regionSel     = document.getElementById('region-select');
  var productSel    = document.getElementById('product-select');

  var deselectBtn   = document.getElementById('figbar-deselect');

  var countryWrap   = document.getElementById('country-wrap');
  var countryBtn    = document.getElementById('country-btn');
  var countryBtnLbl = document.getElementById('country-btn-label');
  var countryPop    = document.getElementById('country-popover');
  var countrySearch = document.getElementById('country-search');
  var countryList   = document.getElementById('country-list');
  var countryClear  = document.getElementById('country-clear');
  var countryDone   = document.getElementById('country-done');

  var sectorWrap    = document.getElementById('sector-wrap');
  var sectorBtn     = document.getElementById('sector-btn');
  var sectorBtnLbl  = document.getElementById('sector-btn-label');
  var sectorPop     = document.getElementById('sector-popover');
  var sectorSearch  = document.getElementById('sector-search');
  var sectorList    = document.getElementById('sector-list');
  var sectorClear   = document.getElementById('sector-clear');
  var sectorDone    = document.getElementById('sector-done');
  var sectorGroupScope     = document.getElementById('sector-group-scope');
  var sectorGroupScopeName = document.getElementById('sector-group-scope-name');

  var shareToggle   = document.getElementById('share-toggle');
  var shareToggleLabel = document.getElementById('share-toggle-label');
  var shareOptsEl   = document.getElementById('figbar-share-options');
  var shareOptGlobal = document.getElementById('share-opt-global');
  var shareOptIncome = document.getElementById('share-opt-income');
  var shareOptRegion = document.getElementById('share-opt-region');
  var shareOptIncomeLbl = document.getElementById('share-opt-income-label');
  var shareOptRegionLbl = document.getElementById('share-opt-region-label');

  var chartEl = document.getElementById('main-chart');
  var noteEl  = document.getElementById('main-note');

  // ─────────────────────────────────────────────────────────────────────────
  // STATIC: populate Income dropdown
  // ─────────────────────────────────────────────────────────────────────────
  INCOME_LIST.forEach(function (i) {
    var opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    incomeSel.appendChild(opt);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DROPDOWN POPULATION — context-aware
  //
  // Every dropdown has:
  //   <option value="" disabled hidden>Select</option>   (the placeholder)
  //   <option value="__all__">All</option>
  //   <option value="X">X</option>  …
  //
  // The "Select" option is only the placeholder when state.<dim> is null.
  // Once the user picks anything, "Select" becomes inaccessible.
  //
  // Dropdown content is filtered by current scope so that ONLY items with
  // non-null TDI in the current scope appear.
  // ─────────────────────────────────────────────────────────────────────────

  // Income dropdown — static (all 3 always available)
  function refreshIncomeDropdown() {
    // Income options never depend on other dims (you can always pick EM)
    syncSelect(incomeSel, state.income);
  }

  function refreshRegionDropdown() {
    var income = isPicked(state.income) ? state.income : null;
    var regions = [];
    if (income) {
      // Only regions populated in this income
      var present = {};
      (TDI_DATA.countries_by_income[income] || []).forEach(function (c) {
        if (c.tdi_index == null) return;
        var reg = COUNTRY_REGION[c.iso];
        if (reg && REGION_COL_B.indexOf(reg) !== -1) present[reg] = true;
        if (EU_SET[c.iso]) present['EU'] = true;
      });
      regions = REGION_DROPDOWN_ORDER.filter(function (r) { return present[r]; });
    } else {
      // All incomes — populated regions across the universe
      regions = REGION_DROPDOWN_ORDER.slice();
    }
    rebuildSelect(regionSel, regions, state.region);
  }

  // Build the list of sectors available in the current geographic scope.
  // Used to populate the sector popover (multi-select).
  function sectorsInScope() {
    var income  = isPicked(state.income) ? state.income : null;
    var region  = isPicked(state.region) ? state.region : null;
    var iso     = singleCountry();

    var seen = {};
    var sectors = [];
    function add(arr) {
      (arr || []).forEach(function (s) {
        if (s.tdi_index != null && !seen[s.sector]) {
          seen[s.sector] = true;
          sectors.push(s.sector);
        }
      });
    }

    if (iso) {
      add(TDI_DATA.sectors_by_country[iso] || []);
    } else if (income && region) {
      // intersect income∩region from sectors_by_country
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (i2) {
        if (COUNTRY_INCOME[i2] !== income) return;
        if (!isMemberOfRegion(i2, region)) return;
        add(TDI_DATA.sectors_by_country[i2] || []);
      });
    } else if (income) {
      add(TDI_DATA.sectors_by_income[income] || []);
    } else if (region) {
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (i2) {
        if (!isMemberOfRegion(i2, region)) return;
        add(TDI_DATA.sectors_by_country[i2] || []);
      });
    } else {
      add(TDI_DATA.sectors_global || []);
    }
    // Sector picker list is ordered ascending by HS2 number (01, 02 … 85, 98).
    sectors.sort(bySectorNum);
    return sectors;
  }

  // The sector used to restrict the product list. In "All sectors" mode there
  // is no anchoring sector, so the product list stays scope-only. Otherwise the
  // FIRST selected sector (if any) limits the products shown.
  function firstSectorFilter() {
    if (state.allSectors) return null;
    return state.sectors.length ? state.sectors[0] : null;
  }

  function refreshProductDropdown() {
    var income  = isPicked(state.income)  ? state.income  : null;
    var sector  = firstSectorFilter();
    var iso     = singleCountry();

    var seen = {};
    var products = [];

    if (iso) {
      var pool;
      if (sector) {
        pool = (TDI_DATA.products_by_country_sector[iso] || {})[sector] || [];
      } else {
        pool = TDI_DATA.products_by_country[iso] || [];
      }
      pool.forEach(function (p) {
        if (p.tdi_index != null && !seen[p.product]) {
          seen[p.product] = true;
          products.push(p.product);
        }
      });
    } else if (income) {
      var pool2;
      if (sector) {
        pool2 = (TDI_DATA.products_by_income_sector[income] || {})[sector] || [];
      } else {
        pool2 = TDI_DATA.products_by_income[income] || [];
      }
      pool2.forEach(function (p) {
        if (p.tdi_index != null && !seen[p.product]) {
          seen[p.product] = true;
          products.push(p.product);
        }
      });
    } else if (sector) {
      var pool3 = TDI_DATA.products_by_sector[sector] || [];
      pool3.forEach(function (p) {
        if (p.tdi_index != null && !seen[p.product]) {
          seen[p.product] = true;
          products.push(p.product);
        }
      });
    } else {
      // No scope filter
      (TDI_DATA.products_global || []).forEach(function (p) {
        if (p.tdi_index != null && !seen[p.product]) {
          seen[p.product] = true;
          products.push(p.product);
        }
      });
    }
    products.sort(byProductNum);
    rebuildSelect(productSel, products, state.product);
  }

  // Rebuild <select> options while preserving the placeholder + "All" head.
  function rebuildSelect(sel, items, currentValue) {
    sel.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Select';
    ph.disabled = true; ph.hidden = true;
    sel.appendChild(ph);

    var allOpt = document.createElement('option');
    allOpt.value = ALL; allOpt.textContent = 'All';
    sel.appendChild(allOpt);

    items.forEach(function (it) {
      var opt = document.createElement('option');
      opt.value = it; opt.textContent = it;
      sel.appendChild(opt);
    });

    if (currentValue === ALL) {
      sel.value = ALL;
    } else if (currentValue && items.indexOf(currentValue) !== -1) {
      sel.value = currentValue;
    } else {
      sel.value = '';   // back to placeholder
    }
  }

  function syncSelect(sel, currentValue) {
    if (currentValue === ALL) sel.value = ALL;
    else if (currentValue) sel.value = currentValue;
    else sel.value = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COUNTRY POPOVER
  // ─────────────────────────────────────────────────────────────────────────
  // All selectable countries. When an income/region scope is set by the user,
  // members of that scope are listed FIRST, but every other country remains
  // available to add manually below them. (Auto-filled geography from a single
  // country pick does not reorder anything.)
  function countryUniverseForScope() {
    var all = COUNTRY_UNIVERSE_BY_NAME.filter(function (c) { return c.tdi_index != null; });
    var scopeByGeo = !state.geoAutoFilled && (isPicked(state.income) || isPicked(state.region));
    if (!scopeByGeo) {
      return all.map(function (c) { return { country: c, inScope: false }; });
    }
    function inScope(c) {
      if (isPicked(state.income) && COUNTRY_INCOME[c.iso] !== state.income) return false;
      if (isPicked(state.region) && !isMemberOfRegion(c.iso, state.region)) return false;
      return true;
    }
    var head = [], tail = [];
    all.forEach(function (c) {
      if (inScope(c)) head.push({ country: c, inScope: true });
      else            tail.push({ country: c, inScope: false });
    });
    return head.concat(tail);
  }

  function updateCountryButtonLabel() {
    var n = state.countries.length;
    if (n === 0) {
      countryBtnLbl.textContent = 'Select';
    } else if (n <= 3) {
      countryBtnLbl.textContent = state.countries.join(', ') + '  (' + n + '/' + MAX_PICKS + ')';
    } else {
      countryBtnLbl.textContent = state.countries.slice(0, 3).join(', ') +
        ' +' + (n - 3) + '  (' + n + '/' + MAX_PICKS + ')';
    }
  }

  // When exactly one country is picked, auto-set Income & Region to that
  // country's bucket (still changeable). When not exactly one, leave as-is.
  function autoFillGeoFromCountry() {
    var iso = singleCountry();
    if (!iso) { state.geoAutoFilled = false; return; }
    var inc = COUNTRY_INCOME[iso];
    if (inc) { state.income = inc; }
    var reg = COUNTRY_REGION[iso];
    if (reg && REGION_COL_B.indexOf(reg) !== -1) {
      state.region = reg;
    } else if (EU_SET[iso]) {
      state.region = 'EU';
    }
    state.geoAutoFilled = true;
    refreshIncomeDropdown();
    refreshRegionDropdown();
  }

  // Shared: add/remove an ISO from state.countries, enforcing the 10-cap.
  function toggleCountry(iso, on) {
    if (on) {
      if (state.countries.indexOf(iso) !== -1) return true;
      if (state.countries.length >= MAX_PICKS) return false;
      state.countries.push(iso);
    } else {
      state.countries = state.countries.filter(function (i) { return i !== iso; });
    }
    return true;
  }

  function afterCountryChange() {
    // Country change can invalidate product pick; sectors are an independent dim.
    state.product = null;
    if (singleCountry()) {
      autoFillGeoFromCountry();
    } else if (state.geoAutoFilled) {
      // Leaving single-country: the income/region we auto-filled were never a
      // user choice, so clear them back to defaults rather than letting them
      // suddenly act as hard filters on a multi-country comparison.
      state.income = ALL;
      state.region = null;
      state.geoAutoFilled = false;
      refreshIncomeDropdown();
      refreshRegionDropdown();
    }
    updateCountryButtonLabel();
    buildCountryGroups();
    buildCountryList(countrySearch.value);
    refreshProductDropdown();
    refreshSectorPopover();
    render();
  }

  // Build the Top-5 group sub-lists + wire group checkboxes.
  function buildCountryGroups() {
    var selectedSet = {};
    state.countries.forEach(function (i) { selectedSet[i] = true; });

    var incomePicked = isPicked(state.income);
    var regionPicked = isPicked(state.region);

    // Toggle group visibility + labels.
    var gIncome = document.getElementById('country-group-income');
    var gRegion = document.getElementById('country-group-region');
    var gIR     = document.getElementById('country-group-incomeregion');
    if (gIncome) {
      gIncome.hidden = !incomePicked;
      var nm = document.getElementById('country-group-income-name');
      if (incomePicked && nm) nm.textContent = 'Top 5 — ' + state.income;
    }
    if (gRegion) {
      gRegion.hidden = !regionPicked;
      var nm2 = document.getElementById('country-group-region-name');
      if (regionPicked && nm2) nm2.textContent = 'Top 5 — ' + state.region;
    }
    if (gIR) {
      gIR.hidden = !(incomePicked && regionPicked);
      var nm3 = document.getElementById('country-group-incomeregion-name');
      if (incomePicked && regionPicked && nm3) nm3.textContent = 'Top 5 — ' + state.income + ' ∩ ' + state.region;
    }

    var groups = {
      global: top5CountriesGlobal(),
      income: incomePicked ? top5CountriesInIncome(state.income) : [],
      region: regionPicked ? top5CountriesInRegion(state.region) : [],
      incomeregion: (incomePicked && regionPicked) ? top5CountriesInIncomeRegion(state.income, state.region) : []
    };

    Object.keys(groups).forEach(function (gname) {
      var members = groups[gname];
      var sub = countryWrap.querySelector('.compare-group-sub[data-group="' + gname + '"]');
      var allCb = countryWrap.querySelector('.compare-group-allcb[data-group="' + gname + '"]');
      if (!sub) return;
      sub.innerHTML = '';
      members.forEach(function (m) {
        var row = document.createElement('label');
        row.className = 'compare-subrow';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.value;
        cb.checked = !!selectedSet[m.value];
        cb.addEventListener('change', function () {
          if (cb.checked) {
            if (!toggleCountry(m.value, true)) { cb.checked = false; return; }
          } else {
            toggleCountry(m.value, false);
          }
          afterCountryChange();
        });
        row.appendChild(cb);
        var nm4 = document.createElement('span');
        nm4.className = 'compare-subrow-name';
        nm4.textContent = m.label + ' (' + m.value + ')';
        row.appendChild(nm4);
        sub.appendChild(row);
      });
      if (allCb) {
        var allSel = members.length > 0 && members.every(function (m) { return selectedSet[m.value]; });
        allCb.checked = allSel;
      }
    });
  }

  function buildCountryList(filterText) {
    countryList.innerHTML = '';
    var atCap = state.countries.length >= MAX_PICKS;
    var selectedSet = {};
    state.countries.forEach(function (i) { selectedSet[i] = true; });

    var filter = (filterText || '').toLowerCase().trim();
    var scope = countryUniverseForScope();
    var dividerInserted = false;
    var anyShown = false;
    var anyInScopeShown = false;

    scope.forEach(function (entry) {
      var c = entry.country;
      if (filter &&
          c.name.toLowerCase().indexOf(filter) === -1 &&
          c.iso.toLowerCase().indexOf(filter) === -1) return;

      // Divider between in-scope members and the rest — only when an income or
      // region scope actually placed members above (otherwise the list is a
      // plain alphabetical universe with nothing singled out).
      if (!entry.inScope && !dividerInserted && anyInScopeShown && !filter) {
        var div = document.createElement('div');
        div.className = 'compare-divider';
        div.textContent = 'Other countries';
        countryList.appendChild(div);
        dividerInserted = true;
      }

      var row = document.createElement('label');
      row.className = 'compare-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = c.iso;
      cb.checked = !!selectedSet[c.iso];
      if (atCap && !cb.checked) {
        cb.disabled = true;
        row.classList.add('is-capped');
      }
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (!toggleCountry(c.iso, true)) { cb.checked = false; return; }
        } else {
          toggleCountry(c.iso, false);
        }
        afterCountryChange();
      });
      row.appendChild(cb);
      var lbl = document.createElement('span');
      lbl.className = 'compare-row-label';
      lbl.innerHTML = '<span class="compare-row-name">' + c.name + '</span>' +
                     '<span class="compare-row-iso">' + c.iso + '</span>';
      row.appendChild(lbl);
      countryList.appendChild(row);
      anyShown = true;
      if (entry.inScope) anyInScopeShown = true;
    });

    if (!anyShown) {
      var empty = document.createElement('div');
      empty.className = 'compare-empty';
      empty.textContent = 'No countries match.';
      countryList.appendChild(empty);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTOR POPOVER (mirrors country popover)
  // ─────────────────────────────────────────────────────────────────────────
  function updateSectorButtonLabel() {
    var n = state.sectors.length;
    if (state.allSectors) {
      sectorBtnLbl.textContent = 'All sectors (top 10)';
    } else if (n === 0) {
      sectorBtnLbl.textContent = 'Select';
    } else if (n === 1) {
      sectorBtnLbl.textContent = state.sectors[0] + '  (1/' + MAX_PICKS + ')';
    } else {
      var first = state.sectors[0].split(' ')[0];
      sectorBtnLbl.textContent = first + ' +' + (n - 1) + '  (' + n + '/' + MAX_PICKS + ')';
    }
  }

  function toggleSector(label, on) {
    if (on) {
      // A manual pick exits "All sectors" mode and starts a fresh selection.
      if (state.allSectors) {
        state.allSectors = false;
        state.sectors = [];
      }
      if (state.sectors.indexOf(label) !== -1) return true;
      if (state.sectors.length >= MAX_PICKS) return false;
      state.sectors.push(label);
    } else {
      state.sectors = state.sectors.filter(function (s) { return s !== label; });
    }
    return true;
  }

  function afterSectorChange() {
    state.product = null;
    updateSectorButtonLabel();
    buildSectorGroups();
    buildSectorList(sectorSearch.value);
    refreshProductDropdown();
    render();
  }

  // Country in scope for sector resolution: a single explicit country pick.
  function scopeCountryForSectors() {
    // Use a country anchor only when exactly one is picked AND it wasn't merely
    // auto-filled from geography (auto-fill sets income/region instead).
    return (state.countries.length === 1) ? state.countries[0] : null;
  }

  // Recompute the top-10 sectors for "All sectors" mode from the current scope.
  // Called when All is active and the geography scope changes.
  function recomputeAllSectors() {
    if (!state.allSectors) return;
    var income  = isPicked(state.income) ? state.income : null;
    var region  = isPicked(state.region) ? state.region : null;
    var country = scopeCountryForSectors();
    var ranked = rankedSectorsInScope(income, region, country);
    state.sectors = ranked.slice(0, MAX_PICKS).map(function (s) { return s.sector; });
  }

  // Turn "All sectors" mode on/off.
  function setAllSectors(on) {
    if (on) {
      state.allSectors = true;
      recomputeAllSectors();
    } else {
      state.allSectors = false;
      state.sectors = [];
    }
    afterSectorChange();
  }

  function refreshSectorPopover() {
    if (state.allSectors) recomputeAllSectors();
    updateSectorButtonLabel();
    buildSectorGroups();
    buildSectorList(sectorSearch ? sectorSearch.value : '');
  }

  function buildSectorGroups() {
    var selectedSet = {};
    state.sectors.forEach(function (s) { selectedSet[s] = true; });

    var income = isPicked(state.income) ? state.income : null;
    var region = isPicked(state.region) ? state.region : null;
    var scoped = !!(income || region);

    if (sectorGroupScope) {
      sectorGroupScope.hidden = !scoped;
      if (scoped && sectorGroupScopeName) {
        var lbl = [income, region].filter(Boolean).join(' ∩ ');
        sectorGroupScopeName.textContent = 'Top 5 — ' + lbl;
      }
    }

    var groups = {
      global: top5SectorsGlobal(),
      scope: scoped ? top5SectorsInScope(income, region) : []
    };

    Object.keys(groups).forEach(function (gname) {
      var members = groups[gname];
      var sub = sectorWrap.querySelector('.compare-group-sub[data-group="' + gname + '"]');
      var allCb = sectorWrap.querySelector('.compare-group-allcb[data-group="' + gname + '"]');
      if (!sub) return;
      sub.innerHTML = '';
      members.forEach(function (m) {
        var row = document.createElement('label');
        row.className = 'compare-subrow';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.value;
        cb.checked = !state.allSectors && !!selectedSet[m.value];
        if (state.allSectors) { cb.disabled = true; row.classList.add('is-capped'); }
        cb.addEventListener('change', function () {
          if (cb.checked) {
            if (!toggleSector(m.value, true)) { cb.checked = false; return; }
          } else {
            toggleSector(m.value, false);
          }
          afterSectorChange();
        });
        row.appendChild(cb);
        var nm = document.createElement('span');
        nm.className = 'compare-subrow-name';
        nm.textContent = m.label;
        row.appendChild(nm);
        sub.appendChild(row);
      });
      if (allCb) {
        var allSel = !state.allSectors && members.length > 0 && members.every(function (m) { return selectedSet[m.value]; });
        allCb.checked = allSel;
        allCb.disabled = state.allSectors;
      }
    });
  }

  function buildSectorList(filterText) {
    sectorList.innerHTML = '';
    var allOn = state.allSectors;
    var atCap = state.sectors.length >= MAX_PICKS;
    var selectedSet = {};
    state.sectors.forEach(function (s) { selectedSet[s] = true; });

    var filter = (filterText || '').toLowerCase().trim();
    var scope = sectorsInScope();

    // "All sectors" pinned row at the very top of the list.
    var allRow = document.createElement('label');
    allRow.className = 'compare-row compare-row-all';
    var allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = allOn;
    allCb.addEventListener('change', function () {
      setAllSectors(allCb.checked);
    });
    allRow.appendChild(allCb);
    var allLbl = document.createElement('span');
    allLbl.className = 'compare-row-label';
    allLbl.innerHTML = '<span class="compare-row-name">All sectors</span>' +
                       '<span class="compare-row-allnote">shows top 10; full list via Download → Full series</span>';
    allRow.appendChild(allLbl);
    sectorList.appendChild(allRow);

    scope.forEach(function (label) {
      if (filter && label.toLowerCase().indexOf(filter) === -1) return;
      var row = document.createElement('label');
      row.className = 'compare-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = label;
      cb.checked = !allOn && !!selectedSet[label];
      if (allOn || (atCap && !cb.checked)) {
        cb.disabled = true;
        row.classList.add('is-capped');
      }
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (!toggleSector(label, true)) { cb.checked = false; return; }
        } else {
          toggleSector(label, false);
        }
        afterSectorChange();
      });
      row.appendChild(cb);
      var lbl = document.createElement('span');
      lbl.className = 'compare-row-label';
      lbl.innerHTML = '<span class="compare-row-name">' + label + '</span>';
      row.appendChild(lbl);
      sectorList.appendChild(row);
    });

    if (sectorList.children.length <= 1) {
      var empty = document.createElement('div');
      empty.className = 'compare-empty';
      empty.textContent = 'No sectors match this scope.';
      sectorList.appendChild(empty);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VISIBILITY
  // ─────────────────────────────────────────────────────────────────────────
  function applyVisibility() {
    var isGlobal = (state.figType === 'global_tdi' ||
                    state.figType === 'global_gainloss' ||
                    state.figType === 'global_region' ||
                    state.figType === 'global_sector' ||
                    state.figType === 'global_interp');
    rowIncomeEl.style.display = isGlobal ? 'none' : 'flex';
    rowGeoEl.style.display    = isGlobal ? 'none' : 'flex';
    rowIndEl.style.display    = isGlobal ? 'none' : 'flex';
    rowShareEl.style.display  = isGlobal ? 'none' : 'flex';
    if (deselectBtn) deselectBtn.style.display = isGlobal ? 'none' : 'inline-block';
    // The "How the selection works" info icon explains the nested
    // (income/region/country, sector/product) controls, which only exist for
    // the disaggregated "by Group" figure — so show it only there.
    var figInfoIcon = document.getElementById('figure-info-icon');
    if (figInfoIcon) figInfoIcon.style.display = isGlobal ? 'none' : 'inline-flex';

    if (isGlobal) return;

    // Share sub-options row is only meaningful when in OFF (share view).
    if (shareOptsEl) shareOptsEl.style.display = state.shareView ? 'flex' : 'none';

    // Income sub-option enabled only when a specific income is picked
    var incomePicked = isPicked(state.income);
    if (shareOptIncome) {
      shareOptIncome.disabled = !incomePicked;
      if (!incomePicked && shareOptIncome.checked) shareOptIncome.checked = false;
      if (!incomePicked) state.shareOpts.income = false;
    }
    if (shareOptIncomeLbl) shareOptIncomeLbl.classList.toggle('is-disabled', !incomePicked);

    // Region sub-option enabled only when a specific region is picked
    var regionPicked = isPicked(state.region);
    if (shareOptRegion) {
      shareOptRegion.disabled = !regionPicked;
      if (!regionPicked && shareOptRegion.checked) shareOptRegion.checked = false;
      if (!regionPicked) state.shareOpts.region = false;
    }
    if (shareOptRegionLbl) shareOptRegionLbl.classList.toggle('is-disabled', !regionPicked);

    // Toggle label text
    if (shareToggleLabel) {
      shareToggleLabel.textContent = state.shareView ? 'Show share of TDI' : 'Show TDI & imports (%)';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHART-ROUTING — new "All = breakdown, Specific = filter" model
  //
  // Returns { records, title } or { blocked: true, message } for invalid combos.
  // ─────────────────────────────────────────────────────────────────────────
  function takeTop10(arr) { return arr.slice(0, 10); }

  function buildRecords() {
    // Resolve each dimension's state.
    var incomeAll = isAll(state.income);     // "Global" — outermost geo scope
    var regionAll = isAll(state.region);
    var productAll = isAll(state.product);

    var I = isPicked(state.income)  ? state.income  : null;
    var R = isPicked(state.region)  ? state.region  : null;
    var P = isPicked(state.product) ? state.product : null;

    var Cmulti  = multiCountry();
    var Smulti  = multiSector();
    var Csingle = singleCountry();
    var Ssingle = singleSector();

    // ── Determine each line's breakdown intent ──────────────────────────────
    // A multi-select comparison (2+) is the STRONGEST breakdown on its line and
    // always wins over the other line's All (which then only filters).
    //
    // GEOGRAPHY breakdown: country comparison (2+) > Region=All > Income=All(Global)
    var geoAxis = null;
    if (Cmulti)        geoAxis = 'country';
    else if (regionAll) geoAxis = 'region';
    else if (incomeAll) geoAxis = 'income';

    // INDUSTRY breakdown: sector comparison (2+) > Product=All
    // (Sector has no standalone "All" breakdown — the Top-5 groups cover that.)
    var indAxis = null;
    if (Smulti)        indAxis = 'sectorcmp';
    else if (productAll) indAxis = 'product';

    // A comparison overrides the OTHER line entirely (the other line just filters).
    if (Cmulti && indAxis) { indAxis = null; }              // country comparison wins
    if (Smulti && (geoAxis === 'region')) { geoAxis = null; } // sector comparison wins over region=All

    // Recompute "breaks down" flags after comparison overrides.
    // income=Global by itself is just the outer scope; only Region=All or a
    // country comparison count as a *true* geo breakdown for the cross-line block.
    var geoBreaksDown = (geoAxis === 'country' || geoAxis === 'region');
    var indBreaksDown = (indAxis !== null);

    // ── Cross-line block: BOTH lines genuinely break down at once ───────────
    if (Cmulti && Smulti) {
      return blocked('Two comparisons at once — narrow either Country or Sector to one selection.');
    }
    if (geoBreaksDown && indBreaksDown) {
      return blocked('Geography and industry can\u2019t both break down at once. Narrow one line to a specific value (or Select).');
    }

    // Filters from specific picks.
    var sectorFilter = Ssingle;   // a single sector acts as a filter
    var productFilter = P;

    // ── Industry axis (when geography is not breaking down) ─────────────────
    if (indAxis === 'sectorcmp') {
      return sectorComparison(state.sectors.slice(), I, R, Csingle, P);
    }
    if (indAxis === 'product') {
      if (Csingle) return productsInCountryScope(Csingle, sectorFilter);
      if (I && R)  return productsInScopeGeo(sectorFilter, R, I);
      if (I)       return productsInScopeGeo(sectorFilter, null, I);
      if (R)       return productsInScopeGeo(sectorFilter, R, null);
      if (sectorFilter) return productsInSectorGlobal(sectorFilter);
      return productsGlobalAxis();
    }

    // ── Geography axis (industry only filters here) ─────────────────────────
    if (geoAxis === 'country') {
      // Country comparison; Region=All (if any) is ignored — just scope filter.
      return countryComparison(state.countries.slice(), I, R, sectorFilter, productFilter);
    }
    if (geoAxis === 'region') {
      if (productFilter) return regionsForProduct(productFilter, I);
      if (sectorFilter)  return regionsForSector(sectorFilter, I);
      if (I)             return regionsInIncome(I);
      return regionsGlobalAxis();
    }
    if (geoAxis === 'income') {
      // Income=All (Global) breakdown into 3 income bars, filtered if needed.
      if (productFilter) return incomesForProduct(productFilter);
      if (sectorFilter)  return incomesForSector(sectorFilter);
      return incomeAggregateChart();
    }

    // ── No breakdown anywhere: single bar for the deepest specific pick ─────
    if (P && Csingle) return singleBarCountryProduct(Csingle, P, Ssingle);
    if (P)            return singleBarProductScope(P, Ssingle, R, I);
    if (Ssingle && Csingle) return singleBarCountrySector(Csingle, Ssingle);
    if (Ssingle)      return singleBarSectorScope(Ssingle, R, I);
    if (Csingle)      return singleBarCountry(Csingle, Ssingle, P);
    if (R)            return singleBarRegion(R, I);
    if (I)            return singleBarIncome(I);

    // Everything Select → default 3 income bars.
    return incomeAggregateChart();
  }

  function blocked(message) {
    return { blocked: true, message: message };
  }

  // ── Chart builders ─────────────────────────────────────────────────────

  function incomeAggregateChart() {
    var records = INCOME_LIST.map(function (inc) {
      var a = INCOME_AGG[inc] || {};
      return { label: inc, tdi_index: a.tdi_index, tdi_imports: a.tdi_imports };
    }).sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return { records: records, title: 'TDI by Income Group' };
  }

  function regionsInIncome(income) {
    // Aggregate from List_Country_Region within the income group.
    var byReg = aggregateCountryByDim(
      null, null, income,
      function (iso) {
        if (isMemberOfRegion(iso, 'EU')) return 'EU';
        var reg = COUNTRY_REGION[iso];
        if (reg && REGION_COL_B.indexOf(reg) !== -1) return reg;
        return null;
      });
    // Wait — single ISO can belong to both EUR and EU; we'd double-count.
    // Use a two-pass: assign each ISO to exactly one bucket (regular region),
    // and additionally compute EU as a parallel cumulative if any EU members
    // exist in the income.
    var present = {};
    (TDI_DATA.countries_by_income[income] || []).forEach(function (c) {
      var reg = COUNTRY_REGION[c.iso];
      if (reg && REGION_COL_B.indexOf(reg) !== -1) present[reg] = true;
      if (EU_SET[c.iso]) present['EU'] = true;
    });
    var records = [];
    REGION_DROPDOWN_ORDER.forEach(function (r) {
      if (!present[r]) return;
      var sum = 0, imp = 0, n = 0;
      (TDI_DATA.countries_by_income[income] || []).forEach(function (c) {
        if (!isMemberOfRegion(c.iso, r)) return;
        if (c.tdi_index != null)   { sum += c.tdi_index; n++; }
        if (c.tdi_imports != null) imp += c.tdi_imports;
      });
      if (n > 0) {
        records.push({
          label: r,
          tdi_index: sum,
          tdi_imports: imp / n
        });
      }
    });
    records.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return { records: records, title: 'TDI by Region within ' + income };
  }

  function countriesInRegion(region) {
    var pool = (TDI_DATA.country_universe || []).filter(function (c) {
      return c.tdi_index != null && isMemberOfRegion(c.iso, region);
    });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(pool).map(function (c) {
        return { label: c.name || c.iso, iso: c.iso,
                 tdi_index: c.tdi_index, tdi_imports: c.tdi_imports };
      }),
      title: 'Top Countries with Highest TDI in ' + region
    };
  }

  function countriesInIncomeRegion(income, region) {
    var pool = (TDI_DATA.countries_by_income[income] || []).filter(function (c) {
      return c.tdi_index != null && isMemberOfRegion(c.iso, region);
    });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(pool).map(function (c) {
        return { label: c.name || c.iso, iso: c.iso,
                 tdi_index: c.tdi_index, tdi_imports: c.tdi_imports };
      }),
      title: 'Top Countries with Highest TDI in ' + income + ' — ' + region
    };
  }

  function sectorsInCountry(iso) {
    var arr = (TDI_DATA.sectors_by_country[iso] || []).filter(function (s) {
      return s.tdi_index != null;
    });
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    return {
      records: takeTop10(arr).map(function (s) {
        return { label: s.sector, iso: iso,
                 tdi_index: s.tdi_index, tdi_imports: s.tdi_imports };
      }),
      title: 'Top HS2 Sectors with Highest TDI in ' + name
    };
  }

  function productsInCountrySector(iso, sector) {
    var arr = ((TDI_DATA.products_by_country_sector[iso] || {})[sector] || [])
                .filter(function (p) { return p.tdi_index != null; });
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    return {
      records: takeTop10(arr).map(function (p) {
        return { label: p.product, iso: iso,
                 tdi_index: p.tdi_index, tdi_imports: p.tdi_imports };
      }),
      title: 'Top HS4 Products in ' + name + ' — ' + sector
    };
  }

  function productsInIncomeSector(income, sector) {
    var arr = ((TDI_DATA.products_by_income_sector[income] || {})[sector] || [])
                .filter(function (p) { return p.tdi_index != null; });
    return {
      records: takeTop10(arr).map(function (p) {
        return { label: p.product,
                 tdi_index: p.tdi_index, tdi_imports: p.tdi_imports };
      }),
      title: 'Top HS4 Products in ' + income + ' — ' + sector
    };
  }

  function productsInSectorGlobal(sector) {
    var arr = (TDI_DATA.products_by_sector[sector] || [])
                .filter(function (p) { return p.tdi_index != null; });
    return {
      records: takeTop10(arr).map(function (p) {
        return { label: p.product,
                 tdi_index: p.tdi_index, tdi_imports: p.tdi_imports };
      }),
      title: 'Top HS4 Products in ' + sector
    };
  }

  // Aggregate products inside scope (region±income) ∩ sector — on the fly.
  function productsInScope(sector, region, income) {
    var key = _key('prodScope', sector, region || '', income || '');
    if (_aggCache[key]) return _aggCache[key];
    var totals = {};
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region))  return;
      var arr = (TDI_DATA.products_by_country_sector[iso] || {})[sector] || [];
      arr.forEach(function (p) {
        if (p.tdi_index == null) return;
        if (!totals[p.product]) totals[p.product] = { tdi_index: 0, tdi_imports: 0, n: 0 };
        totals[p.product].tdi_index += p.tdi_index;
        if (p.tdi_imports != null) totals[p.product].tdi_imports += p.tdi_imports;
        totals[p.product].n += 1;
      });
    });
    var rows = Object.keys(totals).map(function (prod) {
      var t = totals[prod];
      return {
        label: prod,
        tdi_index: t.tdi_index,
        tdi_imports: t.n ? t.tdi_imports / t.n : null
      };
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    var result = {
      records: takeTop10(rows),
      title: 'Top HS4 Products in ' + scopeLabel + ' — ' + sector
    };
    _aggCache[key] = result;
    return result;
  }

  function incomesForProduct(product) {
    var key = _key('incForProd', product);
    if (_aggCache[key]) return _aggCache[key];
    var sums = {};
    INCOME_LIST.forEach(function (i) { sums[i] = { tdi_index: 0, tdi_imports: 0, n: 0 }; });
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      var inc = COUNTRY_INCOME[iso];
      if (!inc || !sums[inc]) return;
      var arr = TDI_DATA.products_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          if (arr[i].tdi_index != null) { sums[inc].tdi_index += arr[i].tdi_index; sums[inc].n++; }
          if (arr[i].tdi_imports != null) sums[inc].tdi_imports += arr[i].tdi_imports;
          break;
        }
      }
    });
    var records = INCOME_LIST.map(function (i) {
      var s = sums[i];
      return {
        label: i,
        tdi_index: s.n ? s.tdi_index : null,
        tdi_imports: s.n ? s.tdi_imports / s.n : null
      };
    }).sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var result = { records: records, title: 'TDI by Income Group for ' + product };
    _aggCache[key] = result;
    return result;
  }

  function regionsInScopeForProduct(product, income) {
    var key = _key('regForProd', product, income);
    if (_aggCache[key]) return _aggCache[key];
    var sums = {};
    REGION_DROPDOWN_ORDER.forEach(function (r) { sums[r] = { tdi_index: 0, tdi_imports: 0, n: 0 }; });
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      var arr = TDI_DATA.products_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          var v = arr[i].tdi_index;
          var imp = arr[i].tdi_imports;
          // Belongs to its col-B region AND possibly EU
          var reg = COUNTRY_REGION[iso];
          if (reg && sums[reg]) {
            if (v != null)   { sums[reg].tdi_index += v; sums[reg].n++; }
            if (imp != null) sums[reg].tdi_imports += imp;
          }
          if (EU_SET[iso] && sums['EU']) {
            if (v != null)   { sums['EU'].tdi_index += v; sums['EU'].n++; }
            if (imp != null) sums['EU'].tdi_imports += imp;
          }
          break;
        }
      }
    });
    var records = REGION_DROPDOWN_ORDER.map(function (r) {
      var s = sums[r];
      if (!s.n) return null;
      return { label: r, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports / s.n };
    }).filter(Boolean);
    records.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var result = { records: records, title: 'TDI by Region within ' + income + ' for ' + product };
    _aggCache[key] = result;
    return result;
  }

  function countriesInScopeForProduct(product, region, income) {
    // Filter products_by_country to ISOs in (income ∩ region), pull the row
    // for `product`, sort desc, top-10.
    var rows = [];
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region))  return;
      var arr = TDI_DATA.products_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          if (arr[i].tdi_index != null) {
            var c = COUNTRY_BY_ISO[iso];
            rows.push({
              label: c ? c.name : iso,
              iso: iso,
              tdi_index: arr[i].tdi_index,
              tdi_imports: arr[i].tdi_imports
            });
          }
          break;
        }
      }
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    return {
      records: takeTop10(rows),
      title: 'Top Countries by TDI in ' + scopeLabel + ' — ' + product
    };
  }

  function singleBarCountryProduct(iso, product, sector) {
    var arr = TDI_DATA.products_by_country[iso] || [];
    var hit = arr.find(function (p) { return p.product === product; });
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    return {
      records: hit ? [{
        label: product, iso: iso,
        tdi_index: hit.tdi_index, tdi_imports: hit.tdi_imports
      }] : [],
      title: 'TDI for ' + product + ' in ' + name +
             (sector ? ' (Sector: ' + sector + ')' : '')
    };
  }

  function singleBarCell(I, R, Csingle, S, P) {
    return singleBarCountryProduct(Csingle, P, S);
  }

  function countryComparison(isos, I, R, S, P) {
    // For 2-5 countries: show their TDI bars (filtered by sector/product if set).
    var rows = isos.map(function (iso) {
      var v, imp;
      if (P) {
        var arr = TDI_DATA.products_by_country[iso] || [];
        var hit = arr.find(function (p) { return p.product === P; });
        v = hit ? hit.tdi_index : null;
        imp = hit ? hit.tdi_imports : null;
      } else if (S) {
        var sarr = TDI_DATA.sectors_by_country[iso] || [];
        var hits = sarr.find(function (s) { return s.sector === S; });
        v = hits ? hits.tdi_index : null;
        imp = hits ? hits.tdi_imports : null;
      } else {
        var c = COUNTRY_BY_ISO[iso];
        v = c ? c.tdi_index : null;
        imp = c ? c.tdi_imports : null;
      }
      var c2 = COUNTRY_BY_ISO[iso];
      return {
        label: c2 ? c2.name : iso, iso: iso,
        tdi_index: v, tdi_imports: imp
      };
    }).filter(function (r) { return r.tdi_index != null; });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var filterLabel = P ? (' — ' + P) : (S ? (' — ' + S) : '');
    return {
      records: rows,
      title: 'Country Comparison (' + isos.length + ' countries)' + filterLabel
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEW BUILDERS (v6) — single bars, axis breakdowns, sector comparison
  // ─────────────────────────────────────────────────────────────────────────

  // ── Single-bar builders ────────────────────────────────────────────────
  function singleBarIncome(income) {
    var a = INCOME_AGG[income] || {};
    return {
      records: (a.tdi_index != null) ? [{ label: income, tdi_index: a.tdi_index, tdi_imports: a.tdi_imports }] : [],
      title: 'TDI — ' + income
    };
  }

  function singleBarRegion(region, income) {
    // If income is specific, region value = aggregate of that region within income.
    if (income) {
      var sum = 0, imp = 0, n = 0;
      (TDI_DATA.countries_by_income[income] || []).forEach(function (c) {
        if (!isMemberOfRegion(c.iso, region)) return;
        if (c.tdi_index != null)   { sum += c.tdi_index; n++; }
        if (c.tdi_imports != null) imp += c.tdi_imports;
      });
      return {
        records: n ? [{ label: region, tdi_index: sum, tdi_imports: imp / n }] : [],
        title: 'TDI — ' + income + ' ∩ ' + region
      };
    }
    var a = REGION_AGG[region] || {};
    return {
      records: (a.tdi_index != null) ? [{ label: region, tdi_index: a.tdi_index, tdi_imports: a.tdi_imports }] : [],
      title: 'TDI — ' + region
    };
  }

  function singleBarCountry(iso, sectorFilter, productFilter) {
    var v, imp;
    if (productFilter) {
      var arr = TDI_DATA.products_by_country[iso] || [];
      var hit = arr.find(function (p) { return p.product === productFilter; });
      v = hit ? hit.tdi_index : null; imp = hit ? hit.tdi_imports : null;
    } else if (sectorFilter) {
      var sarr = TDI_DATA.sectors_by_country[iso] || [];
      var sh = sarr.find(function (s) { return s.sector === sectorFilter; });
      v = sh ? sh.tdi_index : null; imp = sh ? sh.tdi_imports : null;
    } else {
      var c = COUNTRY_BY_ISO[iso];
      v = c ? c.tdi_index : null; imp = c ? c.tdi_imports : null;
    }
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    var suffix = productFilter ? (' — ' + productFilter) : (sectorFilter ? (' — ' + sectorFilter) : '');
    return {
      records: (v != null) ? [{ label: name, iso: iso, tdi_index: v, tdi_imports: imp }] : [],
      title: 'TDI — ' + name + suffix
    };
  }

  function singleBarCountrySector(iso, sector) {
    var sarr = TDI_DATA.sectors_by_country[iso] || [];
    var sh = sarr.find(function (s) { return s.sector === sector; });
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    return {
      records: (sh && sh.tdi_index != null) ? [{ label: sector, iso: iso, tdi_index: sh.tdi_index, tdi_imports: sh.tdi_imports }] : [],
      title: 'TDI — ' + name + ' — ' + sector
    };
  }

  // Single sector bar within geo scope (income/region specific or global).
  function singleBarSectorScope(sector, region, income) {
    var v = null, imp = null, n = 0, sum = 0, isum = 0;
    if (!income && !region) {
      var g = SECTOR_GLOBAL_BY_LABEL[sector] || {};
      v = (g.tdi_index != null) ? g.tdi_index : null; imp = g.tdi_imports;
    } else {
      Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
        if (income && COUNTRY_INCOME[iso] !== income) return;
        if (region && !isMemberOfRegion(iso, region)) return;
        (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
          if (s.sector !== sector || s.tdi_index == null) return;
          sum += s.tdi_index; n++;
          if (s.tdi_imports != null) isum += s.tdi_imports;
        });
      });
      v = n ? sum : null; imp = n ? isum / n : null;
    }
    var scope = [income, region].filter(Boolean).join(' ∩ ');
    return {
      records: (v != null) ? [{ label: sector, tdi_index: v, tdi_imports: imp }] : [],
      title: 'TDI — ' + (scope ? scope + ' — ' : '') + sector
    };
  }

  // Single product bar within scope (sector/region/income specific or global).
  function singleBarProductScope(product, sector, region, income) {
    var n = 0, sum = 0, isum = 0;
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region)) return;
      var arr = sector
        ? ((TDI_DATA.products_by_country_sector[iso] || {})[sector] || [])
        : (TDI_DATA.products_by_country[iso] || []);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          if (arr[i].tdi_index != null) { sum += arr[i].tdi_index; n++; }
          if (arr[i].tdi_imports != null) isum += arr[i].tdi_imports;
          break;
        }
      }
    });
    if (!income && !region && !sector) {
      // fall back to global product aggregate if present
      var pg = (TDI_DATA.products_global || []).find(function (p) { return p.product === product; });
      if (pg && pg.tdi_index != null) { return { records: [{ label: product, tdi_index: pg.tdi_index, tdi_imports: pg.tdi_imports }], title: 'TDI — ' + product }; }
    }
    var scope = [income, region, sector].filter(Boolean).join(' ∩ ');
    return {
      records: n ? [{ label: product, tdi_index: sum, tdi_imports: isum / n }] : [],
      title: 'TDI — ' + (scope ? scope + ' — ' : '') + product
    };
  }

  // ── Income axis ─────────────────────────────────────────────────────────
  function incomesForSector(sector) {
    var key = _key('incForSec', sector);
    if (_aggCache[key]) return _aggCache[key];
    var sums = {};
    INCOME_LIST.forEach(function (i) { sums[i] = { tdi_index: 0, tdi_imports: 0, n: 0 }; });
    Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
      var inc = COUNTRY_INCOME[iso];
      if (!inc || !sums[inc]) return;
      (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
        if (s.sector !== sector || s.tdi_index == null) return;
        sums[inc].tdi_index += s.tdi_index; sums[inc].n++;
        if (s.tdi_imports != null) sums[inc].tdi_imports += s.tdi_imports;
      });
    });
    var records = INCOME_LIST.map(function (i) {
      var s = sums[i];
      return { label: i, tdi_index: s.n ? s.tdi_index : null, tdi_imports: s.n ? s.tdi_imports / s.n : null };
    }).sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var result = { records: records, title: 'TDI by Income Group — ' + sector };
    _aggCache[key] = result;
    return result;
  }

  // ── Region axis ───────────────────────────────────────────────────────
  function regionsGlobalAxis() {
    var records = [];
    REGION_DROPDOWN_ORDER.forEach(function (r) {
      var a = REGION_AGG[r];
      if (a && a.tdi_index != null) {
        records.push({ label: r, tdi_index: a.tdi_index, tdi_imports: a.tdi_imports });
      }
    });
    records.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return { records: records, title: 'TDI by Region' };
  }

  function regionsForProduct(product, income) {
    // reuse existing region-for-product aggregator (income may be null)
    var key = _key('regForProd2', product, income || '');
    if (_aggCache[key]) return _aggCache[key];
    var sums = {};
    REGION_DROPDOWN_ORDER.forEach(function (r) { sums[r] = { tdi_index: 0, tdi_imports: 0, n: 0 }; });
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      var arr = TDI_DATA.products_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          var v = arr[i].tdi_index, imp = arr[i].tdi_imports;
          var reg = COUNTRY_REGION[iso];
          if (reg && sums[reg]) { if (v != null) { sums[reg].tdi_index += v; sums[reg].n++; } if (imp != null) sums[reg].tdi_imports += imp; }
          if (EU_SET[iso] && sums['EU']) { if (v != null) { sums['EU'].tdi_index += v; sums['EU'].n++; } if (imp != null) sums['EU'].tdi_imports += imp; }
          break;
        }
      }
    });
    var records = REGION_DROPDOWN_ORDER.map(function (r) {
      var s = sums[r];
      if (!s.n) return null;
      return { label: r, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports / s.n };
    }).filter(Boolean);
    records.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = income ? (' within ' + income) : '';
    var result = { records: records, title: 'TDI by Region' + scopeLabel + ' — ' + product };
    _aggCache[key] = result;
    return result;
  }

  function regionsForSector(sector, income) {
    var key = _key('regForSec', sector, income || '');
    if (_aggCache[key]) return _aggCache[key];
    var sums = {};
    REGION_DROPDOWN_ORDER.forEach(function (r) { sums[r] = { tdi_index: 0, tdi_imports: 0, n: 0 }; });
    Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
        if (s.sector !== sector || s.tdi_index == null) return;
        var reg = COUNTRY_REGION[iso];
        if (reg && sums[reg]) { sums[reg].tdi_index += s.tdi_index; sums[reg].n++; if (s.tdi_imports != null) sums[reg].tdi_imports += s.tdi_imports; }
        if (EU_SET[iso] && sums['EU']) { sums['EU'].tdi_index += s.tdi_index; sums['EU'].n++; if (s.tdi_imports != null) sums['EU'].tdi_imports += s.tdi_imports; }
      });
    });
    var records = REGION_DROPDOWN_ORDER.map(function (r) {
      var s = sums[r];
      if (!s.n) return null;
      return { label: r, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports / s.n };
    }).filter(Boolean);
    records.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = income ? (' within ' + income) : '';
    var result = { records: records, title: 'TDI by Region' + scopeLabel + ' — ' + sector };
    _aggCache[key] = result;
    return result;
  }

  // ── Country axis ──────────────────────────────────────────────────────
  function countriesGlobalAxis() {
    var pool = (TDI_DATA.country_universe || []).filter(function (c) { return c.tdi_index != null; });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(pool).map(function (c) {
        return { label: c.name || c.iso, iso: c.iso, tdi_index: c.tdi_index, tdi_imports: c.tdi_imports };
      }),
      title: 'Top Countries with Highest TDI'
    };
  }

  function countriesInIncome(income) {
    var pool = (TDI_DATA.countries_by_income[income] || []).filter(function (c) { return c.tdi_index != null; });
    pool.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(pool).map(function (c) {
        return { label: c.name || c.iso, iso: c.iso, tdi_index: c.tdi_index, tdi_imports: c.tdi_imports };
      }),
      title: 'Top Countries with Highest TDI in ' + income
    };
  }

  function countriesForProductGlobal(product) {
    return countriesInScopeForProduct(product, null, null);
  }

  function countriesInScopeForSector(sector, region, income) {
    var rows = [];
    Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region)) return;
      var arr = TDI_DATA.sectors_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].sector === sector) {
          if (arr[i].tdi_index != null) {
            var c = COUNTRY_BY_ISO[iso];
            rows.push({ label: c ? c.name : iso, iso: iso, tdi_index: arr[i].tdi_index, tdi_imports: arr[i].tdi_imports });
          }
          break;
        }
      }
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    return {
      records: takeTop10(rows),
      title: 'Top Countries by TDI' + (scopeLabel ? ' in ' + scopeLabel : '') + ' — ' + sector
    };
  }

  // ── Sector axis ───────────────────────────────────────────────────────
  function sectorsGlobalAxis() {
    var arr = (TDI_DATA.sectors_global || []).filter(function (s) { return s.tdi_index != null; });
    var sorted = arr.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(sorted).map(function (s) { return { label: s.sector, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports }; }),
      title: 'Top HS2 Sectors with Highest TDI'
    };
  }

  function sectorsInIncome(income) {
    var arr = (TDI_DATA.sectors_by_income[income] || []).filter(function (s) { return s.tdi_index != null; });
    var sorted = arr.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(sorted).map(function (s) { return { label: s.sector, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports }; }),
      title: 'Top HS2 Sectors with Highest TDI in ' + income
    };
  }

  function sectorsInRegion(region) {
    var arr = (TDI_DATA.sectors_by_region[region] || []).filter(function (s) { return s.tdi_index != null; });
    var sorted = arr.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(sorted).map(function (s) { return { label: s.sector, tdi_index: s.tdi_index, tdi_imports: s.tdi_imports }; }),
      title: 'Top HS2 Sectors with Highest TDI in ' + region
    };
  }

  function sectorsInScopeGeo(region, income) {
    var key = _key('secScopeGeo', region || '', income || '');
    if (_aggCache[key]) return _aggCache[key];
    var totals = {};
    Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region)) return;
      (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
        if (s.tdi_index == null) return;
        if (!totals[s.sector]) totals[s.sector] = { tdi_index: 0, tdi_imports: 0, n: 0 };
        totals[s.sector].tdi_index += s.tdi_index;
        if (s.tdi_imports != null) totals[s.sector].tdi_imports += s.tdi_imports;
        totals[s.sector].n += 1;
      });
    });
    var rows = Object.keys(totals).map(function (k) {
      var t = totals[k];
      return { label: k, tdi_index: t.tdi_index, tdi_imports: t.n ? t.tdi_imports / t.n : null };
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    var result = { records: takeTop10(rows), title: 'Top HS2 Sectors in ' + scopeLabel };
    _aggCache[key] = result;
    return result;
  }

  // ── Product axis ──────────────────────────────────────────────────────
  function productsGlobalAxis() {
    var arr = (TDI_DATA.products_global || []).filter(function (p) { return p.tdi_index != null; });
    var sorted = arr.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(sorted).map(function (p) { return { label: p.product, tdi_index: p.tdi_index, tdi_imports: p.tdi_imports }; }),
      title: 'Top HS4 Products with Highest TDI'
    };
  }

  function productsInCountryScope(iso, sector) {
    if (sector) return productsInCountrySector(iso, sector);
    var arr = (TDI_DATA.products_by_country[iso] || []).filter(function (p) { return p.tdi_index != null; });
    var name = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
    var sorted = arr.slice().sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    return {
      records: takeTop10(sorted).map(function (p) { return { label: p.product, iso: iso, tdi_index: p.tdi_index, tdi_imports: p.tdi_imports }; }),
      title: 'Top HS4 Products in ' + name
    };
  }

  // Products by geo scope, optional sector filter (income/region specific or global).
  function productsInScopeGeo(sector, region, income) {
    if (sector) return productsInScope(sector, region, income);
    var key = _key('prodGeo', region || '', income || '');
    if (_aggCache[key]) return _aggCache[key];
    var totals = {};
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region)) return;
      (TDI_DATA.products_by_country[iso] || []).forEach(function (p) {
        if (p.tdi_index == null) return;
        if (!totals[p.product]) totals[p.product] = { tdi_index: 0, tdi_imports: 0, n: 0 };
        totals[p.product].tdi_index += p.tdi_index;
        if (p.tdi_imports != null) totals[p.product].tdi_imports += p.tdi_imports;
        totals[p.product].n += 1;
      });
    });
    var rows = Object.keys(totals).map(function (k) {
      var t = totals[k];
      return { label: k, tdi_index: t.tdi_index, tdi_imports: t.n ? t.tdi_imports / t.n : null };
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    var result = { records: takeTop10(rows), title: 'Top HS4 Products' + (scopeLabel ? ' in ' + scopeLabel : '') };
    _aggCache[key] = result;
    return result;
  }

  // ── Sector comparison (2+ sectors selected) ────────────────────────────
  function sectorComparison(sectors, I, R, Csingle, P) {
    var rows = sectors.map(function (sector) {
      var v = null, imp = null;
      if (Csingle) {
        var sarr = TDI_DATA.sectors_by_country[Csingle] || [];
        var sh = sarr.find(function (s) { return s.sector === sector; });
        v = sh ? sh.tdi_index : null; imp = sh ? sh.tdi_imports : null;
      } else if (I || R) {
        var n = 0, sum = 0, isum = 0;
        Object.keys(TDI_DATA.sectors_by_country).forEach(function (iso) {
          if (I && COUNTRY_INCOME[iso] !== I) return;
          if (R && !isMemberOfRegion(iso, R)) return;
          (TDI_DATA.sectors_by_country[iso] || []).forEach(function (s) {
            if (s.sector !== sector || s.tdi_index == null) return;
            sum += s.tdi_index; n++;
            if (s.tdi_imports != null) isum += s.tdi_imports;
          });
        });
        v = n ? sum : null; imp = n ? isum / n : null;
      } else {
        var g = SECTOR_GLOBAL_BY_LABEL[sector] || {};
        v = (g.tdi_index != null) ? g.tdi_index : null; imp = g.tdi_imports;
      }
      return { label: sector, tdi_index: v, tdi_imports: imp };
    }).filter(function (r) { return r.tdi_index != null; });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = Csingle
      ? (COUNTRY_BY_ISO[Csingle] ? COUNTRY_BY_ISO[Csingle].name : Csingle)
      : [I, R].filter(Boolean).join(' ∩ ');
    var titleHead = state.allSectors
      ? 'All sectors (top 10 by TDI)'
      : 'Sector Comparison (' + sectors.length + ' sectors)';
    return {
      records: rows,
      title: titleHead + (scopeLabel ? ' — ' + scopeLabel : '')
    };
  }

  function renderGlobalLineChart() {
    // Filter to September 2024 onwards
    var data = TDI_DATA.global.tdi.filter(function (r) {
      return r.date && r.date >= '2024-09-01';
    });
    var dates = data.map(function (r) { return r.date; });
    var traces = [
      { x: dates,
        y: data.map(function (r) { return r.upper; }),
        type: 'scatter', mode: 'lines', name: 'TDI',
        line: { color: '#1F6FB0', width: 2.5 },
        hovertemplate: '<b>%{x|%b %Y}</b>: %{y:.3f}<extra>TDI</extra>' },
      { x: dates,
        y: data.map(function (r) { return r.lower; }),
        type: 'scatter', mode: 'lines', name: 'TDI (excl. outliers)',
        line: { color: '#A8C8E6', width: 2.5 },
        hovertemplate: '<b>%{x|%b %Y}</b>: %{y:.3f}<extra>TDI (excl. outliers)</extra>' }
    ];
    var layout = {
      title: { text: '<b>Global Trade Deflection</b>',
               font: { size: 16, family: FONT_FAMILY, color: '#111' },
               x: 0.5, xanchor: 'center', y: 0.97, yanchor: 'top' },
      xaxis: { type: 'date', tickformat: '%b-%y',
               tickfont: { size: 12, family: FONT_FAMILY } },
      yaxis: { title: { text: 'USD gained or lost in third markets per $1.00 USD<br>of exports lost in the U.S. market',
                        font: { size: 11, family: FONT_FAMILY } },
               tickfont: { size: 12, family: FONT_FAMILY },
               zeroline: true, zerolinecolor: '#E8746A', zerolinewidth: 2,
               gridcolor: '#ececec' },
      legend: { orientation: 'h', x: 0, xanchor: 'left',
                y: -0.18, yanchor: 'top',
                font: { size: 11, family: FONT_FAMILY } },
      paper_bgcolor: 'white', plot_bgcolor: 'white',
      font: { family: FONT_FAMILY },
      margin: { l: 75, r: 25, t: 50, b: 90 },
      hovermode: 'x unified',
      shapes: [
        { type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: 0, y1: 0,
          line: { color: '#E8746A', width: 2 }, layer: 'below' },
        { type: 'line', xref: 'x', yref: 'paper',
          x0: '2025-02-01', x1: '2025-02-01', y0: 0, y1: 1,
          line: { color: '#C0392B', width: 1.8, dash: 'solid' } }
      ],
      annotations: [
        { x: '2025-02-01', y: 1, xref: 'x', yref: 'paper',
          text: 'February 2025', showarrow: false,
          xanchor: 'left', yanchor: 'top',
          xshift: 4, yshift: -4,
          font: { family: FONT_FAMILY, size: 10, color: '#C0392B' } }
      ]
    };
    Plotly.react('main-chart', traces, layout, PLOTLY_CONFIG);
    setNote(NOTES.global_tdi);
  }

  // Interpretation chart — visual replica of the IMF "interpretation" graphic.
  //   Left  gray column:  $1.00   "U.S. market loss"
  //   Right blue column:  stacked: solid blue ($lower) + light blue ($upper - $lower)
  //                        with "Third-market gain" caption
  // Values: lower = global.headline.cumulative_lower; upper = global.headline.cumulative_upper.
  // (Hardcoded $1.00 on the loss side per the visual design.)
  function renderInterpretationChart() {
    var h = TDI_DATA.global.headline || {};
    var lower = (typeof h.cumulative_lower === 'number') ? h.cumulative_lower : null;
    var upper = (typeof h.cumulative_upper === 'number') ? h.cumulative_upper : null;
    var gap   = (lower != null && upper != null) ? (upper - lower) : null;

    var lossColor      = '#A6A6A6';   // gray
    var gainSolidColor = '#1F4E79';   // solid blue (lower)
    var gainExtraColor = '#A8C8E6';   // light blue (upper - lower)

    var lossX = ['U.S. market loss'];
    var gainX = ['Third-market gain'];

    // The visual is: bar1 (loss, gray, height $1.00); bar2 (gain, two stacked segments).
    // We use Plotly bar with `barmode: 'stack'` and explicit x positions per trace.
    var traces = [
      {
        type: 'bar',
        x: lossX, y: [1.00],
        marker: { color: lossColor },
        text: ['$1.00'],
        textposition: 'outside',
        textfont: { family: FONT_FAMILY, size: 18, color: '#111' },
        cliponaxis: false,
        name: 'U.S. market loss',
        hovertemplate: '<b>U.S. market loss</b>: $1.00<extra></extra>',
        width: [0.45]
      },
      {
        type: 'bar',
        x: gainX, y: [lower != null ? lower : 0],
        marker: { color: gainSolidColor },
        text: [lower != null ? ('$' + lower.toFixed(2)) : ''],
        textposition: 'inside',
        textfont: { family: FONT_FAMILY, size: 14, color: '#fff' },
        insidetextanchor: 'middle',
        name: 'Third-market gain (excl. outliers)',
        hovertemplate: '<b>Third-market gain (lower)</b>: $' + (lower != null ? lower.toFixed(2) : '—') + '<extra></extra>',
        width: [0.45]
      },
      {
        type: 'bar',
        x: gainX, y: [gap != null ? gap : 0],
        marker: { color: gainExtraColor },
        text: [upper != null ? ('$' + upper.toFixed(2)) : ''],
        textposition: 'outside',
        textfont: { family: FONT_FAMILY, size: 14, color: '#111' },
        cliponaxis: false,
        name: 'Third-market gain (full range to upper)',
        hovertemplate: '<b>Third-market gain (upper)</b>: $' + (upper != null ? upper.toFixed(2) : '—') + '<extra></extra>',
        width: [0.45]
      }
    ];

    // Build annotations: arrow + range label above the gain bar
    var rangeLabel = (lower != null && upper != null)
      ? ('$' + lower.toFixed(2) + ' – $' + upper.toFixed(2))
      : '';
    var annotations = [];
    if (rangeLabel) {
      annotations.push({
        x: 'Third-market gain',
        y: upper,
        yshift: 30,
        text: '<b>' + rangeLabel + '</b>',
        showarrow: false,
        font: { family: FONT_FAMILY, size: 18, color: '#1F4E79' }
      });
    }
    // Arrow from loss to gain, mid-height of loss bar
    annotations.push({
      x: 0.5, y: 0.5,
      xref: 'paper', yref: 'paper',
      ax: -55, ay: 0,
      axref: 'pixel', ayref: 'pixel',
      showarrow: true,
      arrowhead: 3,
      arrowsize: 1.4,
      arrowwidth: 2,
      arrowcolor: '#1F4E79',
      text: ''
    });

    var layout = {
      title: {
        text: '<b>Global Trade Deflection</b><br>' +
              '<span style="font-size:12px;font-weight:400;color:#555;">' +
              'Interpretation: For every $1.00 lost in the U.S. market, China gained between $' +
              (lower != null ? lower.toFixed(2) : '—') + ' and $' +
              (upper != null ? upper.toFixed(2) : '—') + ' in third markets.</span>',
        font: { size: 16, family: FONT_FAMILY, color: '#111' },
        x: 0.5, xanchor: 'center', y: 0.97, yanchor: 'top'
      },
      barmode: 'stack',
      xaxis: {
        type: 'category',
        categoryorder: 'array',
        categoryarray: ['U.S. market loss', 'Third-market gain'],
        tickfont: { family: FONT_FAMILY, size: 14, color: '#111' },
        showline: true, linecolor: '#222', linewidth: 1.5,
        showgrid: false, zeroline: false,
        fixedrange: true
      },
      yaxis: {
        visible: false,
        zeroline: false, showgrid: false,
        range: [0, Math.max(1.0, (upper != null ? upper : 1.0)) * 1.35],
        fixedrange: true
      },
      annotations: annotations,
      paper_bgcolor: 'white', plot_bgcolor: 'white',
      font: { family: FONT_FAMILY },
      margin: { l: 30, r: 30, t: 100, b: 80 },
      showlegend: false,
      bargap: 0.4
    };

    Plotly.react('main-chart', traces, layout, PLOTLY_CONFIG);
    noteEl.innerHTML =
      '<em>Note: Cumulative since February 2025. Positive values suggest possible ' +
      'trade deflection and negative values, a contraction across markets. ' +
      'See "How is it interpreted?" for further detail. ' +
      'Range reflects sensitivity to outlier treatment.</em>' +
      '<br><em>Source: Trade Deflection Index based on Trade Data Monitor; IMF staff calculations.</em>';
  }

  function renderGlobalStackedBarChart() {
    // Filter to September 2024 onwards
    var data = TDI_DATA.global.gainloss.filter(function (r) {
      return r.date && r.date >= '2024-09-01';
    });
    var dates = data.map(function (r) { return r.date; });
    var gainBase  = data.map(function (r) { return r.gain_lower; });
    var gainExtra = data.map(function (r) {
      if (r.gain_upper == null || r.gain_lower == null) return null;
      return r.gain_upper - r.gain_lower;
    });
    var lossBase  = data.map(function (r) { return r.loss_lower; });
    var lossExtra = data.map(function (r) {
      if (r.loss_upper == null || r.loss_lower == null) return null;
      return r.loss_upper - r.loss_lower;
    });
    var traces = [
      { type: 'bar', name: 'Third-market gain (excl. outliers)',
        x: dates, y: gainBase, marker: { color: COLOR_GAIN_BASE } },
      { type: 'bar', name: 'Loss in the U.S. (excl. outliers)',
        x: dates, y: lossBase, marker: { color: COLOR_LOSS_BASE } },
      { type: 'bar', name: 'Third-market gain',
        x: dates, y: gainExtra, marker: { color: COLOR_GAIN_EXTRA } },
      { type: 'bar', name: 'Loss in the U.S.',
        x: dates, y: lossExtra, marker: { color: COLOR_LOSS_EXTRA } }
    ];
    var layout = {
      title: { text: '<b>Global Trade Deflection</b><br><span style="font-size:12px;font-weight:400;color:#555;">(bln USD)</span>',
               font: { size: 16, family: FONT_FAMILY, color: '#111' },
               x: 0.5, xanchor: 'center', y: 0.97, yanchor: 'top' },
      barmode: 'relative',
      xaxis: { type: 'date', tickformat: '%b-%y',
               tickfont: { size: 11, family: FONT_FAMILY } },
      yaxis: { tickfont: { size: 12, family: FONT_FAMILY },
               zeroline: true, zerolinecolor: '#888', zerolinewidth: 1.2,
               gridcolor: '#ececec' },
      legend: { orientation: 'h', x: 0, xanchor: 'left',
                y: -0.18, yanchor: 'top',
                font: { size: 11, family: FONT_FAMILY } },
      paper_bgcolor: 'white', plot_bgcolor: 'white',
      font: { family: FONT_FAMILY },
      margin: { l: 60, r: 25, t: 70, b: 90 },
      hovermode: 'x unified',
      shapes: [
        { type: 'line', xref: 'x', yref: 'paper',
          x0: '2025-02-01', x1: '2025-02-01', y0: 0, y1: 1,
          line: { color: '#C0392B', width: 1.8, dash: 'solid' } }
      ],
      annotations: [
        { x: '2025-02-01', y: 1, xref: 'x', yref: 'paper',
          text: 'February 2025', showarrow: false,
          xanchor: 'left', yanchor: 'top',
          xshift: 4, yshift: -4,
          font: { family: FONT_FAMILY, size: 10, color: '#C0392B' } }
      ]
    };
    Plotly.react('main-chart', traces, layout, PLOTLY_CONFIG);
    setNote(NOTES.global_gainloss);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL DECOMPOSITION STACKED-BAR (by region / by sector)
  //
  // Each series is a stacked bar of third-market gain in bln USD; a black dot
  // marks the net (sum across buckets) per month. Mirrors the source figures.
  // ─────────────────────────────────────────────────────────────────────────

  // Palettes approximate the source-figure legends. Order matches the `series`
  // order built in build_data.py.
  var DECOMP_COLORS_REGION = [
    '#F1A9A0', // ASEAN — salmon
    '#C0392B', // Asia & Pacific (excl. ASEAN) — red
    '#2E6DA4', // EU — blue
    '#AED4E6', // Europe (excl. EU) — light blue
    '#9B6A8C', // Africa — plum
    '#C8B273', // Middle East & C. Asia — khaki
    '#E08E3C', // Western Hemisphere — orange
    '#9AA0A6'  // Rest of world — grey
  ];
  var DECOMP_COLORS_SECTOR = [
    '#2E6DA4', // HS85 Electrical machinery — blue
    '#2C6E6E', // HS84 Machinery & appliances — teal
    '#5BAEDC', // HS98 Special classifications — light blue
    '#6E8B3D', // HS87 Vehicles — green
    '#7FA8C9', // HS73 Articles of iron & steel — steel
    '#C0392B', // HS39 Plastics — red
    '#8E5A7A', // HS90 Optical/medical instr. — mauve
    '#B6C29A', // HS38 Misc. chemical products — sage
    '#E0C13C', // HS71 Precious metals & stones — gold
    '#E08E3C', // HS40 Rubber — orange
    '#BFC4C9'  // Other sectors — grey
  ];

  function renderGlobalDecomp(block, colors, title, noteKey) {
    // Filter to September 2024 onwards (matches the other global figures)
    var rows = (block.rows || []).filter(function (r) {
      return r.date && r.date >= '2024-09-01';
    });
    var dates = rows.map(function (r) { return r.date; });

    var traces = block.series.map(function (s, i) {
      return {
        type: 'bar',
        name: s.label,
        x: dates,
        y: rows.map(function (r) {
          var v = r[s.key];
          return (v === undefined ? null : v);
        }),
        marker: { color: colors[i % colors.length] }
      };
    });

    // Net dot
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: 'Net third-market gain',
      x: dates,
      y: rows.map(function (r) { return r.net; }),
      marker: { color: '#111111', size: 6, symbol: 'circle' }
    });

    var layout = {
      title: { text: '<b>' + title + '</b><br><span style="font-size:12px;font-weight:400;color:#555;">(bln USD)</span>',
               font: { size: 16, family: FONT_FAMILY, color: '#111' },
               x: 0.5, xanchor: 'center', y: 0.97, yanchor: 'top' },
      barmode: 'relative',
      xaxis: { type: 'date', tickformat: '%b-%y',
               tickfont: { size: 11, family: FONT_FAMILY } },
      yaxis: { title: { text: 'Third-market gains and losses (USD bn)',
                        font: { size: 12, family: FONT_FAMILY } },
               tickfont: { size: 12, family: FONT_FAMILY },
               zeroline: true, zerolinecolor: '#888', zerolinewidth: 1.2,
               gridcolor: '#ececec' },
      legend: { orientation: 'h', x: 0, xanchor: 'left',
                y: -0.18, yanchor: 'top',
                font: { size: 11, family: FONT_FAMILY } },
      paper_bgcolor: 'white', plot_bgcolor: 'white',
      font: { family: FONT_FAMILY },
      margin: { l: 70, r: 25, t: 70, b: 110 },
      hovermode: 'x unified',
      shapes: [
        { type: 'line', xref: 'x', yref: 'paper',
          x0: '2025-02-01', x1: '2025-02-01', y0: 0, y1: 1,
          line: { color: '#C0392B', width: 1.8, dash: 'solid' } }
      ],
      annotations: [
        { x: '2025-02-01', y: 1, xref: 'x', yref: 'paper',
          text: 'February 2025', showarrow: false,
          xanchor: 'left', yanchor: 'top',
          xshift: 4, yshift: -4,
          font: { family: FONT_FAMILY, size: 10, color: '#C0392B' } }
      ]
    };
    Plotly.react('main-chart', traces, layout, PLOTLY_CONFIG);
    setNote(NOTES[noteKey]);
  }

  function renderGlobalRegionStacked() {
    renderGlobalDecomp(TDI_DATA.global_region, DECOMP_COLORS_REGION,
                       'Value of trade deflected by region', 'global_region');
  }

  function renderGlobalSectorStacked() {
    renderGlobalDecomp(TDI_DATA.global_sector, DECOMP_COLORS_SECTOR,
                       'Value of trade deflected by sector', 'global_sector');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HORIZONTAL BAR RENDERER (TDI view OR Share view)
  // ─────────────────────────────────────────────────────────────────────────
  function wrapLabel(s, maxChars) {
    if (!s) return s;
    if (s.length <= maxChars) return s;
    var words = s.split(' ');
    var lines = [], current = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length > maxChars) {
        if (current) { lines.push(current); current = ''; }
        while (w.length > maxChars) { lines.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
        current = w;
        continue;
      }
      if ((current + (current ? ' ' : '') + w).length <= maxChars) {
        current = current ? current + ' ' + w : w;
      } else {
        lines.push(current); current = w;
      }
    }
    if (current) lines.push(current);
    return lines.join('<br>');
  }

  function renderHorizontalBars(records, title) {
    if (!records || records.length === 0) {
      try { Plotly.purge('main-chart'); } catch (e) {}
      chartEl.innerHTML = '<div class="tdi-empty">No data available for this selection.</div>';
      noteEl.textContent = '';
      return;
    }
    var ordered = records.slice().reverse();
    var labels = ordered.map(function (r) { return r.label; });
    var MAX_LINE_CHARS = 32;
    var wrappedLabels = labels.map(function (s) { return wrapLabel(s, MAX_LINE_CHARS); });
    var maxWrapLines = wrappedLabels.reduce(function (m, s) {
      return Math.max(m, (s.match(/<br>/g) || []).length + 1);
    }, 1);
    var tickFontSize = (function () {
      if (maxWrapLines <= 1) return 12;
      if (maxWrapLines === 2) return 11;
      if (maxWrapLines === 3) return 10;
      return 9;
    })();

    var traces = [];
    var layout = {
      title: { text: '<b>' + (title || '') + '</b>',
               font: { size: 14, family: FONT_FAMILY, color: '#111' },
               x: 0.5, xanchor: 'center', y: 0.98, yanchor: 'top' },
      // For TDI view, overlay so the diamond markers sit vertically centered
      // on each bar instead of being placed in a side-by-side sub-band by
      // Plotly's default 'group' grouping logic. For share view (multiple
      // bar series), keep 'group' so series sit side-by-side.
      barmode: state.shareView ? 'group' : 'overlay',
      yaxis: { type: 'category', categoryorder: 'array',
               categoryarray: labels, tickvals: labels,
               ticktext: wrappedLabels,
               tickfont: { size: tickFontSize, family: FONT_FAMILY },
               automargin: true },
      paper_bgcolor: 'white', plot_bgcolor: 'white',
      font: { family: FONT_FAMILY },
      showlegend: true,
      legend: { orientation: 'h', x: 0, xanchor: 'left',
                y: -0.18, yanchor: 'top',
                font: { size: 11, family: FONT_FAMILY } }
    };

    if (state.shareView) {
      // SHARE VIEW — render one bar series per checked sub-option.
      var seriesDefs = [];
      if (state.shareOpts.global) {
        seriesDefs.push({
          name: 'Share of Global TDI (%)',
          color: COLOR_SHARE_GLOBAL_BAR,
          edge:  COLOR_SHARE_GLOBAL_MARKER,
          values: ordered.map(function (r) { return shareOfGlobal(r.tdi_index); })
        });
      }
      if (state.shareOpts.income && isPicked(state.income)) {
        seriesDefs.push({
          name: 'Share of Income Group TDI (%)',
          color: COLOR_SHARE_INCOME_BAR,
          edge:  COLOR_SHARE_INCOME_MARKER,
          values: ordered.map(function (r) { return shareOfIncome(r.tdi_index, state.income); })
        });
      }
      if (state.shareOpts.region && isPicked(state.region)) {
        seriesDefs.push({
          name: 'Share of Region TDI (%)',
          color: COLOR_SHARE_REGION_BAR,
          edge:  COLOR_SHARE_REGION_MARKER,
          values: ordered.map(function (r) { return shareOfRegion(r.tdi_index, state.region); })
        });
      }

      // If nothing checked, fall back to global so the chart isn't empty.
      if (seriesDefs.length === 0) {
        seriesDefs.push({
          name: 'Share of Global TDI (%)',
          color: COLOR_SHARE_GLOBAL_BAR,
          edge:  COLOR_SHARE_GLOBAL_MARKER,
          values: ordered.map(function (r) { return shareOfGlobal(r.tdi_index); })
        });
      }

      seriesDefs.forEach(function (s) {
        traces.push({
          type: 'bar', orientation: 'h', name: s.name,
          x: s.values, y: labels,
          marker: { color: s.color, line: { color: s.edge, width: 1 } },
          // Only annotate the bar with a numeric label when there's a single
          // share series — multiple series would overlap.
          text: (seriesDefs.length === 1)
                ? s.values.map(function (v) { return v != null ? fmtPct(v) + '%' : ''; })
                : null,
          textposition: (seriesDefs.length === 1) ? 'outside' : 'none',
          textfont: { family: FONT_FAMILY, size: 11, color: s.edge },
          cliponaxis: false,
          hovertemplate: '<b>%{customdata}</b><br>' + s.name.replace(' (%)', '') + ': %{x:.2f}%<extra></extra>',
          customdata: labels
        });
      });
      layout.xaxis = {
        title: { text: (seriesDefs.length === 1) ? seriesDefs[0].name : 'Share of TDI (%)',
                 font: { size: 12, family: FONT_FAMILY } },
        tickfont: { size: 11, family: FONT_FAMILY },
        zeroline: true, zerolinecolor: '#444', zerolinewidth: 2,
        gridcolor: '#ececec', automargin: true, ticksuffix: '%'
      };
      layout.margin = { l: 10, r: (seriesDefs.length === 1) ? 90 : 30, t: 60, b: 80 };
    } else {
      // TDI VIEW — bars colored by sign, with imports diamond on x2.
      var values  = ordered.map(function (r) { return r.tdi_index; });
      var imports = ordered.map(function (r) { return r.tdi_imports; });
      var barColors = values.map(function (v) {
        return (v != null && v < 0) ? COLOR_BAR_NEG : COLOR_BAR_POS;
      });

      traces.push({
        type: 'bar', orientation: 'h',
        name: 'TDI',
        x: values, y: labels,
        marker: { color: barColors },
        cliponaxis: false,
        hovertemplate: '<b>%{customdata}</b><br>TDI: %{x:.4f}<extra></extra>',
        customdata: labels,
        showlegend: true
      });

      traces.push({
        type: 'scatter', mode: 'markers', name: 'Imports (%)',
        x: imports, y: labels, xaxis: 'x2',
        marker: { color: COLOR_IMPORTS_DIAMOND, size: 8, symbol: 'diamond',
                  line: { color: '#000', width: 0.8 } },
        hovertemplate: '<b>%{y}</b><br>Imports: %{x:.2f}%<extra></extra>'
      });
      layout.xaxis = {
        title: { text: 'TDI Index', font: { size: 12, family: FONT_FAMILY } },
        tickfont: { size: 11, family: FONT_FAMILY },
        zeroline: true, zerolinecolor: '#444', zerolinewidth: 2,
        gridcolor: '#ececec', automargin: true,
        // Avoid Plotly's SI-prefix tick formatting on very small numbers
        // (which renders 0.0001 as "100μ"). Force a 4-decimal raw format.
        tickformat: '.4f',
        exponentformat: 'none'
      };
      layout.xaxis2 = {
        title: { text: 'Imports (%)', font: { size: 11, family: FONT_FAMILY }, standoff: 4 },
        tickfont: { size: 10, family: FONT_FAMILY },
        overlaying: 'x', side: 'top',
        showgrid: false, zeroline: false, visible: true, automargin: true,
        tickformat: '.2f',
        exponentformat: 'none'
      };
      layout.bargap  = 0.25;
      layout.bargroupgap = 0;
      layout.margin = { l: 10, r: 30, t: 80, b: 80 };
    }
    // Stronger reference line at index = 0 (where bars flip sign).
    layout.shapes = (layout.shapes || []).concat([
      { type: 'line', xref: 'x', yref: 'paper',
        x0: 0, x1: 0, y0: 0, y1: 1,
        line: { color: '#444', width: 2 }, layer: 'below' }
    ]);
    Plotly.react('main-chart', traces, layout, PLOTLY_CONFIG);
    setNote(NOTES.panel);
    // Refresh the dual-color legend strip ABOVE the chart. In share view we
    // hide it entirely; in TDI view we surface red/blue swatches if both
    // signs are present in the bar values.
    refreshTdiColorLegend(state.shareView ? null : ordered.map(function (r) { return r.tdi_index; }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dual-color TDI legend strip (shown ABOVE the chart when bars are mixed).
  // ─────────────────────────────────────────────────────────────────────────
  function refreshTdiColorLegend(values) {
    var existing = document.getElementById('tdi-color-legend');
    if (!values) {
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    var hasPos = values.some(function (v) { return v != null && v >= 0; });
    var hasNeg = values.some(function (v) { return v != null && v < 0; });
    if (!(hasPos && hasNeg)) {
      // Single color — let Plotly's own legend handle it
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    var html =
      '<span class="tdi-legend-item">' +
        '<span class="tdi-legend-swatch" style="background:' + COLOR_BAR_POS + ';"></span>' +
        'TDI (positive)' +
      '</span>' +
      '<span class="tdi-legend-item">' +
        '<span class="tdi-legend-swatch" style="background:' + COLOR_BAR_NEG + ';"></span>' +
        'TDI (negative)' +
      '</span>';
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'tdi-color-legend';
      existing.className = 'tdi-color-legend';
      chartEl.parentNode.insertBefore(existing, chartEl);
    }
    existing.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN DISPATCH
  // ─────────────────────────────────────────────────────────────────────────
  function render() {
    applyVisibility();
    try { Plotly.purge('main-chart'); } catch (e) {}
    chartEl.innerHTML = '';
    refreshTdiColorLegend(null);   // clear by default; renderHorizontalBars re-instates if needed

    if (state.figType === 'global_tdi')      { renderGlobalLineChart();      return; }
    if (state.figType === 'global_gainloss') { renderGlobalStackedBarChart(); return; }
    if (state.figType === 'global_region')   { renderGlobalRegionStacked();  return; }
    if (state.figType === 'global_sector')   { renderGlobalSectorStacked();  return; }
    if (state.figType === 'global_interp')   { renderInterpretationChart();  return; }

    var built = buildRecords();
    if (built && built.blocked) {
      try { Plotly.purge('main-chart'); } catch (e) {}
      chartEl.innerHTML = '<div class="tdi-blocked">' +
        '<div class="tdi-blocked-icon" aria-hidden="true">!</div>' +
        '<div class="tdi-blocked-msg">' + built.message + '</div>' +
        '</div>';
      noteEl.textContent = '';
      return;
    }
    renderHorizontalBars(built.records, built.title);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EVENT WIRING
  // ─────────────────────────────────────────────────────────────────────────
  figTypeSel.addEventListener('change', function (e) {
    state.figType = e.target.value;
    if (state.figType === 'disagg') {
      refreshIncomeDropdown();
      refreshRegionDropdown();
      refreshSectorPopover();
      refreshProductDropdown();
    }
    render();
  });

  incomeSel.addEventListener('change', function (e) {
    state.income = e.target.value;
    state.geoAutoFilled = false;   // explicit user pick
    // Income change resets downstream GEOGRAPHY only (region + country picks
    // that may now be out of scope). The industry line (sectors / All / product)
    // is independent and is preserved, but specific sector picks are re-validated
    // against the new scope.
    state.region    = null;
    state.countries = [];
    revalidateSectorsForScope();
    refreshRegionDropdown();
    refreshProductDropdown();
    updateCountryButtonLabel();
    buildCountryGroups();
    buildCountryList(countrySearch.value);
    refreshSectorPopover();
    render();
  });

  regionSel.addEventListener('change', function (e) {
    state.region = e.target.value;
    state.geoAutoFilled = false;   // explicit user pick
    state.countries = state.countries.filter(function (iso) {
      return state.region === ALL || isMemberOfRegion(iso, state.region);
    });
    revalidateSectorsForScope();
    refreshProductDropdown();
    updateCountryButtonLabel();
    buildCountryGroups();
    buildCountryList(countrySearch.value);
    refreshSectorPopover();
    render();
  });

  // Drop any specific sector picks that no longer exist in the current scope.
  // The product pick is left untouched.
  function revalidateSectorsForScope() {
    if (state.allSectors) return;   // top-10 is recomputed from scope separately
    if (state.sectors.length === 0) return;
    var available = {};
    sectorsInScope().forEach(function (s) { available[s] = true; });
    state.sectors = state.sectors.filter(function (s) { return available[s]; });
  }

  productSel.addEventListener('change', function (e) {
    state.product = e.target.value;
    // Auto-lock sector if a specific product is picked and maps to a known sector.
    if (isPicked(state.product)) {
      var found = sectorForProduct(state.product);
      if (found) {
        // Represent the locked sector as a single-sector selection.
        state.allSectors = false;
        state.sectors = [found];
        refreshSectorPopover();
      }
    }
    render();
  });

  function sectorForProduct(product) {
    for (var i = 0; i < INCOME_LIST.length; i++) {
      var bySec = TDI_DATA.products_by_income_sector[INCOME_LIST[i]] || {};
      for (var sec in bySec) {
        if (bySec[sec].some(function (p) { return p.product === product; })) return sec;
      }
    }
    return null;
  }

  shareToggle.addEventListener('change', function (e) {
    state.shareView = !e.target.checked;
    render();
  });

  if (shareOptGlobal) {
    shareOptGlobal.addEventListener('change', function (e) {
      state.shareOpts.global = !!e.target.checked;
      render();
    });
  }
  if (shareOptIncome) {
    shareOptIncome.addEventListener('change', function (e) {
      state.shareOpts.income = !!e.target.checked;
      render();
    });
  }
  if (shareOptRegion) {
    shareOptRegion.addEventListener('change', function (e) {
      state.shareOpts.region = !!e.target.checked;
      render();
    });
  }

  // ── Deselect all ─────────────────────────────────────────────────────
  if (deselectBtn) {
    deselectBtn.addEventListener('click', function () {
      state.income     = ALL;   // back to the default "All income" 3-bar view
      state.region     = null;
      state.geoAutoFilled = false;
      state.countries  = [];
      state.sectors    = [];
      state.allSectors = false;
      state.product    = null;
      refreshIncomeDropdown();
      refreshRegionDropdown();
      refreshProductDropdown();
      updateCountryButtonLabel();
      buildCountryGroups();
      buildCountryList('');
      refreshSectorPopover();
      render();
    });
  }

  // ── Country popover ──────────────────────────────────────────────────
  if (countryBtn) {
    countryBtn.addEventListener('click', function () {
      var isOpen = countryPop.classList.contains('is-open');
      if (isOpen) {
        countryPop.classList.remove('is-open');
      } else {
        buildCountryGroups();
        buildCountryList(countrySearch.value);
        countryPop.classList.add('is-open');
      }
    });
    document.addEventListener('click', function (e) {
      if (!countryWrap.contains(e.target)) {
        countryPop.classList.remove('is-open');
      }
    });
    countrySearch.addEventListener('input', function () {
      buildCountryList(countrySearch.value);
    });
    countryClear.addEventListener('click', function () {
      state.countries = [];
      state.geoAutoFilled = false;
      state.product = null;
      updateCountryButtonLabel();
      buildCountryGroups();
      buildCountryList(countrySearch.value);
      refreshProductDropdown();
      refreshSectorPopover();
      render();
    });
    countryDone.addEventListener('click', function () {
      countryPop.classList.remove('is-open');
    });
  }

  // ── Sector popover ───────────────────────────────────────────────────
  if (sectorBtn) {
    sectorBtn.addEventListener('click', function () {
      var isOpen = sectorPop.classList.contains('is-open');
      if (isOpen) {
        sectorPop.classList.remove('is-open');
      } else {
        buildSectorGroups();
        buildSectorList(sectorSearch.value);
        sectorPop.classList.add('is-open');
      }
    });
    document.addEventListener('click', function (e) {
      if (!sectorWrap.contains(e.target)) {
        sectorPop.classList.remove('is-open');
      }
    });
    sectorSearch.addEventListener('input', function () {
      buildSectorList(sectorSearch.value);
    });
    sectorClear.addEventListener('click', function () {
      state.sectors = [];
      state.allSectors = false;
      state.product = null;
      updateSectorButtonLabel();
      buildSectorGroups();
      buildSectorList(sectorSearch.value);
      refreshProductDropdown();
      render();
    });
    sectorDone.addEventListener('click', function () {
      sectorPop.classList.remove('is-open');
    });
  }

  // ── Group cascade expand/collapse + "All 5" group checkboxes ──────────
  function wireGroupToggles(wrap) {
    wrap.querySelectorAll('.compare-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var group = btn.closest('.compare-group');
        var sub = group ? group.querySelector('.compare-group-sub') : null;
        if (!sub) return;
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        sub.hidden = expanded;
        var caret = btn.querySelector('.compare-group-caret');
        if (caret) caret.textContent = expanded ? '▸' : '▾';
      });
    });
  }
  if (countryWrap) wireGroupToggles(countryWrap);
  if (sectorWrap) wireGroupToggles(sectorWrap);

  // Country group "All 5" checkboxes
  if (countryWrap) {
    countryWrap.querySelectorAll('.compare-group-allcb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var gname = cb.getAttribute('data-group');
        var members;
        if (gname === 'global')            members = top5CountriesGlobal();
        else if (gname === 'income')       members = top5CountriesInIncome(state.income);
        else if (gname === 'region')       members = top5CountriesInRegion(state.region);
        else if (gname === 'incomeregion') members = top5CountriesInIncomeRegion(state.income, state.region);
        else members = [];
        if (cb.checked) {
          members.forEach(function (m) { toggleCountry(m.value, true); });
        } else {
          members.forEach(function (m) { toggleCountry(m.value, false); });
        }
        afterCountryChange();
      });
    });
  }

  // Sector group "All 5" checkboxes
  if (sectorWrap) {
    sectorWrap.querySelectorAll('.compare-group-allcb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var gname = cb.getAttribute('data-group');
        var income = isPicked(state.income) ? state.income : null;
        var region = isPicked(state.region) ? state.region : null;
        var members = (gname === 'global')
          ? top5SectorsGlobal()
          : top5SectorsInScope(income, region);
        if (cb.checked) {
          members.forEach(function (m) { toggleSector(m.value, true); });
        } else {
          members.forEach(function (m) { toggleSector(m.value, false); });
        }
        afterSectorChange();
      });
    });
  }

  // ── Info icon hover/focus tooltips (CSS-driven; this just enables tap on mobile) ──
  var INFO_ICON_IDS = ['figure-info-icon', 'country-info-icon', 'sector-info-icon',
                       'product-info-icon', 'toggle-info-icon',
                       'measure-info-icon', 'interpret-info-icon'];
  INFO_ICON_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function (e) { e.preventDefault(); el.classList.toggle('info-open'); });
  });
  document.addEventListener('click', function (e) {
    INFO_ICON_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.contains(e.target)) el.classList.remove('info-open');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EXCEL DOWNLOAD
  // ─────────────────────────────────────────────────────────────────────────
  function downloadXLSXWorkbook(sheets, filename) {
    if (typeof XLSX === 'undefined') {
      alert('Excel export library is still loading. Please try again in a moment.');
      return;
    }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var ws = XLSX.utils.aoa_to_sheet(s.rows);
      var name = (s.name || 'Sheet').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, filename);
  }

  // ── Build "full series" records — same scope as the current chart but
  // without the top-10 cap. Returns { records, title } where each record
  // additionally carries: share_global, share_income, share_region (the
  // latter two only when the relevant dim is picked).
  function buildFullSeriesRecords() {
    // Reuse the live routing so the "full series" export always matches what
    // the chart is showing — just without the top-10 cap. We do this by
    // temporarily replacing takeTop10 with an identity function.
    //
    // In "All sectors" mode the chart only holds the top-10 labels, so to give
    // a truly full export we temporarily expand state.sectors to EVERY sector
    // in the current geographic scope (still ranked by TDI) before building.
    var saved = takeTop10;
    takeTop10 = function (arr) { return arr; };
    var savedSectors = null;
    if (state.allSectors) {
      savedSectors = state.sectors.slice();
      var income  = isPicked(state.income) ? state.income : null;
      var region  = isPicked(state.region) ? state.region : null;
      var country = scopeCountryForSectors();
      state.sectors = rankedSectorsInScope(income, region, country)
        .map(function (s) { return s.sector; });
    }
    var built;
    try {
      built = buildRecords();
    } finally {
      takeTop10 = saved;
      if (savedSectors !== null) state.sectors = savedSectors;
    }
    if (!built || built.blocked) {
      return { records: [], title: 'No data', _ctx: {} };
    }
    built._ctx = {
      I: isPicked(state.income)  ? state.income  : null,
      R: isPicked(state.region)  ? state.region  : null,
      C: singleCountry(),
      S: singleSector(),
      P: isPicked(state.product) ? state.product : null
    };
    return built;
  }

  // un-capped version of countriesInScopeForProduct
  function _countriesInScopeForProduct_full(product, region, income) {
    var rows = [];
    Object.keys(TDI_DATA.products_by_country).forEach(function (iso) {
      if (income && COUNTRY_INCOME[iso] !== income) return;
      if (region && !isMemberOfRegion(iso, region))  return;
      var arr = TDI_DATA.products_by_country[iso] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].product === product) {
          if (arr[i].tdi_index != null) {
            var c = COUNTRY_BY_ISO[iso];
            rows.push({
              label: c ? c.name : iso,
              iso: iso,
              tdi_index: arr[i].tdi_index,
              tdi_imports: arr[i].tdi_imports
            });
          }
          break;
        }
      }
    });
    rows.sort(function (a, b) { return (b.tdi_index || 0) - (a.tdi_index || 0); });
    var scopeLabel = [income, region].filter(Boolean).join(' ∩ ');
    return {
      records: rows,
      title: 'All Countries by TDI in ' + scopeLabel + ' — ' + product
    };
  }

  // Build sheet rows for a record set. Adds Share-of-Global / Share-of-Income /
  // Share-of-Region columns when those denominators are valid in the context.
  function buildSheetRows(built, mode) {
    var ctx = built._ctx || {};
    var includeIncomeShare = !!(ctx.I && INCOME_AGG[ctx.I]);
    var includeRegionShare = !!(ctx.R && REGION_AGG[ctx.R]);

    var headers = ['Rank', 'Item', 'TDI (cumulative)', 'Imports (%)', 'Share of Global TDI (%)'];
    if (includeIncomeShare) headers.push('Share of Income Group TDI (%)');
    if (includeRegionShare) headers.push('Share of Region TDI (%)');

    var rows = [headers];
    (built.records || []).forEach(function (r, i) {
      var row = [
        i + 1, r.label, r.tdi_index, r.tdi_imports,
        shareOfGlobal(r.tdi_index)
      ];
      if (includeIncomeShare) row.push(shareOfIncome(r.tdi_index, ctx.I));
      if (includeRegionShare) row.push(shareOfRegion(r.tdi_index, ctx.R));
      rows.push(row);
    });
    return rows;
  }

  // ── Full series with specific picks (item 6) ──────────────────────────────
  // When the user has specific sector(s) or country(ies) picked, the full-series
  // download keeps those picks and lists EVERY HS4 product underneath each one
  // (one worksheet per pick), rather than just the comparison bars. Returns an
  // array of { built, sheetName } or null when this layout doesn't apply.
  function buildFullSeriesByPick() {
    // Only applies to non-"All sectors" selections that contain explicit picks.
    if (state.allSectors) return null;

    var I = isPicked(state.income) ? state.income : null;
    var R = isPicked(state.region) ? state.region : null;
    var pickedSectors = state.sectors.slice();          // 1..10 sector labels
    var pickedCountries = state.countries.slice();       // 1..10 ISOs

    // Decide the dimension we expand on. Sectors take priority (industry line),
    // then countries. If neither is picked, this layout doesn't apply.
    var expandSectors = pickedSectors.length > 0;
    var expandCountries = !expandSectors && pickedCountries.length > 0;
    if (!expandSectors && !expandCountries) return null;

    var saved = takeTop10;
    takeTop10 = function (arr) { return arr; };   // uncap underlying helpers
    var out = [];
    try {
      if (expandSectors) {
        // For each picked sector, full product list within the current geo scope.
        var Csingle = (pickedCountries.length === 1) ? pickedCountries[0] : null;
        pickedSectors.forEach(function (sector) {
          var built;
          if (Csingle)      built = productsInCountryScope(Csingle, sector);
          else if (I && R)  built = productsInScope(sector, R, I);
          else if (I)       built = productsInIncomeSector(I, sector);
          else if (R)       built = productsInScope(sector, R, null);
          else              built = productsInSectorGlobal(sector);
          built._ctx = { I: I, R: R, C: Csingle, S: sector, P: null };
          out.push({ built: built, sheetName: sector });
        });
      } else {
        // Countries picked, no sector: full product list within each country.
        pickedCountries.forEach(function (iso) {
          var built = productsInCountryScope(iso, null);
          built._ctx = { I: I, R: R, C: iso, S: null, P: null };
          var nm = COUNTRY_BY_ISO[iso] ? COUNTRY_BY_ISO[iso].name : iso;
          out.push({ built: built, sheetName: nm });
        });
      }
    } finally {
      takeTop10 = saved;
    }
    return out;
  }

  // Make a worksheet name safe + unique (Excel: <=31 chars, no : \ / ? * [ ]).
  function makeSheetName(raw, used) {
    var name = String(raw || 'Sheet').replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
    var base = name, k = 2;
    while (used[name]) {
      var suffix = ' (' + k + ')';
      name = base.slice(0, 31 - suffix.length) + suffix;
      k++;
    }
    used[name] = true;
    return name;
  }

  function doDownload(mode) {
    // mode: 'current' or 'full'
    var sheets, filename;

    if (state.figType === 'global_tdi') {
      var data = TDI_DATA.global.tdi.filter(function (r) { return r.date && r.date >= '2024-09-01'; });
      var rows = [['Date', 'TDI', 'TDI (excl. outliers)']];
      // For globals, 'current' = filtered to Sep 2024+ as shown; 'full' = entire series
      var src = (mode === 'full') ? TDI_DATA.global.tdi : data;
      src.forEach(function (r) { rows.push([r.date, r.upper, r.lower]); });
      sheets = [{ name: 'Global TDI', rows: rows }];
      filename = 'tdi_global_tdi_' + mode + '.xlsx';
    } else if (state.figType === 'global_gainloss') {
      var rows2 = [['Date',
                    'Third-market gain (excl. outliers)', 'Third-market gain',
                    'Loss in the U.S. (excl. outliers)', 'Loss in the U.S.']];
      var src2 = (mode === 'full')
        ? TDI_DATA.global.gainloss
        : TDI_DATA.global.gainloss.filter(function (r) { return r.date && r.date >= '2024-09-01'; });
      src2.forEach(function (r) {
        rows2.push([r.date, r.gain_lower, r.gain_upper, r.loss_lower, r.loss_upper]);
      });
      sheets = [{ name: 'Global Gain-Loss', rows: rows2 }];
      filename = 'tdi_global_gainloss_' + mode + '.xlsx';
    } else if (state.figType === 'global_region' || state.figType === 'global_sector') {
      var block = (state.figType === 'global_region')
        ? TDI_DATA.global_region : TDI_DATA.global_sector;
      var header = ['Date'].concat(block.series.map(function (s) { return s.label; }))
                           .concat(['Net third-market gain']);
      var rowsD = [header];
      var srcD = (mode === 'full')
        ? block.rows
        : block.rows.filter(function (r) { return r.date && r.date >= '2024-09-01'; });
      srcD.forEach(function (r) {
        var line = [r.date];
        block.series.forEach(function (s) { line.push(r[s.key]); });
        line.push(r.net);
        rowsD.push(line);
      });
      var sheetName = (state.figType === 'global_region') ? 'By region' : 'By sector';
      sheets = [{ name: sheetName, rows: rowsD }];
      filename = 'tdi_' + state.figType + '_' + mode + '.xlsx';
    } else if (state.figType === 'global_interp') {
      var h = TDI_DATA.global.headline || {};
      var rowsI = [
        ['Item', 'Value (USD)'],
        ['U.S. market loss', 1.00],
        ['Third-market gain (lower)', h.cumulative_lower],
        ['Third-market gain (upper)', h.cumulative_upper]
      ];
      sheets = [{ name: 'Interpretation', rows: rowsI }];
      filename = 'tdi_global_interp.xlsx';
    } else {
      // Disaggregated
      var built;
      if (mode === 'full') {
        // If specific sector/country picks exist, list every product underneath
        // each pick (one sheet per pick). Otherwise fall back to the uncapped
        // version of the current breakdown.
        var byPick = buildFullSeriesByPick();
        if (byPick && byPick.length) {
          var usedNames = {};
          sheets = byPick.map(function (entry) {
            return {
              name: makeSheetName(entry.sheetName, usedNames),
              rows: buildSheetRows(entry.built, 'full')
            };
          });
          var pp = ['tdi', 'disagg', 'full'];
          if (isPicked(state.income))  pp.push(state.income);
          if (isPicked(state.region))  pp.push(state.region);
          if (state.countries.length)  pp.push(state.countries.join('-'));
          if (state.sectors.length)    pp.push('S' + state.sectors.length);
          downloadXLSXWorkbook(sheets, pp.join('_') + '.xlsx');
          return;
        }
        built = buildFullSeriesRecords();
      } else {
        built = buildRecords();
        if (built && built.blocked) {
          alert('Nothing to download — ' + built.message);
          return;
        }
        // Decorate with the same _ctx as full so buildSheetRows can decide
        // whether to include income/region share columns.
        built._ctx = {
          I: isPicked(state.income)  ? state.income  : null,
          R: isPicked(state.region)  ? state.region  : null,
          C: singleCountry(),
          S: singleSector(),
          P: isPicked(state.product) ? state.product : null
        };
      }
      var sheetName = (built.title || 'Disaggregated').slice(0, 31);
      sheets = [{ name: sheetName || 'Panel', rows: buildSheetRows(built, mode) }];
      var parts = ['tdi', 'disagg', mode];
      if (isPicked(state.income))  parts.push(state.income);
      if (isPicked(state.region))  parts.push(state.region);
      if (state.countries.length)  parts.push(state.countries.join('-'));
      if (singleSector())          parts.push(singleSector().split(' ')[0]);
      else if (state.sectors.length) parts.push('S' + state.sectors.length);
      if (isPicked(state.product)) parts.push(state.product.split(' ')[0]);
      filename = parts.join('_') + '.xlsx';
    }
    // Append the figure note + source (each on its own row) to the downloaded
    // sheet, for the figure types that carry a note.
    var noteEntry = NOTES[state.figType];
    if (noteEntry && sheets && sheets.length) {
      noteRows(noteEntry).forEach(function (r) { sheets[0].rows.push(r); });
    }
    downloadXLSXWorkbook(sheets, filename);
  }

  // Wire the split button
  var dlMain  = document.getElementById('figbar-dl-xlsx');
  var dlCaret = document.getElementById('figbar-dl-caret');
  var dlMenu  = document.getElementById('figbar-dl-menu');
  var dlSplit = dlMain ? dlMain.parentElement : null;

  if (dlMain) {
    // Main button click = "Current view" (same as old single-button behavior)
    dlMain.addEventListener('click', function () { doDownload('current'); });
  }
  if (dlCaret) {
    dlCaret.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dlSplit) dlSplit.classList.toggle('is-open');
    });
  }
  if (dlMenu) {
    dlMenu.querySelectorAll('.dl-menu-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-mode') || 'current';
        if (dlSplit) dlSplit.classList.remove('is-open');
        doDownload(mode);
      });
    });
  }
  document.addEventListener('click', function (e) {
    if (!dlSplit) return;
    if (!dlSplit.contains(e.target)) dlSplit.classList.remove('is-open');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────────
  refreshIncomeDropdown();
  refreshRegionDropdown();
  refreshProductDropdown();
  updateCountryButtonLabel();
  buildCountryGroups();
  refreshSectorPopover();
  figTypeSel.value = state.figType;
  render();
})();
