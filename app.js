/* ── State ───────────────────────────────────────────── */
const state = {
  allRows:      [],
  headers:      [],
  colTypes:     {},
  filtered:     [],
  sortCol:      null,
  sortDir:      'asc',
  page:         0,
  pageSize:     12,
  search:       '',
  chartType:    'bar',
  charts:       {},
  sourceLabel:  '',
  sourceMode:   '',
  activeReport: 'tva',
  ytdMode:      'AY',
  reportMeta:   {},
  sheetsUrl:    '',
  sheetList:    [],
  activeLeader:      null,
  leaderCol:         -1,
  activeMetric:      null,
  currentSheetInfo:  null,
  autoRefresh:       false,
  refreshInterval:   60,
  refreshCountdown:  60,
  refreshTimer:      null,
  refreshTickTimer:  null,
  lastRefreshed:     null,
  customFilters: {
    mode:       'all',      // 'all' | 'top' | 'bottom'
    n:          5,          // how many for top/bottom
    metric:     null,       // metric to rank by
    groupBy:    'category', // 'category' | 'leader' | 'row'
    leaders:    null,       // null = all; Set = specific selections
    categories: null,       // null = all; Set = specific selections
  },
};

/* ── Demo Dataset ─────────────────────────────────────── */
const AUTO_SUMMARY_CONFIG = {
  enabled: true,
  label: 'TVA Summary - Jun',
  period: {
    month: '2026-06',
    year: '2027',
    monthShort: 'Jun',
  },
  summary: {
    url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=0#gid=0',
    gid: '0',
  },
  sources: {
    targets: {
      url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=1195674131#gid=1195674131',
      gid: '1195674131',
    },
    tillMay: {
      url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=1711277874#gid=1711277874',
      gid: '1711277874',
    },
    dod: {
      url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=856976655#gid=856976655',
      gid: '856976655',
    },
    acTarget: {
      url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=1421627384#gid=1421627384',
      gid: '1421627384',
    },
    lastYear: {
      url: 'https://docs.google.com/spreadsheets/d/1EDAwtabNhBzn-zzXaPzFVGXi_nK-TLwSnIbib3YFJeg/edit?gid=1548662455#gid=1548662455',
      gid: '1548662455',
    },
  },
};

const DEMO = (() => {
  const products  = ['ProDash X1','DataSync Pro','CloudKit','AnalyticsHub'];
  const categories= ['Software','Hardware','Services'];
  const regions   = ['North','South','East','West'];
  const reps      = ['Alice','Bob','Carol','David','Eve'];
  const months    = ['2026-01','2026-02','2026-03','2026-04','2026-05'];
  const rows = [];
  let id = 1;
  for (const m of months) {
    for (const p of products) {
      const units   = 10 + Math.floor(Math.random() * 90);
      const price   = [299, 149, 499, 199][products.indexOf(p)];
      const revenue = units * price;
      const cost    = Math.round(revenue * (0.35 + Math.random() * 0.2));
      rows.push([
        `${m}-${String(5 + Math.floor(Math.random() * 20)).padStart(2,'0')}`,
        p,
        categories[products.indexOf(p) % 3],
        units,
        revenue,
        cost,
        revenue - cost,
        regions[Math.floor(Math.random() * 4)],
        reps[Math.floor(Math.random() * 5)],
      ]);
      id++;
    }
  }
  return {
    headers: ['Date','Product','Category','Units','Revenue ($)','Cost ($)','Profit ($)','Region','Rep'],
    rows,
  };
})();

/* ── CSV Parser ───────────────────────────────────────── */
function parseLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(parseLine);
  return { headers, rows };
}

/* Returns every row as data — no row is pre-consumed as a header */
function parseCSVAllRows(text) {
  const lines = text.trim().split(/\r?\n/);
  return lines.filter(l => l.trim()).map(parseLine);
}

/* ── Smart header-row detector ────────────────────────── */
const ERROR_RE  = /^#[A-Z/0-9]+[!?]?$/;          // #DIV/0! #N/A #VALUE! etc.
const NUM_RE    = /^[$€£¥]?-?[\d,]+(\.\d+)?%?$/;  // 1234  3.14  70.6%  $99

function rowHeaderScore(row) {
  let score = 0;
  for (const cell of row) {
    const v = String(cell ?? '').trim();
    if (!v) continue;
    if (ERROR_RE.test(v))   { score -= 5; continue; }
    if (v.startsWith('='))  { score -= 3; continue; }
    if (NUM_RE.test(v))     { score -= 1; continue; }
    if (/[A-Za-z]/.test(v)) {             // real text �' strong positive
      score += 3;
      if (v.length <= 40) score += 1;
      if (v.length <= 20) score += 1;
    }
  }
  return score;
}

function detectHeaderRow(rows) {
  let best = 0, bestScore = -Infinity;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const score = rowHeaderScore(rows[r]) + (r === 0 ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/* ── Multi-level (merged-cell) header detection ─────────── */
/*
 * Detects sheets that have a sparse "group" row above the real header row.
 * e.g. row 0: "Collections","","","Orders","","AOV",...
 *      row 1: "Leader","Bizfin AOP","Achieved MTD","Bizfin AOP - Orders","Achieved Orders","Bizfin AOP - AOV",...
 * Returns { headerIdx, groupIdx } where groupIdx=-1 means no group row found.
 */
function detectMultiHeader(allRows) {
  if (allRows.length < 2) return { headerIdx: 0, groupIdx: -1 };

  // Find the best single header row first
  const hIdx = detectHeaderRow(allRows);

  // Check if the row immediately before the best header is a sparse group/merge row
  if (hIdx > 0) {
    const prev       = allRows[hIdx - 1];
    const total      = Math.max(prev.length, 1);
    const emptyCount = prev.filter(c => !String(c ?? '').trim()).length;
    const sparseness = emptyCount / total;

    // Sparse group row: >35% empty AND the main header scores higher
    if (sparseness > 0.35 && rowHeaderScore(allRows[hIdx]) > rowHeaderScore(prev)) {
      return { headerIdx: hIdx, groupIdx: hIdx - 1 };
    }
  }

  return { headerIdx: hIdx, groupIdx: -1 };
}

/*
 * Builds final column names, combining group + sub-header for duplicates.
 * Forward-fills merged group cells and adds "#N" suffix for repeated group names
 * so that identical sub-headers across different groups become unique:
 *   "Orders - Achieved Orders"  vs  "Orders #2 - Achieved Orders"
 */
function buildCombinedHeaders(allRows, headerIdx, groupIdx) {
  const mainHdrs = (allRows[headerIdx] || []).map(v => String(v ?? '').trim());
  if (groupIdx < 0) return mainHdrs;

  const groupRow = allRows[groupIdx] || [];

  // Forward-fill group names; disambiguate repeated group names with #N suffix
  const seenGroups = {};
  const filledGroup = [];
  for (let i = 0; i < Math.max(mainHdrs.length, groupRow.length); i++) {
    const raw = String(groupRow[i] ?? '').trim();
    if (raw) {
      seenGroups[raw] = (seenGroups[raw] || 0) + 1;
      filledGroup.push(seenGroups[raw] === 1 ? raw : `${raw} #${seenGroups[raw]}`);
    } else {
      filledGroup.push(filledGroup[i - 1] || '');
    }
  }

  // Count how many times each sub-header name appears
  const subCount = {};
  mainHdrs.forEach(h => { if (h) subCount[h] = (subCount[h] || 0) + 1; });

  return mainHdrs.map((h, i) => {
    if (!h) return '';
    // Only add the group prefix when the sub-header is a duplicate
    if (subCount[h] > 1 && filledGroup[i]) {
      return `${filledGroup[i]} - ${h}`.slice(0, 80);
    }
    return h;
  });
}

/* Returns true if >40% of non-empty cells in `row` exactly match `refRow` */
function looksLikeHeaderRepeat(row, refRow) {
  let matches = 0, checked = 0;
  const len = Math.min(row.length, refRow.length);
  for (let i = 0; i < len; i++) {
    const ref = String(refRow[i] ?? '').trim();
    if (!ref) continue;
    checked++;
    if (String(row[i] ?? '').trim() === ref) matches++;
  }
  return checked > 3 && matches / checked > 0.4;
}

/* ── Smart CSV loader (for Google Sheets, gviz raw rows) ─ */
function smartParseCsv(text) {
  const allRows = parseCSVAllRows(text);
  if (!allRows.length) throw new Error('Sheet appears to be empty');

  const { headerIdx, groupIdx } = detectMultiHeader(allRows);
  const headers = buildCombinedHeaders(allRows, headerIdx, groupIdx);

  // Skip all leading header rows
  const skipTo      = Math.max(headerIdx, groupIdx === -1 ? -1 : groupIdx) + 1;
  const subHdrRow   = allRows[headerIdx];
  const groupHdrRow = groupIdx >= 0 ? allRows[groupIdx] : null;

  // Also strip any mid-data header repeats (Google Sheets exports frozen rows between groups)
  const dataRows = allRows.slice(skipTo).filter(row => {
    if (looksLikeHeaderRepeat(row, subHdrRow)) return false;
    if (groupHdrRow && looksLikeHeaderRepeat(row, groupHdrRow)) return false;
    return true;
  });

  return cleanColumns(headers, dataRows);
}

/* ── Column cleaner ───────────────────────────────────── */
function isFormulaHeader(h) {
  if (!h) return false;
  if (h.startsWith('=')) return true;           // raw formula syntax
  if (ERROR_RE.test(h)) return true;            // formula error values
  if (NUM_RE.test(h)) return true;              // pure numeric / percent / currency
  if (!/[A-Za-z]/.test(h)) return true;        // no letters at all �' not a text title
  return false;
}

function cleanColumns(headers, rows) {
  const validCols = [];

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim();

    // Skip empty headers
    if (!h) continue;

    // Skip headers that look like formula syntax or computed non-text values
    if (isFormulaHeader(h)) continue;

    // Skip columns where every data row is empty
    const hasData = rows.some(row => String(row[i] ?? '').trim() !== '');
    if (!hasData) continue;

    validCols.push(i);
  }

  const cleanHeaders = validCols.map(i => headers[i]);

  // Keep only rows that have at least one non-empty value (removes blank rows)
  const cleanRows = rows
    .map(row => validCols.map(i => row[i] ?? ''))
    .filter(row => row.some(v => String(v).trim() !== ''));

  return { headers: cleanHeaders, rows: cleanRows };
}

function makeUniqueHeaders(headers) {
  const seen = {};
  return headers.map(h => {
    const base = String(h || '').trim() || 'Column';
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base} (${seen[base]})`;
  });
}

function parseFormulaSummaryCsv(text) {
  const allRows = parseCSVAllRows(text);
  const headerIdx = allRows.findIndex(row =>
    row.some(v => /^leader$/i.test(String(v || '').trim())) &&
    row.some(v => /^category$/i.test(String(v || '').trim()))
  );
  if (headerIdx < 0) throw new Error('Summary tab headers not found');

  const headers = makeUniqueHeaders((allRows[headerIdx] || []).map(v => String(v ?? '').trim()));
  const rows = allRows
    .slice(headerIdx + 1)
    .map(row => headers.map((_, i) => row[i] ?? ''))
    .filter(row => {
      const leader = String(row[headers.indexOf('Leader')] || '').trim();
      const category = String(row[headers.indexOf('Category')] || '').trim();
      return leader && category;
    });

  const totalRow = allRows[0] && allRows[0].some(v => String(v ?? '').trim())
    ? headers.map((_, i) => allRows[0][i] ?? '')
    : null;
  const keep = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => {
    if (!/^Column(?:\s*\(?\d+\)?)?$/i.test(h)) return true;
    return rows.some(row => String(row[i] ?? '').trim()) || (totalRow && String(totalRow[i] ?? '').trim());
  }).map(x => x.i);

  return {
    headers: keep.map(i => headers[i]),
    rows: rows.map(row => keep.map(i => row[i] ?? '')),
    totalRow: totalRow ? keep.map(i => totalRow[i] ?? '') : null,
  };
}

/* ── Column-type detection ────────────────────────────── */
function detectTypes(headers, rows) {
  const types = {};
  for (let c = 0; c < headers.length; c++) {
    const vals = rows.map(r => r[c]).filter(v => v !== '' && v != null);
    const clean  = v => String(v).replace(/[$,%]/g, '').replace(/\s*cr\b/gi, '').trim();
    const numOk  = vals.every(v => !isNaN(Number(clean(v))));
    const dateOk = vals.every(v => !isNaN(Date.parse(String(v))));
    if (numOk)  types[headers[c]] = 'number';
    else if (dateOk) types[headers[c]] = 'date';
    else types[headers[c]] = 'string';
  }
  return types;
}

/* ── Format helpers ───────────────────────────────────── */
function fmtNum(n) {
  if (n == null || n === '') return n;
  const num = Number(String(n).replace(/[$,%]/g, ''));
  if (isNaN(num)) return n;
  return num % 1 === 0
    ? num.toLocaleString()
    : num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isNumeric(h) { return state.colTypes[h] === 'number'; }

function toNum(v) {
  return Number(String(v).replace(/[$,%]/g, '').replace(/\s*cr\b/gi, '').replace(/,/g, '').trim());
}

/* ── Load data ────────────────────────────────────────── */
function loadData({ headers, rows, label }) {
  state.headers      = headers;
  state.allRows      = rows;
  state.colTypes     = detectTypes(headers, rows);
  state.filtered     = [...rows];
  state.sortCol      = null;
  state.page         = 0;
  state.search       = '';
  state.sourceLabel  = label;
  state.activeLeader = null;
  state.activeMetric = null;
  // Stop refresh if this is not a sheets source (demo / Metabase)
  if (state.sourceMode !== 'auto-summary' && !state.currentSheetInfo) {
    stopAutoRefresh();
    document.getElementById('refreshCtrl').style.display = 'none';
  }

  document.getElementById('tableSearch').value = '';
  document.getElementById('heroSection').style.display = 'none';
  document.getElementById('dashboard').style.display   = 'block';

  const badge = document.getElementById('dataSourceBadge');
  if (badge) badge.style.display = 'flex';
  const sourceLabelEl = document.getElementById('sourceLabel');
  if (sourceLabelEl) sourceLabelEl.textContent = label;
  document.getElementById('dataSourceInfo').textContent = `${rows.length} rows · ${headers.length} columns`;
  document.getElementById('btnCustomize').style.display = 'inline-flex';

  // Update dot to show active
  const dot = document.getElementById('sourceDot');
  if (dot) dot.classList.remove('loading');

  initLeaderFilter();
  initFilterPanel();
  updateYtdModeControl();
  renderOracleKPIs();
  renderCharts();
  renderTable();

  // Switch to Overview tab and render TVA
  switchSubtab('overview');

  // Update sidebar info
  updateSidebarInfo();
}

/* ── Active rows — leader chip + all customFilters ────── */
function getActiveRows() {
  // 1. Leader chip (single leader or all)
  let rows = (state.activeLeader !== null && state.leaderCol >= 0)
    ? state.allRows.filter(r => r[state.leaderCol] === state.activeLeader)
    : state.allRows;

  const cf     = state.customFilters;
  const catIdx = getCategoryColIndex();

  // 2. Filter rows with garbage/invalid leader values (from malformed CSV)
  if (state.leaderCol >= 0) {
    rows = rows.filter(r => isValidLeader(String(r[state.leaderCol] ?? '')));
  }

  // 3. Custom leader multi-select
  if (cf.leaders !== null && state.leaderCol >= 0) {
    rows = rows.filter(r => cf.leaders.has(String(r[state.leaderCol] ?? '')));
  }

  // 3. Custom category multi-select
  if (cf.categories !== null && catIdx >= 0) {
    rows = rows.filter(r => cf.categories.has(String(r[catIdx] ?? '')));
  }

  // 4. Top / Bottom N ranking
  if (cf.mode !== 'all' && cf.metric && cf.n > 0) {
    const mi   = state.headers.indexOf(cf.metric);
    const desc = cf.mode === 'top';

    if (mi >= 0) {
      if (cf.groupBy === 'leader' && state.leaderCol >= 0) {
        const totals = {};
        rows.forEach(r => {
          const k = String(r[state.leaderCol] ?? '');
          const v = toNum(r[mi]);
          totals[k] = (totals[k] || 0) + (isNaN(v) ? 0 : v);
        });
        const keep = new Set(
          Object.entries(totals)
            .sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1])
            .slice(0, cf.n).map(([k]) => k)
        );
        rows = rows.filter(r => keep.has(String(r[state.leaderCol] ?? '')));

      } else if (cf.groupBy === 'category' && catIdx >= 0) {
        const totals = {};
        rows.forEach(r => {
          const k = String(r[catIdx] ?? '');
          const v = toNum(r[mi]);
          totals[k] = (totals[k] || 0) + (isNaN(v) ? 0 : v);
        });
        const keep = new Set(
          Object.entries(totals)
            .sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1])
            .slice(0, cf.n).map(([k]) => k)
        );
        rows = rows.filter(r => keep.has(String(r[catIdx] ?? '')));

      } else {
        // Individual rows
        rows = rows
          .map(r => ({ r, v: toNum(r[mi]) }))
          .filter(x => !isNaN(x.v))
          .sort((a, b) => desc ? b.v - a.v : a.v - b.v)
          .slice(0, cf.n)
          .map(x => x.r);
      }
    }
  }

  return rows;
}

function getCategoryColIndex() {
  const col = getCategoryCol();
  return col ? state.headers.indexOf(col) : -1;
}

/* ── Validate leader name (filter out batch names, CSV junk, flags) ── */
function isValidLeader(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 35) return false;
  if (/^[\d,.\s]+$/.test(n)) return false;      // pure numbers/commas/dots
  if (n.includes(',') || n.includes(';')) return false; // CSV separators �' row-parse artifact
  if (/^\d/.test(n)) return false;               // starts with digit
  if (n.split(/\s+/).length > 4) return false;   // 5+ words �' probably a batch/course name
  if (/\|/.test(n)) return false;               // pipe character �' course name
  return /[a-zA-Z]/.test(n);                    // must have at least one letter
}

function isUsefulFilterValue(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (/^(0|0\.0|0\.00|-|--|—|null|undefined|nan|#n\/a|#value!?|\(blank\))$/i.test(v)) return false;
  if (v.length > 80) return false;
  return /[A-Za-z0-9]/.test(v);
}

/* ── Leader filter UI ─────────────────────────────────── */
function initLeaderFilter() {
  const li = state.headers.findIndex(h => /^leader$/i.test(String(h).trim()));
  state.leaderCol    = li;
  state.activeLeader = null;

  const section = document.getElementById('leaderSection');
  if (li < 0) { section.style.display = 'none'; return; }

  // Only show values that look like real leader names
  const allVals  = [...new Set(state.allRows.map(r => String(r[li] ?? '').trim()).filter(Boolean))];
  const leaders  = allVals.filter(isValidLeader);
  if (leaders.length < 2) { section.style.display = 'none'; return; }

  section.style.display = 'block';

  const chips = document.getElementById('leaderChips');
  chips.innerHTML = [
    `<span class="leader-label">Filter by Leader</span>`,
    `<button class="leader-chip leader-chip-all active" data-leader="">All</button>`,
    ...leaders.map((l, i) => {
      const color    = PALETTE[i % PALETTE.length];
      const initials = l.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
      return `<button class="leader-chip" data-leader="${esc(l)}" data-color="${color}">
        <span class="leader-avatar" style="background:${color}">${initials}</span>${esc(l)}
      </button>`;
    }),
  ].join('');

  chips.querySelectorAll('.leader-chip').forEach(chip => {
    chip.addEventListener('click', () => applyLeaderFilter(chip.dataset.leader || null));
  });

  initMetricSelector();
  updateSidebarInfo();
}

/* ── Customize / Filter Panel ─────────────────────────── */
function initFilterPanel() {
  if (!state.headers.length) return;
  // Just populate the panel content; visibility is controlled by the toggle button

  const cf      = state.customFilters;
  const numCols = getImportantMetrics(5);

  // ── Metric dropdown ───
  const metSel = document.getElementById('fpMetric');
  metSel.innerHTML = numCols.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (!cf.metric || !numCols.includes(cf.metric)) cf.metric = getActiveMetric();
  metSel.value = cf.metric;
  metSel.addEventListener('change', () => { cf.metric = metSel.value; triggerFilterUpdate(); });

  // ── GroupBy ───
  const grpSel = document.getElementById('fpGroupBy');
  grpSel.value = cf.groupBy;
  grpSel.addEventListener('change', () => { cf.groupBy = grpSel.value; triggerFilterUpdate(); });

  // ── N input ───
  const nInp = document.getElementById('fpN');
  nInp.value = cf.n;
  nInp.addEventListener('input', () => {
    cf.n = Math.max(1, parseInt(nInp.value, 10) || 5);
    triggerFilterUpdate();
  });

  // ── Mode pills ───
  document.querySelectorAll('.fp-pill[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === cf.mode);
    btn.addEventListener('click', () => {
      cf.mode = btn.dataset.mode;
      document.querySelectorAll('.fp-pill[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === cf.mode));
      document.getElementById('fpRankDetail').style.display = cf.mode === 'all' ? 'none' : 'block';
      triggerFilterUpdate();
    });
  });
  document.getElementById('fpRankDetail').style.display = cf.mode === 'all' ? 'none' : 'block';

  // ── Leader checkboxes ───
  buildCheckboxes('fpLeaderChecks', 'leader',
    state.leaderCol >= 0
      ? [...new Set(state.allRows.map(r => String(r[state.leaderCol] ?? '')).filter(isValidLeader))]
      : [],
    cf.leaders
  );
  document.getElementById('fpLeadersAll').onclick  = () => { cf.leaders = null;  rebuildLeaderChecks(); triggerFilterUpdate(); };
  document.getElementById('fpLeadersNone').onclick = () => {
    cf.leaders = new Set();
    rebuildLeaderChecks(); triggerFilterUpdate();
  };

  // ── Category checkboxes ───
  const catIdx = getCategoryColIndex();
  buildCheckboxes('fpCatChecks', 'category',
    catIdx >= 0 ? [...new Set(state.allRows.map(r => String(r[catIdx] ?? '')).filter(isUsefulFilterValue))] : [],
    cf.categories
  );
  document.getElementById('fpCatAll').onclick  = () => { cf.categories = null;  rebuildCatChecks(); triggerFilterUpdate(); };
  document.getElementById('fpCatNone').onclick = () => { cf.categories = new Set(); rebuildCatChecks(); triggerFilterUpdate(); };

  // ── Reset ───
  document.getElementById('fpResetAll').onclick = () => {
    Object.assign(state.customFilters, { mode:'all', n:5, metric:getActiveMetric(), groupBy:'category', leaders:null, categories:null });
    initFilterPanel();
    triggerFilterUpdate();
  };

  triggerFilterUpdate();
}

function buildCheckboxes(containerId, type, items, currentSet) {
  const container = document.getElementById(containerId);
  items = items.filter(isUsefulFilterValue).sort((a, b) => String(a).localeCompare(String(b)));
  if (!items.length) { container.innerHTML = '<span style="color:var(--text-3);font-size:12px">No data</span>'; return; }

  container.innerHTML = items.map(item => {
    const checked = currentSet === null || currentSet.has(item);
    return `<label class="fp-check-label">
      <input type="checkbox" class="fp-check" data-type="${type}" value="${esc(item)}" ${checked ? 'checked' : ''}>
      <span>${esc(item)}</span>
    </label>`;
  }).join('');

  container.querySelectorAll('.fp-check').forEach(cb => {
    cb.addEventListener('change', () => handleCheckboxChange(type));
  });
}

function handleCheckboxChange(type) {
  const cf    = state.customFilters;
  const isLeader = type === 'leader';
  const boxes = document.querySelectorAll(`.fp-check[data-type="${type}"]`);
  const checked = [...boxes].filter(b => b.checked).map(b => b.value);
  const total   = boxes.length;

  if (checked.length === total) {
    if (isLeader) cf.leaders = null; else cf.categories = null;
  } else {
    if (isLeader) cf.leaders = new Set(checked); else cf.categories = new Set(checked);
  }
  triggerFilterUpdate();
}

function rebuildLeaderChecks() {
  const cf = state.customFilters;
  document.querySelectorAll('.fp-check[data-type="leader"]').forEach(cb => {
    cb.checked = cf.leaders === null || cf.leaders.has(cb.value);
  });
}
function rebuildCatChecks() {
  const cf = state.customFilters;
  document.querySelectorAll('.fp-check[data-type="category"]').forEach(cb => {
    cb.checked = cf.categories === null || cf.categories.has(cb.value);
  });
}

function triggerFilterUpdate() {
  const rows  = getActiveRows();
  const count = rows.length;

  // Row count badge on panel
  const countEl = document.getElementById('fpResultCount');
  if (countEl) countEl.textContent = `${count.toLocaleString()} rows match`;

  // Active filter indicator on button
  const cf     = state.customFilters;
  let activeCount = 0;
  if (cf.mode !== 'all') activeCount++;
  if (cf.leaders !== null) activeCount++;
  if (cf.categories !== null) activeCount++;
  const badge = document.getElementById('fpActiveBadge');
  if (badge) {
    badge.style.display = activeCount > 0 ? 'inline' : 'none';
    badge.textContent   = `${activeCount} active`;
  }

  // Re-render everything
  renderOracleKPIs();
  renderCharts();
  applyFilter();
  // If on overview tab, re-render active report
  const activeTab = document.querySelector('.dp-subtab.active');
  if (activeTab && activeTab.dataset.subtab === 'overview') {
    renderActiveReport();
  }
}

function initMetricSelector() {
  const wrap   = document.getElementById('metricSelectorWrap');
  const select = document.getElementById('metricSelect');
  if (state.leaderCol < 0) { wrap.style.display = 'none'; return; }

  const numCols = getImportantMetrics(5);
  if (!numCols.length) { wrap.style.display = 'none'; return; }

  wrap.style.display = 'flex';
  select.innerHTML   = numCols.map(col =>
    `<option value="${esc(col)}">${esc(col)}</option>`
  ).join('');

  // Pre-select the auto-detected best metric
  state.activeMetric = getActiveMetric();
  select.value = state.activeMetric;

  select.addEventListener('change', () => {
    state.activeMetric = select.value;
    renderCharts();
  });
}

function applyLeaderFilter(leader) {
  state.activeLeader = leader || null;
  state.page         = 0;
  state.search       = '';
  document.getElementById('tableSearch').value = '';

  document.querySelectorAll('.leader-chip').forEach(c => {
    const isActive = (c.dataset.leader || null) === state.activeLeader;
    c.classList.toggle('active', isActive);
    const color = c.dataset.color;
    c.style.background  = isActive ? (color || 'var(--violet)') : '';
    c.style.borderColor = isActive ? (color || 'var(--violet)') : '';
    c.style.color       = isActive ? '#fff' : '';
  });

  const rows = getActiveRows();
  document.getElementById('dataSourceInfo').textContent =
    state.activeLeader
      ? `${rows.length} rows · ${state.activeLeader}`
      : `${state.allRows.length} rows · ${state.headers.length} columns`;

  renderOracleKPIs();
  renderCharts();
  applyFilter();
  // If on overview tab, re-render active report
  const activeTabEl = document.querySelector('.dp-subtab.active');
  if (activeTabEl && activeTabEl.dataset.subtab === 'overview') {
    renderActiveReport();
  }
}

/* ── KPI Cards ────────────────────────────────────────── */
function renderKPIs() {
  // Only chartable metrics for KPIs (excludes Check, %, etc.)
  const kpiCols = state.headers.filter(isChartableMetric);
  const colors  = ['violet','cyan','emerald','amber'];
  const icons   = ['S', '?', '?', '#'];
  const fmtKpi  = n => {
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`;
    if (n >= 100_000)    return `${(n / 100_000).toFixed(2)} L`;
    if (n >= 1_000)      return `${(n / 1_000).toFixed(1)}K`;
    return fmtNum(n);
  };

  const metrics = [];
  const activeRows = getActiveRows();

  // 1st card: row count
  metrics.push({ label: 'Total Rows', value: activeRows.length.toLocaleString(), sub: 'records in dataset' });

  // Cards 2-4: pick the most meaningful chartable columns
  // Prefer: achieved collection, then AOP, then orders — skip tiny/avg columns
  const preferred = [
    'achieved collection', 'achieved - gross', 'achieved mtd', 'collection_fy27', 'achieved ytd',
    'aop collection', 'bizfin aop', 'achieved gross',
    'achieved orders', 'aop orders', 'bizfin aop - orders',
    'drr', 'projected collection',
  ];

  const picked = new Set();
  for (const p of preferred) {
    if (metrics.length >= 4) break;
    const col = kpiCols.find(h => h.toLowerCase().includes(p) && !picked.has(h));
    if (!col) continue;
    picked.add(col);
    const vals = activeRows.map(r => toNum(r[state.headers.indexOf(col)])).filter(v => !isNaN(v) && v !== 0);
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / vals.length;
    metrics.push({
      label: col.replace(/\(.*\)/,'').trim(),   // strip "(May)" etc. from label
      value: fmtKpi(sum),
      sub: `avg ${fmtKpi(avg)} · ${vals.length} rows`,
    });
  }

  // Fallback: fill with remaining chartable cols
  for (const col of kpiCols) {
    if (metrics.length >= 4) break;
    if (picked.has(col)) continue;
    const vals = activeRows.map(r => toNum(r[state.headers.indexOf(col)])).filter(v => !isNaN(v) && v !== 0);
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / vals.length;
    picked.add(col);
    metrics.push({
      label: col.replace(/\(.*\)/,'').trim(),
      value: fmtKpi(sum),
      sub: `avg ${fmtKpi(avg)} · ${vals.length} rows`,
    });
  }

  // Pad to 4 if still short
  if (metrics.length < 2) {
    const cat = state.headers.find(h => state.colTypes[h] === 'string');
    if (cat) {
      const unique = new Set(activeRows.map(r => r[state.headers.indexOf(cat)])).size;
      metrics.push({ label: `Unique ${cat}`, value: unique.toLocaleString(), sub: 'distinct values' });
    }
  }

  const grid = document.getElementById('kpiGrid');
  grid.className = 'kpi-grid';
  grid.innerHTML = '';
  metrics.slice(0, 4).forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'kpi-card';
    div.dataset.color = colors[i];
    div.innerHTML = `
      <div class="kpi-icon ${colors[i]}">${icons[i]}</div>
      <div class="kpi-label">${esc(m.label)}</div>
      <div class="kpi-value">${esc(m.value)}</div>
      <div class="kpi-sub">${esc(m.sub)}</div>`;
    grid.appendChild(div);
  });
}

/* ── Chart helpers ────────────────────────────────────── */
const PALETTE = [
  '#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#f43f5e','#3b82f6','#a78bfa','#34d399',
  '#fbbf24','#f97316','#e879f9','#67e8f9',
  '#6ee7b7','#fcd34d','#fb7185','#c084fc',
];

const CHART_DEFAULTS = {
  color: '#475569',
  plugins: {
    legend: { labels: { color: '#334155', font: { family: 'Inter', size: 12, weight: '700' }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: '#ffffff',
      borderColor: '#cbd5e1',
      borderWidth: 1,
      titleColor: '#111827',
      bodyColor: '#334155',
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', font: { family: 'Inter', size: 11, weight: '700' }, maxRotation: 35 },
      grid:  { color: '#e5e7eb' },
      border:{ color: '#cbd5e1' },
    },
    y: {
      ticks: { color: '#64748b', font: { family: 'Inter', size: 11, weight: '700' } },
      grid:  { color: '#e5e7eb' },
      border:{ color: '#cbd5e1' },
    },
  },
};

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

/* ── Chart config helper ──────────────────────────────── */
function getChartConfig() {
  const { headers, colTypes } = state;
  // Only include chartable metrics (exclude %, ID, row-number columns)
  const numCols  = headers.filter(h => isChartableMetric(h));
  const dateCols = headers.filter(h => colTypes[h] === 'date');
  const strCols  = headers.filter(h => colTypes[h] === 'string');
  const labelCol = dateCols[0] || strCols[0] || null;
  return { numCols, dateCols, strCols, labelCol, isMultiMetric: numCols.length >= 2 };
}

/* Shared Chart.js options for a multi-series chart */
function multiOptions(showLegend = true) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    ...CHART_DEFAULTS,
    plugins: {
      ...CHART_DEFAULTS.plugins,
      legend: {
        ...CHART_DEFAULTS.plugins.legend,
        display: showLegend,
        position: 'top',
        labels: {
          ...CHART_DEFAULTS.plugins.legend.labels,
          boxWidth: 10,
          padding: 14,
        },
      },
    },
    scales: {
      ...CHART_DEFAULTS.scales,
      x: {
        ...CHART_DEFAULTS.scales.x,
        ticks: {
          ...CHART_DEFAULTS.scales.x.ticks,
          maxTicksLimit: 16,
          maxRotation: 40,
        },
      },
    },
  };
}

function makeDataset(col, i, type) {
  const ci    = state.headers.indexOf(col);
  const color = PALETTE[i % PALETTE.length];
  const data  = getActiveRows().map(r => { const n = toNum(r[ci]); return isNaN(n) ? 0 : n; });
  return {
    label: col,
    data,
    backgroundColor: type === 'line' ? color + '22' : color,
    borderColor: color,
    borderWidth: type === 'line' ? 2 : 0,
    borderRadius: type === 'bar' ? 5 : 0,
    fill: false,
    tension: 0.4,
    pointRadius: 3,
    pointHoverRadius: 5,
  };
}

/* ── Active metric helper ─────────────────────────────── */
// Returns true for columns that are meaningful absolute metrics (not % ratios or ID columns)
function isChartableMetric(h) {
  if (!isNumeric(h)) return false;
  const low = h.toLowerCase().trim();
  // Exclude: percentage columns, check/ID columns, row numbers
  if (low.endsWith('%') || low.includes('achv%') || low.includes('achievement%') ||
      low.includes('% ') || low.includes('growth%') || low.startsWith('%')) return false;
  if (/^(check|id|sr|no\.|#|row)$/i.test(low)) return false;
  return true;
}

function getImportantMetrics(limit = 5) {
  const preferred = [
    'AOP - Gross',
    'Achieved - Gross',
    'AOP - Orders',
    'Achieved Orders',
    'Achieved AOV',
    'Projected - Jun',
    'Achieved YTD Gross',
  ];
  const picked = [];
  for (const label of preferred) {
    const found = state.headers.find(h =>
      h.toLowerCase() === label.toLowerCase() ||
      h.toLowerCase().includes(label.toLowerCase())
    );
    if (found && isNumeric(found) && !picked.includes(found)) picked.push(found);
    if (picked.length >= limit) break;
  }
  for (const h of state.headers) {
    if (picked.length >= limit) break;
    if (isChartableMetric(h) && !picked.includes(h)) picked.push(h);
  }
  return picked;
}

function getActiveMetric() {
  if (state.activeMetric && state.headers.includes(state.activeMetric) && isChartableMetric(state.activeMetric)) {
    return state.activeMetric;
  }
  // Prefer achieved collection/MTD first, then AOP, then orders, then any chartable
  const preferred = [
    'achieved collection', 'achieved - gross', 'collection_fy27', 'achieved mtd',
    'achieved ytd', 'achieved gross', 'aop collection', 'bizfin aop',
    'collection', 'revenue', 'sales', 'orders'
  ];
  for (const p of preferred) {
    const found = state.headers.find(h => h.toLowerCase().includes(p) && isChartableMetric(h));
    if (found) return found;
  }
  return state.headers.find(isChartableMetric) || state.headers.find(isNumeric) || '';
}

/* Find the primary category column (first non-leader, non-check string col) */
function getCategoryCol() {
  return state.headers.find((h, i) =>
    state.colTypes[h] === 'string' && i !== state.leaderCol && !/^check$/i.test(h)
  ) || null;
}

/* ── Leader-bifurcated chart rendering ───────────────── */
function renderMainChartByLeader(metric) {
  destroyChart('main');
  if (!metric) return;

  const catCol = getCategoryCol();
  if (!catCol) return;

  const ctx  = document.getElementById('mainChart').getContext('2d');
  const type = state.chartType;
  const rows = getActiveRows();
  const li   = state.leaderCol;
  const ci   = state.headers.indexOf(catCol);
  const mi   = state.headers.indexOf(metric);

  // Detect if there is a corresponding AOP/Target column to pair with this metric
  // e.g. "Achieved Collection (May)" �' look for "AOP Collection (May)"
  const aopPair = (() => {
    const low = metric.toLowerCase();
    if (low.startsWith('achieved')) {
      const suffix = metric.slice('Achieved'.length);
      return state.headers.find(h =>
        (h.toLowerCase().startsWith('aop') || h.toLowerCase().startsWith('bizfin aop') ||
         h.toLowerCase().startsWith('target')) && h.includes(suffix) && isChartableMetric(h)
      ) || null;
    }
    return null;
  })();

  // Sort categories by total metric value (descending) for better readability
  const categories = [...new Set(rows.map(r => String(r[ci] ?? '')).filter(Boolean))];
  const catTotals  = {};
  rows.forEach(r => {
    const cat = String(r[ci] ?? '');
    const val = toNum(r[mi]);
    catTotals[cat] = (catTotals[cat] || 0) + (isNaN(val) ? 0 : val);
  });
  categories.sort((a, b) => (catTotals[b] || 0) - (catTotals[a] || 0));
  const topCats = categories.slice(0, 15); // cap at 15 for readability

  const leaders = state.activeLeader
    ? [state.activeLeader]
    : [...new Set(rows.map(r => String(r[li] ?? '')).filter(isValidLeader))];

  const datasets = [];

  if (aopPair && state.activeLeader) {
    // TVA mode (single leader selected): show AOP vs Achieved as paired bars
    const aopIdx = state.headers.indexOf(aopPair);
    datasets.push({
      label: 'AOP / Target', data: topCats.map(cat => {
        const sub = rows.filter(r => String(r[li]) === state.activeLeader && String(r[ci]) === cat);
        return sub.reduce((s, r) => { const n = toNum(r[aopIdx]); return s + (isNaN(n) ? 0 : n); }, 0);
      }),
      backgroundColor: 'rgba(139,92,246,0.4)', borderColor: '#8b5cf6',
      borderWidth: 2, borderRadius: 4,
    });
    datasets.push({
      label: `Achieved (${state.activeLeader})`, data: topCats.map(cat => {
        const sub = rows.filter(r => String(r[li]) === state.activeLeader && String(r[ci]) === cat);
        return sub.reduce((s, r) => { const n = toNum(r[mi]); return s + (isNaN(n) ? 0 : n); }, 0);
      }),
      backgroundColor: 'rgba(6,182,212,0.7)', borderColor: '#06b6d4',
      borderWidth: 0, borderRadius: 4,
    });
    document.getElementById('mainChartTitle').textContent = `AOP vs Achieved — ${metric.replace(/\(.*\)/,'').trim()} by ${catCol}`;
  } else {
    // Multi-leader mode: one series per leader
    leaders.forEach((leader, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      datasets.push({
        label: leader,
        data: topCats.map(cat => {
          const sub = rows.filter(r => String(r[li]) === leader && String(r[ci]) === cat);
          return sub.reduce((s, r) => { const n = toNum(r[mi]); return s + (isNaN(n) ? 0 : n); }, 0);
        }),
        backgroundColor: type === 'line' ? color + '22' : color,
        borderColor: color,
        borderWidth: type === 'line' ? 2.5 : 0,
        borderRadius: type === 'bar' ? 5 : 0,
        fill: false, tension: 0.4, pointRadius: 4, pointHoverRadius: 6,
      });
    });
    document.getElementById('mainChartTitle').textContent = `${metric.replace(/\(.*\)/,'').trim()}  by ${catCol}  per Leader`;
  }

  state.charts.main = new Chart(ctx, {
    type: type === 'line' ? 'line' : 'bar',
    data: { labels: topCats, datasets },
    options: multiOptions(datasets.length > 1),
  });
}

function renderDistChartByLeader(metric) {
  destroyChart('dist');
  if (!metric) return;

  const rows    = getActiveRows();
  const li      = state.leaderCol;
  const mi      = state.headers.indexOf(metric);
  const leaders = [...new Set(rows.map(r => String(r[li] ?? '')).filter(isValidLeader))];
  const values  = leaders.map(leader => {
    const sub = rows.filter(r => String(r[li]) === leader);
    return sub.reduce((s, r) => { const n = toNum(r[mi]); return s + (isNaN(n) ? 0 : n); }, 0);
  });

  document.getElementById('distChartTitle').textContent = `${metric} — leader share`;

  const ctx = document.getElementById('distChart').getContext('2d');
  state.charts.dist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: leaders,
      datasets: [{
        data: values,
        backgroundColor: leaders.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: 'transparent', hoverOffset: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' } },
    },
  });
}

function renderTrendChartByLeader(metric) {
  destroyChart('trend');
  const fullCard = document.querySelector('.chart-card-full');
  if (!metric) { fullCard.style.display = 'none'; return; }

  const catCol = getCategoryCol();
  if (!catCol) { fullCard.style.display = 'none'; return; }
  fullCard.style.display = '';

  const rows    = getActiveRows();
  const li      = state.leaderCol;
  const ci      = state.headers.indexOf(catCol);
  const mi      = state.headers.indexOf(metric);
  const leaders = state.activeLeader
    ? [state.activeLeader]
    : [...new Set(rows.map(r => String(r[li] ?? '')).filter(isValidLeader))];
  const labels  = [...new Set(rows.map(r => String(r[ci] ?? '')).filter(Boolean))];

  document.getElementById('trendChartTitle').textContent = `${metric} — leaders compared`;

  const datasets = leaders.map((leader, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    return {
      label: leader,
      data: labels.map(cat => {
        const sub = rows.filter(r => String(r[li]) === leader && String(r[ci]) === cat);
        return sub.reduce((s, r) => { const n = toNum(r[mi]); return s + (isNaN(n) ? 0 : n); }, 0);
      }),
      borderColor: color, backgroundColor: color + '18',
      borderWidth: 2.5, fill: false, tension: 0.4, pointRadius: 4, pointHoverRadius: 6,
    };
  });

  const ctx = document.getElementById('trendChart').getContext('2d');
  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: multiOptions(leaders.length > 1),
  });
}

/* ── Render Charts ────────────────────────────────────── */
function renderCharts() {
  if (state.leaderCol >= 0) {
    const m = getActiveMetric();
    renderMainChartByLeader(m);
    renderDistChartByLeader(m);
    renderTrendChartByLeader(m);
  } else {
    renderMainChart();
    renderDistChart();
    renderTrendChart();
  }
}

/* Main chart — wide card */
function renderMainChart() {
  destroyChart('main');
  const { numCols, labelCol, isMultiMetric } = getChartConfig();
  if (!numCols.length) return;

  const ctx  = document.getElementById('mainChart').getContext('2d');
  const type = state.chartType;

  if (isMultiMetric && labelCol) {
    // ── Multi-metric: every numeric column is its own series ──
    const li      = state.headers.indexOf(labelCol);
    const metrics = numCols;
    const labels  = getActiveRows().map(r => String(r[li] ?? '').slice(0, 28));

    document.getElementById('mainChartTitle').textContent =
      metrics.length <= 4 ? metrics.join('  ·  ') : `${metrics.length} metrics by ${labelCol}`;

    state.charts.main = new Chart(ctx, {
      type,
      data: { labels, datasets: metrics.map((col, i) => makeDataset(col, i, type)) },
      options: multiOptions(true),
    });

  } else {
    // ── Single metric: group rows by the label column ──
    const catCol = state.headers.find(h => state.colTypes[h] === 'string');
    if (!catCol || !numCols.length) return;

    const valCol = numCols[0];
    const ci = state.headers.indexOf(catCol);
    const vi = state.headers.indexOf(valCol);
    const grouped = {};
    for (const row of getActiveRows()) {
      const k = String(row[ci] ?? '').slice(0, 25);
      grouped[k] = (grouped[k] || 0) + toNum(row[vi]);
    }
    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 12);
    document.getElementById('mainChartTitle').textContent = `${valCol} by ${catCol}`;

    state.charts.main = new Chart(ctx, {
      type,
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{
          label: valCol,
          data:  sorted.map(([, v]) => v),
          backgroundColor: type === 'line' ? 'rgba(139,92,246,0.15)' : sorted.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor:     type === 'line' ? '#8b5cf6'               : sorted.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: type === 'line' ? 2 : 0,
          borderRadius: type === 'bar' ? 6 : 0,
          fill: type === 'line', tension: 0.4,
          pointBackgroundColor: '#8b5cf6', pointRadius: 4,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend, display: false } } },
    });
  }
}

/* Distribution donut */
function renderDistChart() {
  destroyChart('dist');
  const { numCols, labelCol, isMultiMetric } = getChartConfig();

  let labels, values;

  if (isMultiMetric) {
    // Show the total of every numeric column as slices
    const metrics = numCols;
    labels = metrics;
    values = metrics.map(col => {
      const ci = state.headers.indexOf(col);
      return getActiveRows().reduce((s, r) => { const n = toNum(r[ci]); return s + (isNaN(n) ? 0 : n); }, 0);
    });
    document.getElementById('distChartTitle').textContent = 'Metrics breakdown';
  } else {
    const catCol = state.headers.find(h => state.colTypes[h] === 'string');
    const numCol = numCols[0];
    if (!catCol) return;
    const ci = state.headers.indexOf(catCol);
    const ni = numCol ? state.headers.indexOf(numCol) : -1;
    const grouped = {};
    for (const row of getActiveRows()) {
      const k = String(row[ci] ?? '').slice(0, 20);
      grouped[k] = (grouped[k] || 0) + (ni >= 0 ? toNum(row[ni]) : 1);
    }
    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 8);
    labels = sorted.map(([k]) => k);
    values = sorted.map(([, v]) => v);
    document.getElementById('distChartTitle').textContent = numCol ? `${numCol} share` : `${catCol} count`;
  }

  const ctx = document.getElementById('distChart').getContext('2d');
  state.charts.dist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: 'transparent', hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' } },
    },
  });
}

/* Full-width trend / all-metrics chart */
function renderTrendChart() {
  destroyChart('trend');
  const { numCols, dateCols, labelCol, isMultiMetric } = getChartConfig();
  const fullCard = document.querySelector('.chart-card-full');

  if (!labelCol || !numCols.length) { fullCard.style.display = 'none'; return; }
  fullCard.style.display = '';

  const li      = state.headers.indexOf(labelCol);
  const isDate  = dateCols.includes(labelCol);
  const metrics = numCols;
  const ctx     = document.getElementById('trendChart').getContext('2d');
  // Use raw row labels — no aggregation, every row is one data point
  const activeR   = getActiveRows();
  const rowLabels = activeR.map(r => String(r[li] ?? '').slice(0, 28));
  const pointR    = activeR.length > 60 ? 0 : 3;

  if (isDate) {
    document.getElementById('trendChartTitle').textContent = 'All metrics over time';

    const datasets = metrics.map((col, i) => {
      const color = PALETTE[i % PALETTE.length];
      const ci    = state.headers.indexOf(col);
      return {
        label: col,
        data: activeR.map(r => { const n = toNum(r[ci]); return isNaN(n) ? 0 : n; }),
        borderColor: color, backgroundColor: color + '18',
        borderWidth: 2, fill: i === 0, tension: 0.4,
        pointRadius: pointR, pointHoverRadius: 5,
      };
    });

    state.charts.trend = new Chart(ctx, {
      type: 'line',
      data: { labels: rowLabels, datasets },
      options: multiOptions(metrics.length > 1),
    });

  } else {
    // ── String / category axis: show all metrics per label row ──
    const labels = getActiveRows().map(r => String(r[li] ?? '').slice(0, 25));
    document.getElementById('trendChartTitle').textContent =
      isMultiMetric ? `All metrics by ${labelCol}` : `${metrics[0]} by ${labelCol}`;

    const datasets = metrics.map((col, i) => {
      const color = PALETTE[i % PALETTE.length];
      const ci    = state.headers.indexOf(col);
      return {
        label: col,
        data: getActiveRows().map(r => { const n = toNum(r[ci]); return isNaN(n) ? 0 : n; }),
        borderColor: color, backgroundColor: color + '18',
        borderWidth: 2, fill: false, tension: 0.4,
        pointRadius: 3, pointHoverRadius: 5,
      };
    });

    state.charts.trend = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: multiOptions(metrics.length > 1),
    });
  }
}

/* ── Table ────────────────────────────────────────────── */
function applyFilter() {
  const q = state.search.toLowerCase();
  const base = getActiveRows();
  state.filtered = q
    ? base.filter(r => r.some(v => String(v).toLowerCase().includes(q)))
    : [...base];

  if (state.sortCol !== null) {
    const ci   = state.sortCol;
    const isN  = state.colTypes[state.headers[ci]] === 'number';
    const dir  = state.sortDir === 'asc' ? 1 : -1;
    state.filtered.sort((a, b) => {
      const av = isN ? toNum(a[ci]) : String(a[ci]).toLowerCase();
      const bv = isN ? toNum(b[ci]) : String(b[ci]).toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  state.page = 0;
  renderTable();
}

function renderTable() {
  const { headers, filtered, page, pageSize } = state;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = page * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const catIdx = getCategoryColIndex();
  const tableCellClass = i => {
    const classes = [];
    if (i === state.leaderCol) classes.push('sticky-col');
    if (i === catIdx) classes.push('sticky-col-2');
    const sectionClass = tableSectionClass(headers, i);
    if (sectionClass) classes.push(sectionClass);
    if (isNumeric(headers[i])) classes.push('numeric');
    return classes.join(' ');
  };

  // Head
  const thead = document.getElementById('tableHead');
  thead.innerHTML = buildGroupedThead(headers, (h, i) => {
    const cls = state.sortCol === i ? ` class="sort-${state.sortDir}"` : '';
    const allClasses = [state.sortCol === i ? `sort-${state.sortDir}` : '', tableCellClass(i)].filter(Boolean).join(' ');
    return `<th class="${allClasses}" data-col="${i}">${esc(h)}</th>`;
  });

  // Body
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = slice.map(row =>
    '<tr>' + row.map((v, i) => {
      const num = isNumeric(headers[i]);
      return `<td class="${tableCellClass(i)}">${esc(num ? fmtNum(v) : String(v))}</td>`;
    }).join('') + '</tr>'
  ).join('');

  // Pagination
  document.getElementById('rowCount').textContent =
    `${filtered.length.toLocaleString()} row${filtered.length !== 1 ? 's' : ''}`;
  document.getElementById('pageInfo').textContent =
    `Page ${page + 1} of ${totalPages}`;
  document.getElementById('prevPage').disabled = page === 0;
  document.getElementById('nextPage').disabled = page >= totalPages - 1;

  // Sort click
  thead.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const ci = parseInt(th.dataset.col, 10);
      if (state.sortCol === ci) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = ci;
        state.sortDir = 'asc';
      }
      applyFilter();
    });
  });
}

/* ── AI Q&A ───────────────────────────────────────────── */
function buildDataContext() {
  const { headers, allRows, colTypes } = state;
  const numCols = headers.filter(h => colTypes[h] === 'number');
  const stats = numCols.map(h => {
    const i = headers.indexOf(h);
    const vals = allRows.map(r => toNum(r[i])).filter(v => !isNaN(v));
    const sum  = vals.reduce((a, b) => a + b, 0);
    return `${h}: sum=${fmtNum(sum)}, avg=${fmtNum(Math.round(sum/vals.length))}, min=${fmtNum(Math.min(...vals))}, max=${fmtNum(Math.max(...vals))}`;
  });

  // Include leader names so AI can reference them in viz hints
  const leaderNames = state.leaderCol >= 0
    ? [...new Set(allRows.map(r => r[state.leaderCol]).filter(Boolean))]
    : [];

  const idx = summaryIndices();
  const topRows = [...allRows]
    .filter(r => idx.tgtColl >= 0 && String(r[idx.exam] || '').trim())
    .sort((a, b) => (toNum(b[idx.tgtColl]) || 0) - (toNum(a[idx.tgtColl]) || 0))
    .slice(0, 25);
  const total = state.reportMeta.totalRow || [];

  const preview = [headers.join(', ')];
  for (const row of topRows.length ? topRows : allRows.slice(0, 40)) preview.push(row.join(', '));
  if (allRows.length > preview.length) preview.push(`... and ${allRows.length - preview.length + 1} more rows`);

  return `Source: ${state.sourceLabel}
Active report: ${state.activeReport}
Total rows: ${allRows.length}
Exact summary total row: ${total.length ? total.join(', ') : 'not available'}
${leaderNames.length ? `Leaders: ${leaderNames.join(', ')}\nActive filter: ${state.activeLeader || 'All leaders'}` : ''}
Columns: ${headers.join(', ')}
Column stats:\n${stats.join('\n')}

Data preview:\n${preview.join('\n')}`;
}

/* Parse a [VIZ:{...}] tag that the AI may append to its answer */
function extractViz(raw) {
  const m = raw.match(/\[VIZ:\s*(\{[\s\S]*?\})\s*\]/i);
  if (!m) return { text: raw, viz: null };
  try {
    const viz  = JSON.parse(m[1]);
    const text = raw.replace(m[0], '').trim();
    return { text, viz };
  } catch {
    return { text: raw.replace(m[0], '').trim(), viz: null };
  }
}

/* Apply viz hints returned by AI */
function applyVizHint(viz) {
  if (!viz) return;
  let changed = false;

  // Switch metric being visualised
  if (viz.metric) {
    const found = state.headers.find(h =>
      h.toLowerCase().includes(viz.metric.toLowerCase()) && isNumeric(h)
    );
    if (found && found !== state.activeMetric) {
      state.activeMetric = found;
      const sel = document.getElementById('metricSelect');
      if (sel) sel.value = found;
      changed = true;
    }
  }

  // Leader filter
  if ('leader' in viz) {
    const target = viz.leader || null;
    const known  = state.leaderCol >= 0
      ? [...new Set(state.allRows.map(r => r[state.leaderCol]))]
      : [];
    if (target === null || known.includes(target)) {
      applyLeaderFilter(target); // applyLeaderFilter already calls renderCharts
      changed = false;           // don't double-render
    }
  }

  // Chart type
  if (viz.chart === 'bar' || viz.chart === 'line') {
    state.chartType = viz.chart;
    document.querySelectorAll('.chip[data-chart]').forEach(c =>
      c.classList.toggle('chip-active', c.dataset.chart === viz.chart)
    );
    changed = true;
  }

  if (changed) renderCharts();
}

function addMessage(role, html) {
  const msgs = document.getElementById('chatMessages');

  // Remove welcome screen on first message
  const welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;
  wrap.innerHTML = `
    <div class="chat-avatar">${role === 'ai' ? '◈' : 'U'}</div>
    <div class="chat-bubble">${html}</div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function addTyping() {
  const msgs = document.getElementById('chatMessages');
  const welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const wrap = document.createElement('div');
  wrap.className = 'chat-msg ai';
  wrap.id = 'typingIndicator';
  wrap.innerHTML = `
    <div class="chat-avatar">◈</div>
    <div class="chat-bubble">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  document.getElementById('typingIndicator')?.remove();
}

async function sendQuestion(question) {
  if (!question.trim()) return;
  if (!state.headers.length) {
    addMessage('ai', 'Please load a dataset first — use "Connect Data" or "Try Demo Data".');
    return;
  }

  addMessage('user', esc(question));
  addTyping();

  const input = document.getElementById('chatInput');
  const btn   = document.getElementById('chatSend');
  input.disabled = true;
  btn.disabled   = true;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, dataContext: buildDataContext() }),
    });
    const json = await res.json();
    removeTyping();
    if (json.error) {
      addMessage('ai', `<span style="color:var(--rose)">${esc(json.error)}</span>`);
    } else {
      const { text, viz } = extractViz(json.answer);
      addMessage('ai', simpleMarkdown(text));
      if (viz) applyVizHint(viz);
    }
  } catch {
    removeTyping();
    addMessage('ai', '<span style="color:var(--rose)">Could not reach the server. Make sure <code>node server.js</code> is running.</span>');
  } finally {
    input.disabled = false;
    btn.disabled   = false;
    input.focus();
  }
}

/* Minimal safe markdown renderer */
function simpleMarkdown(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── Data source connections ─────────────────────────── */
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) { document.getElementById(id).style.display = 'none'; }

function showLoading(text = 'Loading data…') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }

async function connectSheets() {
  const url = document.getElementById('sheetsUrl').value.trim();
  const err = document.getElementById('sheetsError');
  err.textContent = '';

  if (!url) { err.textContent = 'Please enter a URL.'; return; }

  hideModal('sheetsModal');
  showLoading('Detecting sheets…');

  try {
    // Step 1: get the list of sheets
    const metaRes = await fetch(`/api/sheets/meta?url=${encodeURIComponent(url)}`);
    const meta    = await metaRes.json();
    if (meta.error) throw new Error(meta.error);

    const sheets = (meta.sheets && meta.sheets.length) ? meta.sheets : [{ name: 'Sheet1', gid: '0' }];
    state.sheetsUrl  = url;
    state.sheetList  = sheets;

    // Step 2: render tabs (only visible when > 1 sheet)
    renderSheetTabs(sheets);

    // Step 3: load the first sheet
    await loadSheet(sheets[0]);
  } catch (e) {
    hideLoading();
    showModal('sheetsModal');
    document.getElementById('sheetsError').textContent = e.message;
  }
}

/* Render sheet tab buttons */
function renderSheetTabs(sheets) {
  const wrap   = document.getElementById('sheetTabsWrap');
  const tabsEl = document.getElementById('sheetTabs');

  if (sheets.length <= 1) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  tabsEl.innerHTML = sheets.map((s, i) =>
    `<button class="sheet-tab${i === 0 ? ' active' : ''}" data-sheet="${esc(s.name)}" data-gid="${esc(s.gid || '')}">${esc(s.name)}</button>`
  ).join('');

  tabsEl.querySelectorAll('.sheet-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      if (tab.classList.contains('active')) return;
      tabsEl.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      await loadSheet({ name: tab.dataset.sheet, gid: tab.dataset.gid || null });
    });
  });
}

/* ── Auto-refresh ─────────────────────────────────────── */
function startAutoRefresh(secs) {
  stopAutoRefresh();
  state.autoRefresh      = true;
  state.refreshInterval  = secs || state.refreshInterval;
  state.refreshCountdown = state.refreshInterval;

  state.refreshTimer = setInterval(() => silentRefresh(), state.refreshInterval * 1000);
  state.refreshTickTimer = setInterval(() => {
    state.refreshCountdown = Math.max(0, state.refreshCountdown - 1);
    updateRefreshCtrl();
  }, 1000);

  document.getElementById('refreshCtrl').style.display = 'flex';
  updateRefreshCtrl();
}

function stopAutoRefresh() {
  clearInterval(state.refreshTimer);
  clearInterval(state.refreshTickTimer);
  state.refreshTimer     = null;
  state.refreshTickTimer = null;
  state.autoRefresh      = false;
  updateRefreshCtrl();
}

function updateRefreshCtrl() {
  const dot      = document.getElementById('refreshDot');
  const label    = document.getElementById('refreshCountdown');
  const toggle   = document.getElementById('refreshToggle');
  if (!dot) return;

  if (state.autoRefresh) {
    dot.classList.remove('paused');
    const s = state.refreshCountdown;
    label.textContent = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
    toggle.textContent = '⏸';
    toggle.title = 'Pause auto-refresh';
  } else {
    dot.classList.add('paused');
    label.textContent = 'paused';
    toggle.textContent = '▶';
    toggle.title = 'Resume auto-refresh';
  }

  // Last-updated in browser title
  if (state.lastRefreshed) {
    const diff = Math.round((Date.now() - state.lastRefreshed) / 1000);
    const ago  = diff < 60 ? `${diff}s ago` : `${Math.floor(diff / 60)}m ago`;
    document.title = `DataPulse — updated ${ago}`;
  }
}

async function silentRefresh() {
  if (state.sourceMode === 'auto-summary') {
    state.refreshCountdown = state.refreshInterval;
    await loadConfiguredSummary({ silent: true, restartRefresh: false });

    const ctrl = document.getElementById('refreshCtrl');
    if (ctrl) {
      ctrl.classList.add('flash');
      setTimeout(() => ctrl.classList.remove('flash'), 1400);
    }
    updateRefreshCtrl();
    return;
  }

  if (!state.currentSheetInfo || !state.sheetsUrl) return;
  state.refreshCountdown = state.refreshInterval;

  try {
    const { name, gid } = state.currentSheetInfo;
    const params = new URLSearchParams({ url: state.sheetsUrl });
    if (gid) params.set('gid', gid); else params.set('sheet', name);

    const res  = await fetch(`/api/sheets?${params}`);
    const text = await res.text();
    if (!res.ok) return;

    const cleaned = smartParseCsv(text);
    if (!cleaned.headers.length) return;

    // Preserve UI state across refresh
    const prevLeader = state.activeLeader;
    const prevMetric = state.activeMetric;
    const prevSearch = state.search;

    state.headers  = cleaned.headers;
    state.allRows  = cleaned.rows;
    state.colTypes = detectTypes(cleaned.headers, cleaned.rows);
    state.lastRefreshed = Date.now();

    initLeaderFilter();
    if (prevLeader) applyLeaderFilter(prevLeader);
    state.activeMetric = prevMetric;
    if (state.activeMetric) {
      const sel = document.getElementById('metricSelect');
      if (sel) sel.value = state.activeMetric;
    }
    state.search = prevSearch;
    document.getElementById('tableSearch').value = prevSearch;

    renderOracleKPIs();
    renderCharts();
    applyFilter();
    // Refresh TVA if on overview
    const at = document.querySelector('.dp-subtab.active');
    if (at && at.dataset.subtab === 'overview') {
      renderActiveReport();
    }

    // Brief flash to confirm update
    const ctrl = document.getElementById('refreshCtrl');
    ctrl.classList.add('flash');
    setTimeout(() => ctrl.classList.remove('flash'), 1400);
    updateRefreshCtrl();
  } catch (e) {
    console.warn('Auto-refresh error:', e.message);
  }
}

/* Load a sheet by { name, gid } — gid takes priority (preserves merged cells) */
async function loadSheet({ name, gid }) {
  showLoading(`Loading "${name}"…`);
  state.sourceMode = 'sheets';
  state.currentSheetInfo = { name, gid };      // save for auto-refresh
  try {
    const params = new URLSearchParams({ url: state.sheetsUrl });
    if (gid) params.set('gid', gid); else params.set('sheet', name);

    const res  = await fetch(`/api/sheets?${params}`);
    const text = await res.text();
    if (!res.ok) {
      const j = JSON.parse(text);
      throw new Error(j.error || 'Fetch failed');
    }
    const cleaned = smartParseCsv(text);
    if (!cleaned.headers.length) throw new Error(`No valid text columns found in "${name}"`);
    hideLoading();
    state.lastRefreshed = Date.now();
    loadData({ ...cleaned, label: name });
    // Start auto-refresh for Google Sheets sources
    startAutoRefresh(parseInt(document.getElementById('refreshIntervalSel')?.value || '60', 10));
  } catch (e) {
    hideLoading();
    if (document.getElementById('dashboard').style.display !== 'none') {
      addMessage('ai', `<span style="color:var(--rose)">Could not load sheet "${esc(name)}": ${esc(e.message)}</span>`);
    } else {
      showModal('sheetsModal');
      document.getElementById('sheetsError').textContent = e.message;
    }
  }
}

/* Keep old name as alias for any remaining callers */
async function loadSheetByName(name) { await loadSheet({ name, gid: null }); }

async function connectMetabase() {
  const url  = document.getElementById('mbUrl').value.trim();
  const tok  = document.getElementById('mbToken').value.trim();
  const qid  = document.getElementById('mbQuestionId').value.trim();
  const err  = document.getElementById('metabaseError');
  err.textContent = '';

  if (!url || !tok || !qid) { err.textContent = 'All fields are required.'; return; }

  hideModal('metabaseModal');
  showLoading('Connecting to Metabase…');

  try {
    const res = await fetch('/api/metabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metabaseUrl: url, sessionToken: tok, questionId: qid }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Metabase error');

    // Metabase returns { data: { cols, rows } }
    const cols = json.data?.cols || json.cols || [];
    const rows = json.data?.rows || json.rows || [];
    if (!cols.length) throw new Error('No columns returned from Metabase');

    const headers = cols.map(c => c.display_name || c.name || 'Col');
    hideLoading();
    state.sourceMode = 'metabase';
    state.currentSheetInfo = null;
    loadData({ headers, rows, label: `Metabase Q#${qid}` });
  } catch (e) {
    hideLoading();
    showModal('metabaseModal');
    document.getElementById('metabaseError').textContent = e.message;
  }
}

/* ── Toast helper ────────────────────────────────────── */
function showToast(msg, duration = 3500) {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ── Build Summary Wizard ─────────────────────────────── */
const wizardState = {
  step: 1,
  mode: 'five',   // 'five' = PW five-sheet mode | 'generic' = old 3-source mode

  // ── Five-sheet PW sources ──────────────────────────────
  sources: {
    targets:  { url:'', headers:[], rows:[], connected:false }, // Targets Vertical Format
    tillMay:  { url:'', headers:[], rows:[], connected:false }, // Till May Achieved (daily with dates)
    dod:      { url:'', headers:[], rows:[], connected:false }, // DOD Achieved Data (optional snapshot)
    acTarget: { url:'', headers:[], rows:[], connected:false }, // AC Target (optional leader-level)
    lastYear: { url:'', headers:[], rows:[], connected:false }, // Last Year Numbers (optional YoY)
    // Legacy generic sources (kept for backward compat)
    raw: { url:'', headers:[], rows:[], connected:false },
    aop: { url:'', headers:[], rows:[], connected:false },
    ly:  { url:'', headers:[], rows:[], connected:false },
  },
  mapping: {
    date:'', leader:'', category:'', gross:'', net:'',
    orderCount:'', orderCountMode:'each-row',
  },
  aopMapping: {
    leader:'', category:'', gross:'', net:'',
    orders:'', aov:'', bizProjected:'',
  },
  period: {
    month:     '',     // YYYY-MM
    year:      '',     // YYYY (fiscal year end, e.g. 2027 for FY27)
    monthShort: '',    // short name like "May"
    daysTotal: 26,
    daysSoFar: 0,
  },
};

function applyAutoSummaryConfig() {
  const cfg = AUTO_SUMMARY_CONFIG;
  wizardState.mode = 'five';
  wizardState.period = {
    ...wizardState.period,
    ...cfg.period,
  };

  Object.entries(cfg.sources).forEach(([key, sourceCfg]) => {
    if (!wizardState.sources[key]) return;
    wizardState.sources[key].url = sourceCfg.url || '';
    wizardState.sources[key].connected = false;
    wizardState.sources[key].headers = [];
    wizardState.sources[key].rows = [];
  });
}

async function loadConfiguredWizardSource(key, sourceCfg) {
  const src = wizardState.sources[key];
  if (!src) return;

  src.url = sourceCfg.url || '';
  src.connected = false;
  src.headers = [];
  src.rows = [];

  if (!src.url) return;

  const params = new URLSearchParams({ url: src.url });
  if (sourceCfg.gid) params.set('gid', sourceCfg.gid);

  const res = await fetch(`/api/sheets?${params}`);
  const text = await res.text();
  if (!res.ok) {
    let message = 'Fetch failed';
    try { message = JSON.parse(text).error || message; } catch {}
    throw new Error(`${key}: ${message}`);
  }

  const allRaw = parseCSVAllRows(text);
  if (!allRaw.length) throw new Error(`${key}: sheet appears empty`);

  const { headerIdx } = detectMultiHeader(allRaw);
  src.headers = (allRaw[headerIdx] || []).map(v => String(v ?? '').trim());
  src.rows = allRaw.slice(headerIdx + 1).filter(r => r.some(v => String(v ?? '').trim()));
  src.connected = true;
}

async function loadConfiguredSummaryOutput() {
  const sourceCfg = AUTO_SUMMARY_CONFIG.summary;
  const params = new URLSearchParams({ url: sourceCfg.url });
  if (sourceCfg.gid) params.set('gid', sourceCfg.gid);

  const res = await fetch(`/api/sheets?${params}`);
  const text = await res.text();
  if (!res.ok) {
    let message = 'Fetch failed';
    try { message = JSON.parse(text).error || message; } catch {}
    throw new Error(`summary: ${message}`);
  }
  return parseFormulaSummaryCsv(text);
}

async function loadConfiguredSummary({ silent = false, restartRefresh = true } = {}) {
  if (!AUTO_SUMMARY_CONFIG.enabled) return;

  if (!silent) showLoading('Loading configured sheets...');
  state.sourceMode = 'auto-summary';
  state.currentSheetInfo = null;
  state.sheetsUrl = '';

  try {
    applyAutoSummaryConfig();
    await Promise.all(
      Object.entries(AUTO_SUMMARY_CONFIG.sources).map(([key, sourceCfg]) =>
        loadConfiguredWizardSource(key, sourceCfg)
      )
    );

    wizardAutoDetectFiveSheets();
    const computed = computeSummaryFromFiveSheets();
    const result = await loadConfiguredSummaryOutput();
    if (!result.rows.length) {
      throw new Error('No summary rows found. Check the configured sheet tabs and June period columns.');
    }

    hideLoading();
    state.lastRefreshed = Date.now();
    const rawSummary = {
      headers: result.headers,
      rows: result.rows,
      totalRow: result.totalRow,
    };
    state.reportMeta = {
      exactSummary: true,
      computed,
      rawSummary,
      totalRow: result.totalRow,
      period: AUTO_SUMMARY_CONFIG.period,
    };
    const adjusted = applyYtdModeToSummary(rawSummary, state.ytdMode);
    state.reportMeta.totalRow = adjusted.totalRow;
    loadData({
      headers: adjusted.headers,
      rows: adjusted.rows,
      label: AUTO_SUMMARY_CONFIG.label,
    });

    if (restartRefresh) {
      startAutoRefresh(parseInt(document.getElementById('refreshIntervalSel')?.value || '60', 10));
    } else {
      updateRefreshCtrl();
    }
  } catch (e) {
    hideLoading();
    console.error(e);
    if (silent) {
      showToast(`Refresh failed: ${e.message}`, 6000);
      return;
    }
    const hero = document.getElementById('heroSection');
    const dashboard = document.getElementById('dashboard');
    if (hero) hero.style.display = 'block';
    if (dashboard) dashboard.style.display = 'none';
    addMessage('ai', `<span style="color:var(--rose)">Could not load configured sheets: ${esc(e.message)}</span>`);
    showToast(`Could not load configured sheets: ${e.message}`, 6000);
  }
}

function openBuildWizard() {
  // Reset to step 1 but keep previously entered URLs
  wizardState.step = 1;
  document.getElementById('wizardError').textContent = '';

  // Default period to current month/year
  const now = new Date();
  if (!wizardState.period.month) {
    wizardState.period.month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (!wizardState.period.year) {
    wizardState.period.year = String(now.getFullYear());
  }

  updateWizardStepUI();
  renderWizardStep(1);
  document.getElementById('buildWizardModal').style.display = 'flex';
}

function closeBuildWizard() {
  document.getElementById('buildWizardModal').style.display = 'none';
}

function updateWizardStepUI() {
  const step = wizardState.step;
  // Step items
  document.querySelectorAll('.wizard-step-item').forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle('active', s === step);
    el.classList.toggle('done', s < step);
  });
  // Lines between steps
  document.querySelectorAll('.wizard-step-line').forEach((el, i) => {
    el.classList.toggle('done', i + 1 < step);
  });
  // Back button visibility
  document.getElementById('wizardBackBtn').style.display = step > 1 ? 'inline-flex' : 'none';
  // Next button label
  const nextBtn = document.getElementById('wizardNextBtn');
  if (step === 4) {
    nextBtn.textContent = 'Generate Dashboard ->';
    nextBtn.style.background = '';
  } else {
    nextBtn.textContent = 'Next ->';
  }
  document.getElementById('wizardError').textContent = '';
}

function renderWizardStep(step) {
  const content = document.getElementById('wizardContent');
  if (step === 1) content.innerHTML = renderStep1();
  else if (step === 2) content.innerHTML = renderStep2();
  else if (step === 3) content.innerHTML = renderStep3();
  else if (step === 4) content.innerHTML = renderStep4();

  // Bind step-specific events after rendering
  if (step === 1) bindStep1Events();
  else if (step === 2) bindStep2Events();
  else if (step === 3) bindStep3Events();
}

/* ── Step 1 — Data Sources (5-sheet PW mode) ──────────── */
function renderStep1() {
  const s = wizardState.sources;

  const SHEET_META = [
    { key:'targets',  label:'Targets Vertical Format', required:true,
      desc:'Monthly orders & collection targets per batch/exam',
      hint:'Cols: Leader, Updated Exam, Type, Mar Orders, Apr Orders … Mar Collection, Apr Collection …' },
    { key:'tillMay',  label:'Till May Achieved (Daily Data)', required:true,
      desc:'Daily achieved data with converted_date — used for MTD, YTD, last 3 days, DRR',
      hint:'Cols: Leader, Updated Exam, converted_date, total_orders_fy27, collection_fy27, type' },
    { key:'dod',      label:'DOD Achieved Data', required:false,
      desc:"Today's snapshot (optional — uses Till May Achieved if not provided)",
      hint:'Cols: batch, exam, total_orders_fy27, collection_fy27, type, Updated_exam' },
    { key:'acTarget', label:'AC Target', required:false,
      desc:'Leader-level category targets — adds category-level AOP comparison',
      hint:'Cols: Leader, Updated Category, Type, Apr Orders, May Orders … Apr Collection …' },
    { key:'lastYear', label:'Last Year Numbers', required:false,
      desc:'FY26 data for year-on-year growth calculations',
      hint:'Cols: Leader, Updated Exam, month_year, total_orders_fy26, total_collection_fy26' },
  ];

  const rows = SHEET_META.map(({ key, label, required, desc, hint }) => {
    const src = s[key];
    const statusClass = src.connected ? 'connected' : (src.url && !src.connected ? 'error' : '');
    const statusText  = src.connected
      ? `✓ ${src.rows.length.toLocaleString()} rows`
      : required ? 'Required' : 'Optional';
    return `
      <div class="data-source-row">
        <div class="data-source-meta">
          <span class="data-source-label">${esc(label)}${required ? ' <span style="color:var(--rose)">*</span>' : ''}</span>
          <span class="data-source-desc">${esc(desc)}</span>
          <span class="data-source-hint">${esc(hint)}</span>
        </div>
        <div class="data-source-inputs">
          <input type="url" class="data-source-input" id="wSrc_${key}"
            placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(src.url)}">
          <button class="data-source-connect" id="wConn_${key}">Connect</button>
        </div>
        <span class="source-status ${statusClass}" id="wStat_${key}">
          <span class="source-status-dot"></span>
          <span id="wStatText_${key}">${statusText}</span>
        </span>
      </div>`;
  });

  return `
    <div class="wizard-step-title">Connect Your 5 Data Sheets</div>
    <div class="wizard-step-desc">
      Paste public Google Sheets URLs for each source.
      <strong>Targets</strong> and <strong>Till May Achieved</strong> are required — the rest unlock YoY, category targets, and DoD metrics.
    </div>
    ${rows.join('')}
  `;
}

function bindStep1Events() {
  ['targets','tillMay','dod','acTarget','lastYear','raw','aop','ly'].forEach(key => {
    const inp = document.getElementById(`wSrc_${key}`);
    const btn = document.getElementById(`wConn_${key}`);
    if (inp) inp.addEventListener('input', () => { wizardState.sources[key].url = inp.value.trim(); });
    if (btn) btn.addEventListener('click', () => wizardConnectSource(key));
    // Also update on Enter
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') wizardConnectSource(key); });
  });
}

async function wizardConnectSource(key) {
  const src = wizardState.sources[key];
  const inp = document.getElementById(`wSrc_${key}`);
  const btn = document.getElementById(`wConn_${key}`);
  const statEl   = document.getElementById(`wStat_${key}`);
  const statText = document.getElementById(`wStatText_${key}`);

  src.url = inp ? inp.value.trim() : src.url;
  if (!src.url) {
    if (statEl) { statEl.className = 'source-status error'; }
    if (statText) statText.textContent = 'Enter URL first';
    return;
  }

  // Loading state
  if (statEl) statEl.className = 'source-status loading';
  if (statText) statText.textContent = 'Connecting…';
  if (btn) btn.disabled = true;

  try {
    const res  = await fetch(`/api/sheets?url=${encodeURIComponent(src.url)}`);
    const text = await res.text();
    if (!res.ok) {
      const j = JSON.parse(text);
      throw new Error(j.error || 'Fetch failed');
    }

    // Use parseCSVAllRows then smartParseCsv to get headers + rows
    const allRaw = parseCSVAllRows(text);
    if (!allRaw.length) throw new Error('Sheet appears empty');

    const { headerIdx } = detectMultiHeader(allRaw);
    // IMPORTANT: do NOT filter(Boolean) — empty columns must stay to keep row/header indices aligned
    // (Targets and AC-Target have empty separator columns, filtering them shifts all subsequent indices)
    src.headers = (allRaw[headerIdx] || []).map(v => String(v ?? '').trim());
    // Data rows start after header row
    src.rows    = allRaw.slice(headerIdx + 1).filter(r => r.some(v => String(v ?? '').trim()));
    src.connected = true;

    if (statEl) statEl.className = 'source-status connected';
    if (statText) statText.textContent = `${src.rows.length.toLocaleString()} rows`;

    // If this is the raw source, auto-detect column mappings
    if (key === 'raw') wizardAutoDetect();

  } catch (e) {
    src.connected = false;
    if (statEl) statEl.className = 'source-status error';
    if (statText) statText.textContent = e.message.slice(0, 30);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wizardAutoDetect() {
  const hdrs = wizardState.sources.raw.headers;
  const find = (...terms) => hdrs.find(h =>
    terms.some(t => h.toLowerCase().includes(t.toLowerCase()))
  ) || '';

  const m = wizardState.mapping;

  // Also look for ISO-date-shaped column names (e.g. "2026-05-31") or "YYYY-MM-DD"-like headers
  const dateShapeRe = /^\d{4}[-\/]\d{2}[-\/]\d{2}$|^\d{1,2}[-\/]\w{3}[-\/]\d{4}$/;
  const dateCol = find('date', 'day', 'timestamp', 'created') ||
    hdrs.find(h => dateShapeRe.test(h.trim())) || '';

  m.date     = m.date     || dateCol;
  m.leader   = m.leader   || find('leader', 'rep', 'name', 'agent', 'manager');
  m.category = m.category || find('category', 'cat', 'product', 'segment', 'type', 'class');
  m.gross    = m.gross    || find('gross', 'collection', 'revenue', 'amount', 'sales', 'gmv');
  m.net      = m.net      || find('net');
  m.orderCount = m.orderCount || find('order', 'count', 'qty', 'quantity', 'units');

  // Auto-detect AOP mapping if AOP source is connected
  if (wizardState.sources.aop.connected) {
    const ah = wizardState.sources.aop.headers;
    const af = (...terms) => ah.find(h =>
      terms.some(t => h.toLowerCase().includes(t.toLowerCase()))
    ) || '';
    const am = wizardState.aopMapping;
    am.leader   = am.leader   || af('leader', 'rep', 'name');
    am.category = am.category || af('category', 'cat', 'product', 'segment');
    am.gross    = am.gross    || af('gross', 'collection', 'revenue', 'aop');
    am.net      = am.net      || af('net');
    am.orders   = am.orders   || af('order', 'count');
    am.aov      = am.aov      || af('aov', 'avg order', 'average order');
    am.bizProjected = am.bizProjected || af('proj', 'biz', 'business');
  }
}

/* ── Five-sheet auto-detect ───────────────────────────── */
function wizardAutoDetectFiveSheets() {
  // Targets Vertical Format: auto-find key columns
  const th = wizardState.sources.targets.headers;
  const tf = (...t) => th.find(h => t.some(x => h.toLowerCase().includes(x.toLowerCase()))) || '';
  wizardState._tMap = {
    leader: tf('leader'),
    exam:   tf('updated exam'),
    type:   tf('type'),
    generic: tf('generic name'),
    finCat: tf('finance category'),
  };

  // Till May Achieved: auto-find key columns
  const ah = wizardState.sources.tillMay.headers;
  const af = (...t) => ah.find(h => t.some(x => h.toLowerCase().includes(x.toLowerCase()))) || '';
  // Date: exact or ends-with 'date', avoids matching "updated" (which contains "date")
  const aDateCol = ah.find(h => {
    const low = h.toLowerCase().trim();
    return low === 'date' || low === 'day' || low === 'converted_date' ||
      /^(transaction|order|payment|created|sale).*date$/.test(low) ||
      /^.*(converted|order|payment)_date$/.test(low) ||
      low.endsWith('_date') || low.endsWith('date') && !low.startsWith('up');
  }) || '';
  wizardState._aMap = {
    leader:  af('leader'),
    exam:    af('updated exam'),
    date:    aDateCol,
    orders:  af('total_orders_fy27', 'orders_fy', 'total_orders'),
    coll:    af('collection_fy27', 'collection_fy', 'collection'),
    type:    af('type'),
  };

  // Last Year Numbers
  if (wizardState.sources.lastYear.connected) {
    const lh = wizardState.sources.lastYear.headers;
    const lf = (...t) => lh.find(h => t.some(x => h.toLowerCase().includes(x.toLowerCase()))) || '';
    wizardState._lMap = {
      leader:  lf('leader'),
      exam:    lf('updated exam'),
      month:   lf('month_year', 'month'),
      orders:  lf('total_orders_fy26', 'orders_fy26', 'total_orders'),
      coll:    lf('total_collection_fy26', 'collection_fy26', 'collection'),
    };
  }
}

/* ── Step 2 — Column Mapping ──────────────────────────── */
function renderStep2() {
  // In five-sheet mode, show a confirmation screen (schemas are well-known)
  if (wizardState.mode === 'five') return renderStep2FiveSheet();

  const hdrs = wizardState.sources.raw.headers;
  const m    = wizardState.mapping;
  const aopConnected = wizardState.sources.aop.connected;
  const ah   = wizardState.sources.aop.headers;
  const am   = wizardState.aopMapping;

  function selOpts(headers, selected, required) {
    // Always include a placeholder so the browser doesn't silently pick a wrong default
    const placeholder = `<option value="" ${!selected ? 'selected' : ''} disabled>${required ? '— select column —' : '— not mapped —'}</option>`;
    return placeholder + headers.map(h =>
      `<option value="${esc(h)}" ${h === selected ? 'selected' : ''}>${esc(h)}</option>`
    ).join('');
  }

  function mapRow(label, id, headers, selected, required = false) {
    return `
      <div class="mapping-row">
        <span class="mapping-label">${label}${required ? '<span class="mapping-required">*</span>' : ''}</span>
        <select class="mapping-select" id="${id}">
          ${selOpts(headers, selected, required)}
        </select>
      </div>`;
  }

  const orderSection = `
    <div class="mapping-row">
      <span class="mapping-label">Order Count</span>
      <div class="mapping-mode-row">
        <label class="mapping-radio-label">
          <input type="radio" name="orderCountMode" value="each-row" ${m.orderCountMode === 'each-row' ? 'checked' : ''}>
          Count each row as 1
        </label>
        <label class="mapping-radio-label">
          <input type="radio" name="orderCountMode" value="column" ${m.orderCountMode === 'column' ? 'checked' : ''}>
          Use column:
        </label>
      </div>
      <select class="mapping-select" id="wMap_orderCount" ${m.orderCountMode !== 'column' ? 'disabled' : ''}>
        <option value="">— not mapped —</option>
        ${hdrs.map(h => `<option value="${esc(h)}" ${h === m.orderCount ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select>
    </div>`;

  return `
    <div class="col-mapping-section">
      <div class="col-mapping-title">Raw Transactions Columns</div>
      <div class="col-mapping-grid">
        ${mapRow('Date', 'wMap_date', hdrs, m.date, true)}
        ${mapRow('Leader', 'wMap_leader', hdrs, m.leader, true)}
        ${mapRow('Category', 'wMap_category', hdrs, m.category, true)}
        ${mapRow('Gross Revenue', 'wMap_gross', hdrs, m.gross, true)}
        ${mapRow('Net Revenue', 'wMap_net', hdrs, m.net, false)}
        ${orderSection}
      </div>
    </div>
    ${aopConnected ? `
    <div class="col-mapping-section">
      <div class="col-mapping-title">AOP Targets Columns</div>
      <div class="col-mapping-grid">
        ${mapRow('Leader', 'wAop_leader', ah, am.leader, true)}
        ${mapRow('Category', 'wAop_category', ah, am.category, true)}
        ${mapRow('AOP Gross', 'wAop_gross', ah, am.gross, false)}
        ${mapRow('AOP Net', 'wAop_net', ah, am.net, false)}
        ${mapRow('AOP Orders', 'wAop_orders', ah, am.orders, false)}
        ${mapRow('AOP AOV', 'wAop_aov', ah, am.aov, false)}
        ${mapRow('Biz Team Projected', 'wAop_bizProjected', ah, am.bizProjected, false)}
      </div>
    </div>` : ''}
  `;
}

function bindStep2Events() {
  const m  = wizardState.mapping;
  const am = wizardState.aopMapping;

  // Wire up a select: sync initial DOM value �' state, then keep in sync on change
  const bind = (id, obj, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Read current DOM value into state (covers cases where auto-detect left state empty
    // but the browser chose a default, or vice-versa)
    if (el.value) obj[key] = el.value;
    el.addEventListener('change', () => { obj[key] = el.value; });
  };

  bind('wMap_date',       m, 'date');
  bind('wMap_leader',     m, 'leader');
  bind('wMap_category',   m, 'category');
  bind('wMap_gross',      m, 'gross');
  bind('wMap_net',        m, 'net');
  bind('wMap_orderCount', m, 'orderCount');

  // Order count radio buttons
  document.querySelectorAll('input[name="orderCountMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      m.orderCountMode = radio.value;
      const sel = document.getElementById('wMap_orderCount');
      if (sel) sel.disabled = (m.orderCountMode !== 'column');
    });
  });

  // AOP mappings
  bind('wAop_leader',       am, 'leader');
  bind('wAop_category',     am, 'category');
  bind('wAop_gross',        am, 'gross');
  bind('wAop_net',          am, 'net');
  bind('wAop_orders',       am, 'orders');
  bind('wAop_aov',          am, 'aov');
  bind('wAop_bizProjected', am, 'bizProjected');
}

/* ── Step 2 (five-sheet) — Column confirmation ─────────── */
function renderStep2FiveSheet() {
  const ws  = wizardState;
  const s   = ws.sources;
  const mon = ws.period.monthShort || 'Jun';  // preview with current month

  // Find column index and value from headers
  const findIdx = (headers, ...terms) =>
    headers.findIndex(h => terms.some(t => h.toLowerCase().trim() === t.toLowerCase().trim() ||
                                           h.toLowerCase().includes(t.toLowerCase())));
  const findMonthIdx = (headers, m, kind) => {
    let i = findIdx(headers, `${m} ${kind}`);
    if (i < 0) i = headers.findIndex(h => h.toLowerCase().startsWith(m.toLowerCase()) && h.toLowerCase().includes(kind.toLowerCase()));
    return i;
  };

  // Build a row showing: label | found column name | index
  const chk = (label, headers, idx) => {
    const found = idx >= 0 ? headers[idx] : null;
    const color = found ? 'var(--emerald)' : 'var(--rose)';
    const text  = found ? `✓ "${esc(found)}" (col ${idx})` : '✗ not found';
    return `<div style="display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span style="min-width:230px;font-size:11px;color:var(--text-3);flex-shrink:0">${esc(label)}</span>
      <span style="font-size:12px;color:${color}">${text}</span>
    </div>`;
  };

  const tH = s.targets.headers;
  const mH = s.tillMay.headers;
  const dH = s.dod.connected ? s.dod.headers : [];
  const aH = s.acTarget.connected ? s.acTarget.headers : [];
  const lH = s.lastYear.connected ? s.lastYear.headers : [];
  return `
    <div class="wizard-step-title">Column Auto-Detection — Verify All Mappings</div>
    <div class="wizard-step-desc">Check every required column is found ✓. Any ✗ means the column header was not detected — go back and verify it exists in your sheet.</div>

    <div class="col-mapping-section" style="margin-bottom:14px">
      <div class="col-mapping-title">1. Targets Vertical Format (${s.targets.rows.length} rows)</div>
      ${chk('Updated Exam (join key)', tH, findIdx(tH,'Updated Exam','updated_exam'))}
      ${chk('Leader', tH, findIdx(tH,'Leader'))}
      ${chk(`${mon} Orders (AOP month)`, tH, findMonthIdx(tH,mon,'Orders'))}
      ${chk(`${mon} Collection (AOP month)`, tH, findMonthIdx(tH,mon,'Collection'))}
      ${chk('FY YTD Orders', tH, findIdx(tH,'FY YTD Orders','FY YTD Order'))}
      ${chk('FY YTD Collection', tH, findIdx(tH,'FY YTD Collection','FY YTD Coll'))}
    </div>

    <div class="col-mapping-section" style="margin-bottom:14px">
      <div class="col-mapping-title">2. Till May Achieved (${s.tillMay.rows.length} rows)</div>
      ${chk('Updated Exam (join key)', mH, (() => { let i=findIdx(mH,'Updated Exam','updated_exam'); return i>=0?i:findIdx(mH,'Updated_exam for test series'); })())}
      ${chk('Date (converted_date)', mH, mH.findIndex(h=>{ const l=h.toLowerCase().trim(); return l==='converted_date'||l==='date'||(l.includes('date')&&!l.startsWith('up')); }))}
      ${chk('Orders (total_orders_fy27)', mH, findIdx(mH,'total_orders_fy27','orders_fy27','total_orders'))}
      ${chk('Collection (collection_fy27)', mH, findIdx(mH,'collection_fy27','collection_fy','total_collection'))}
    </div>

    ${s.dod.connected ? `
    <div class="col-mapping-section" style="margin-bottom:14px">
      <div class="col-mapping-title">3. DOD Achieved Data (${s.dod.rows.length} rows)</div>
      ${chk('Exam (Updated_exam for test series)', dH, (() => { let i=findIdx(dH,'Updated_exam for test series','Updated Exam','updated_exam'); return i>=0?i:1; })())}
      ${chk('Date', dH, (() => { let i=dH.findIndex(h=>{ const l=h.toLowerCase().trim(); return l==='date'||l==='converted_date'||(l.includes('date')&&!l.startsWith('up')); }); return i>=0?i:2; })())}
      ${chk('Orders (total_orders_fy27)', dH, findIdx(dH,'total_orders_fy27','orders_fy27','total_orders'))}
      ${chk('Collection (collection_fy27)', dH, findIdx(dH,'collection_fy27','collection_fy','total_collection'))}
    </div>` : ''}

    ${s.acTarget.connected ? `
    <div class="col-mapping-section" style="margin-bottom:14px">
      <div class="col-mapping-title">4. AC Target (${s.acTarget.rows.length} rows)</div>
      ${chk('Updated Category (join key)', aH, findIdx(aH,'Updated Category','Updated Exam'))}
      ${chk(`${mon} Orders`, aH, findMonthIdx(aH,mon,'Orders'))}
      ${chk(`${mon} Collection`, aH, findMonthIdx(aH,mon,'Collection'))}
      ${chk('YTD Orders', aH, findIdx(aH,'YTD Orders'))}
      ${chk('YTD Collection', aH, findIdx(aH,'YTD Collection'))}
    </div>` : ''}

    ${s.lastYear.connected ? `
    <div class="col-mapping-section">
      <div class="col-mapping-title">5. Last Year Numbers (${s.lastYear.rows.length} rows)</div>
      ${chk('Updated Exam (join key)', lH, findIdx(lH,'Updated Exam','updated_exam'))}
      ${chk('Date / month_year', lH, findIdx(lH,'month_year','converted_date','date'))}
      ${chk('Orders FY26', lH, findIdx(lH,'total_orders_fy26','orders_fy26'))}
      ${chk('Collection FY26', lH, findIdx(lH,'total_collection_fy26','collection_fy26'))}
    </div>` : `<div style="color:var(--text-3);font-size:12px;padding:8px 0">Last Year Numbers not connected.</div>`}

    <div style="margin-top:14px;padding:12px;background:var(--violet-dim);border-radius:8px;font-size:13px;color:#c4b5fd">
      All green? Click <strong>Next -></strong> to set the period.
    </div>
  `;
}

/* ── Step 3 — Period Settings ─────────────────────────── */
function renderStep3() {
  const p = wizardState.period;
  return `
    <div class="wizard-step-title">Period Settings</div>
    <div class="wizard-step-desc">Configure the time period for MTD, YTD, and projection calculations.</div>
    <div class="period-grid">
      <div class="period-field">
        <span class="period-label">Current Month</span>
        <input type="month" class="period-input" id="wPer_month"
          value="${esc(p.month)}" placeholder="YYYY-MM">
        ${wizardState.mode === 'five' ? `
        <span class="period-hint">Short name for target column matching (e.g. "May" matches "May Orders")</span>
        <select class="fp-select" id="wPer_monthShort" style="margin-top:6px">
          ${['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
            .map(m => `<option value="${m}" ${(p.monthShort||'') === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>` : `<span class="period-hint">Used for MTD calculations</span>`}
      </div>
      <div class="period-field">
        <span class="period-label">Current Year</span>
        <input type="number" class="period-input" id="wPer_year"
          value="${esc(p.year)}" min="2000" max="2099" placeholder="YYYY">
        <span class="period-hint">Used for YTD calculations</span>
      </div>
      <div class="period-field">
        <span class="period-label">Total Working Days (month)</span>
        <input type="number" class="period-input" id="wPer_daysTotal"
          value="${esc(p.daysTotal)}" min="1" max="31">
        <span class="period-hint">Business days in the month</span>
      </div>
      <div class="period-field">
        <span class="period-label">Working Days Completed</span>
        <input type="number" class="period-input" id="wPer_daysSoFar"
          value="${esc(p.daysSoFar)}" min="0" max="31">
        <span class="period-hint">Leave 0 to auto-detect from data</span>
      </div>
    </div>
  `;
}

function bindStep3Events() {
  const p = wizardState.period;
  const bind = (id, key, parser) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { p[key] = parser(el.value); });
  };
  bind('wPer_month',     'month',     v => v);
  bind('wPer_year',      'year',      v => v);
  // Sync short month name from the dropdown (five-sheet mode)
  const msEl = document.getElementById('wPer_monthShort');
  if (msEl) {
    // Auto-set from the month input if not already set
    if (!wizardState.period.monthShort && wizardState.period.month) {
      const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      wizardState.period.monthShort = mn[new Date(wizardState.period.month+'-01').getMonth()] || '';
      msEl.value = wizardState.period.monthShort;
    }
    msEl.addEventListener('change', () => { wizardState.period.monthShort = msEl.value; });
  }
  bind('wPer_daysTotal', 'daysTotal', v => Math.max(1, parseInt(v, 10) || 22));
  bind('wPer_daysSoFar', 'daysSoFar', v => Math.max(0, parseInt(v, 10) || 0));
}

/* ── Step 4 — Preview & Generate ─────────────────────────── */
function renderStep4() {
  const ws  = wizardState;
  const raw = ws.sources.raw;
  const m   = ws.mapping;

  // Count unique leaders & categories from mapped columns
  const li  = raw.headers.indexOf(m.leader);
  const ci  = raw.headers.indexOf(m.category);
  const leaders    = li >= 0 ? new Set(raw.rows.map(r => String(r[li] || '').trim()).filter(Boolean)).size : '?';
  const categories = ci >= 0 ? new Set(raw.rows.map(r => String(r[ci] || '').trim()).filter(Boolean)).size : '?';

  const aopNote = ws.sources.aop.connected ? 'AOP targets connected — full metrics available.' : 'AOP targets not connected — AOP columns will be empty.';
  const lyNote  = ws.sources.ly.connected  ? 'Last-year data connected — YoY metrics available.' : 'Last-year data not connected — YoY columns will be empty.';

  return `
    <div class="wizard-step-title">Ready to Generate</div>
    <div class="wizard-step-desc">Review the summary and click Generate to build your dashboard.</div>
    <div class="generate-stats">
      <div class="gen-stat-card">
        <div class="gen-stat-value">${raw.rows.length.toLocaleString()}</div>
        <div class="gen-stat-label">Transactions</div>
      </div>
      <div class="gen-stat-card">
        <div class="gen-stat-value">${leaders}</div>
        <div class="gen-stat-label">Leaders</div>
      </div>
      <div class="gen-stat-card">
        <div class="gen-stat-value">${categories}</div>
        <div class="gen-stat-label">Categories</div>
      </div>
    </div>
    <div class="generate-config-summary">
      <strong>Period:</strong> ${esc(ws.period.month)} &nbsp;·&nbsp;
      <strong>Year:</strong> ${esc(ws.period.year)} &nbsp;·&nbsp;
      <strong>Working days:</strong> ${ws.period.daysSoFar || 'auto'} / ${ws.period.daysTotal}<br>
      <strong>Date col:</strong> ${esc(m.date || '—')} &nbsp;·&nbsp;
      <strong>Leader:</strong> ${esc(m.leader || '—')} &nbsp;·&nbsp;
      <strong>Category:</strong> ${esc(m.category || '—')}<br>
      <strong>Gross:</strong> ${esc(m.gross || '—')} &nbsp;·&nbsp;
      <strong>Net:</strong> ${esc(m.net || '(same as gross)')} &nbsp;·&nbsp;
      <strong>Orders:</strong> ${m.orderCountMode === 'column' && m.orderCount ? esc(m.orderCount) : 'each row = 1'}<br>
      <span style="color:var(--text-3)">${esc(aopNote)}</span><br>
      <span style="color:var(--text-3)">${esc(lyNote)}</span>
    </div>
  `;
}

/* ── Wizard navigation ────────────────────────────────── */
function wizardNext() {
  const err = document.getElementById('wizardError');
  err.textContent = '';

  if (wizardState.step === 1) {
    // Read current values before validating (user may not have clicked Connect)
    ['raw', 'aop', 'ly'].forEach(key => {
      const inp = document.getElementById(`wSrc_${key}`);
      if (inp) wizardState.sources[key].url = inp.value.trim();
    });
    // Detect mode: if any 5-sheet source is connected �' five-sheet mode
    const fiveSrcConnected = wizardState.sources.targets.connected || wizardState.sources.tillMay.connected;
    const genericConnected  = wizardState.sources.raw.connected;

    if (fiveSrcConnected) {
      wizardState.mode = 'five';
      if (!wizardState.sources.targets.connected) { err.textContent = 'Please connect the Targets Vertical Format sheet.'; return; }
      if (!wizardState.sources.tillMay.connected)  { err.textContent = 'Please connect the Till May Achieved sheet.'; return; }
    } else if (genericConnected) {
      wizardState.mode = 'generic';
    } else {
      err.textContent = 'Please connect at least the Targets Vertical Format + Till May Achieved sheets.';
      return;
    }
    // Auto-detect column mappings
    if (wizardState.mode === 'generic') wizardAutoDetect();
    else wizardAutoDetectFiveSheets();
    wizardState.step = 2;

  } else if (wizardState.step === 2) {
    // Five-sheet mode: step 2 is just a confirmation screen — skip column validation
    if (wizardState.mode === 'five') {
      // Verify that auto-detect found the essential columns
      const am = wizardState._aMap || {};
      const tm = wizardState._tMap || {};
      if (!am.leader)   { err.textContent = 'Could not detect Leader column in Till May Achieved. Check that the column is named "Leader".'; return; }
      if (!am.exam)     { err.textContent = 'Could not detect Updated Exam column in Till May Achieved.'; return; }
      if (!am.date)     { err.textContent = 'Could not detect date column in Till May Achieved. Expected "converted_date".'; return; }
      if (!tm.leader)   { err.textContent = 'Could not detect Leader column in Targets Vertical Format.'; return; }
      wizardState.step = 3;
    } else {
      // Generic mode: sync DOM select values �' state, then validate
      const m = wizardState.mapping;
      const am = wizardState.aopMapping;
      const readSel = (id, obj, key) => {
        const el = document.getElementById(id);
        if (el && el.value) obj[key] = el.value;
      };
      readSel('wMap_date',       m, 'date');
      readSel('wMap_leader',     m, 'leader');
      readSel('wMap_category',   m, 'category');
      readSel('wMap_gross',      m, 'gross');
      readSel('wMap_net',        m, 'net');
      readSel('wMap_orderCount', m, 'orderCount');
      readSel('wAop_leader',     am, 'leader');
      readSel('wAop_category',   am, 'category');
      readSel('wAop_gross',      am, 'gross');
      readSel('wAop_net',        am, 'net');
      readSel('wAop_orders',     am, 'orders');
      readSel('wAop_aov',        am, 'aov');
      readSel('wAop_bizProjected', am, 'bizProjected');

      if (!m.date)     { err.textContent = 'Please select the Date column.';     return; }
      if (!m.leader)   { err.textContent = 'Please select the Leader column.';   return; }
      if (!m.category) { err.textContent = 'Please select the Category column.'; return; }
      if (!m.gross)    { err.textContent = 'Please select the Gross Revenue column.'; return; }
      wizardState.step = 3;
    }

  } else if (wizardState.step === 3) {
    const p = wizardState.period;
    if (!p.month) { err.textContent = 'Please set the current month.'; return; }
    if (!p.year)  { err.textContent = 'Please set the current year.';  return; }
    wizardState.step = 4;

  } else if (wizardState.step === 4) {
    wizardGenerateDashboard();
    return;
  }

  updateWizardStepUI();
  renderWizardStep(wizardState.step);
}

function wizardBack() {
  if (wizardState.step > 1) {
    wizardState.step--;
    updateWizardStepUI();
    renderWizardStep(wizardState.step);
  }
}

/* ── Computation Engine ───────────────────────────────── */
function computeSummaryFromRaw(ws) {
  const { sources, mapping: m, aopMapping, period } = ws;
  const rawRows = sources.raw.rows;
  const rawHdrs = sources.raw.headers;

  const di = rawHdrs.indexOf(m.date);
  const li = rawHdrs.indexOf(m.leader);
  const ci = rawHdrs.indexOf(m.category);
  const gi = rawHdrs.indexOf(m.gross);
  const ni = m.net ? rawHdrs.indexOf(m.net) : -1;
  const oi = m.orderCountMode === 'column' && m.orderCount
    ? rawHdrs.indexOf(m.orderCount) : -1;

  const month  = period.month;   // "2026-05"
  const year   = period.year;    // "2026"
  const lyYear = String(parseInt(year, 10) - 1);

  // Normalise date strings: accept YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, etc.
  function normDate(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // Already ISO-ish: YYYY-MM-DD or YYYY/MM/DD
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-');
    // DD/MM/YYYY
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    // Try Date.parse as fallback
    const d = new Date(s);
    if (!isNaN(d)) {
      return d.toISOString().slice(0, 10);
    }
    return s;
  }

  // Find last 3 distinct dates in the month
  const monthDates = [...new Set(
    rawRows.map(r => normDate(r[di])).filter(d => d.startsWith(month))
  )].sort().reverse();
  const last3 = [monthDates[0] || '', monthDates[1] || '', monthDates[2] || ''];

  // Auto-calc days so far from data if not set
  const daysSoFar  = period.daysSoFar || Math.max(1, monthDates.length);
  const daysTotal  = period.daysTotal || 22;

  // Aggregate by leader × category
  const groups = new Map();
  const getGrp = (leader, cat) => {
    const k = `${leader}||${cat}`;
    if (!groups.has(k)) groups.set(k, {
      leader, cat,
      mtdGross: 0, mtdNet: 0, mtdOrders: 0,
      ytdGross: 0, ytdNet: 0, ytdOrders: 0,
      lyGross:  0, lyOrders: 0,
      d0: 0, d1: 0, d2: 0,
      aopGross: NaN, aopNet: NaN, aopOrders: NaN, aopAov: NaN, bizProj: NaN,
      aopYtdGross: NaN, aopYtdOrders: NaN,
    });
    return groups.get(k);
  };

  for (const row of rawRows) {
    const date   = normDate(row[di]);
    const leader = String(row[li] || '').trim();
    const cat    = String(row[ci] || '').trim();
    if (!leader || !cat || !date) continue;

    const gross  = gi >= 0 ? (parseFloat(String(row[gi]).replace(/,/g, '')) || 0) : 0;
    const net    = ni >= 0 ? (parseFloat(String(row[ni]).replace(/,/g, '')) || gross) : gross;
    const orders = oi >= 0 ? (parseFloat(String(row[oi]).replace(/,/g, '')) || 1) : 1;
    const g = getGrp(leader, cat);

    if (date.startsWith(month)) {
      g.mtdGross += gross; g.mtdNet += net; g.mtdOrders += orders;
      if (date === last3[0]) g.d0 += gross;
      if (date === last3[1]) g.d1 += gross;
      if (date === last3[2]) g.d2 += gross;
    }
    if (date.startsWith(year))   { g.ytdGross += gross; g.ytdNet += net; g.ytdOrders += orders; }
    if (date.startsWith(lyYear)) { g.lyGross  += gross; g.lyOrders += orders; }
  }

  // Load AOP targets
  if (sources.aop.connected && aopMapping.leader) {
    const ah   = sources.aop.headers;
    const ali  = ah.indexOf(aopMapping.leader);
    const aci  = ah.indexOf(aopMapping.category);
    const agi  = ah.indexOf(aopMapping.gross);
    const ani  = ah.indexOf(aopMapping.net);
    const aoi  = ah.indexOf(aopMapping.orders);
    const aavi = ah.indexOf(aopMapping.aov);
    const bpi  = ah.indexOf(aopMapping.bizProjected);

    for (const row of sources.aop.rows) {
      const l = String(row[ali] || '').trim();
      const c = String(row[aci] || '').trim();
      if (!l || !c) continue;
      const g = getGrp(l, c);
      if (agi >= 0)  g.aopGross  = parseFloat(String(row[agi]).replace(/,/g,''))  || 0;
      if (ani >= 0)  g.aopNet    = parseFloat(String(row[ani]).replace(/,/g,''))    || 0;
      if (aoi >= 0)  g.aopOrders = parseFloat(String(row[aoi]).replace(/,/g,''))   || 0;
      if (aavi >= 0) g.aopAov    = parseFloat(String(row[aavi]).replace(/,/g,''))  || 0;
      if (bpi >= 0)  g.bizProj   = parseFloat(String(row[bpi]).replace(/,/g,''))   || 0;
    }
  }

  // Load last year data into groups if a separate LY source is connected
  if (sources.ly.connected) {
    const lyHdrs = sources.ly.headers;
    // Try to reuse same mapping keys for the LY sheet
    const lydi = lyHdrs.indexOf(m.date);
    const lyli = lyHdrs.indexOf(m.leader);
    const lyci = lyHdrs.indexOf(m.category);
    const lygi = lyHdrs.indexOf(m.gross);
    const lyoi = oi >= 0 ? lyHdrs.indexOf(m.orderCount) : -1;

    if (lydi >= 0 && lyli >= 0 && lyci >= 0) {
      for (const row of sources.ly.rows) {
        const date   = normDate(row[lydi]);
        const leader = String(row[lyli] || '').trim();
        const cat    = String(row[lyci] || '').trim();
        if (!leader || !cat || !date) continue;

        const gross  = lygi >= 0 ? (parseFloat(String(row[lygi]).replace(/,/g,'')) || 0) : 0;
        const orders = lyoi >= 0 ? (parseFloat(String(row[lyoi]).replace(/,/g,'')) || 1) : 1;
        const g = getGrp(leader, cat);

        // Credit to LY buckets (use the lyYear that corresponds to the current period.year)
        if (date.startsWith(lyYear)) {
          g.lyGross  += gross;
          g.lyOrders += orders;
        }
      }
    }
  }

  // Helper formatters
  const pct  = (n, d)   => (isNaN(n)||isNaN(d)||!d) ? '' : ((n/d)*100).toFixed(1)+'%';
  const fmt  = (n, dec=1) => isNaN(n) ? '' : parseFloat(n.toFixed(dec)).toLocaleString();
  const grow = (a, b)    => (!b || isNaN(b)) ? '' : (((a-b)/b)*100).toFixed(1)+'%';

  const d3Labels = last3.map(d => d || '');

  const summaryHeaders = [
    'Leader', 'Category',
    'Bizfin AOP - Gross', 'Bizfin AOP - Net',
    'Achieved - Gross', 'Achieved - Net', 'Achieved% MTD',
    'Projected', 'Projected % AOP', 'Delta',
    'Bizfin AOP - Orders', 'Achieved Orders', 'Achieved% Orders MTD',
    'Bizfin AOP - AOV', 'Achieved AOV',
    d3Labels[2] || 'Day-3', d3Labels[1] || 'Day-2', d3Labels[0] || 'Day-1', 'DRR',
    'Bizfin AOP - YTD', 'Achieved YTD', 'Achieved% YTD',
    'Bizfin AOP - Orders YTD', 'Achieved Orders YTD', 'Achieved% Orders YTD',
    'Bizfin AOP - AOV YTD', 'Achieved AOV YTD',
    'Last Year Collection YTD', 'This Year Collection YTD', 'Collection Growth%',
    'Last Year Orders YTD', 'This Year Orders YTD', 'Orders Growth%',
    'Last Year AOV', 'This Year AOV',
    'Projected from Business Team',
  ];

  const summaryRows = [];
  for (const g of groups.values()) {
    const drr       = daysSoFar > 0 ? g.mtdGross / daysSoFar : 0;
    const projected = drr * daysTotal;
    const mtdAov    = g.mtdOrders  > 0 ? g.mtdGross / g.mtdOrders  : 0;
    const ytdAov    = g.ytdOrders  > 0 ? g.ytdGross / g.ytdOrders  : 0;
    const lyAov     = g.lyOrders   > 0 ? g.lyGross  / g.lyOrders   : 0;
    const delta     = projected - (isNaN(g.aopGross) ? 0 : g.aopGross);

    summaryRows.push([
      g.leader, g.cat,
      fmt(g.aopGross), fmt(g.aopNet),
      fmt(g.mtdGross), fmt(g.mtdNet), pct(g.mtdGross, g.aopGross),
      fmt(projected), pct(projected, g.aopGross), fmt(delta),
      fmt(g.aopOrders, 0), fmt(g.mtdOrders, 0), pct(g.mtdOrders, g.aopOrders),
      fmt(g.aopAov, 0), fmt(mtdAov, 0),
      fmt(g.d2), fmt(g.d1), fmt(g.d0), fmt(drr, 2),
      fmt(g.aopYtdGross), fmt(g.ytdGross), pct(g.ytdGross, g.aopYtdGross),
      fmt(g.aopYtdOrders, 0), fmt(g.ytdOrders, 0), pct(g.ytdOrders, g.aopYtdOrders),
      fmt(g.aopAov, 0), fmt(ytdAov, 0),
      fmt(g.lyGross), fmt(g.ytdGross), grow(g.ytdGross, g.lyGross),
      fmt(g.lyOrders, 0), fmt(g.ytdOrders, 0), grow(g.ytdOrders, g.lyOrders),
      fmt(lyAov, 0), fmt(ytdAov, 0),
      fmt(g.bizProj),
    ]);
  }

  return { headers: summaryHeaders, rows: summaryRows };
}

/* ── Five-sheet PW computation engine (formula-accurate) ─ */
function computeSummaryFromFiveSheets() {
  // ── Precise translation of the Excel summary formulas ───
  const ws = wizardState;
  const { sources: s, period } = ws;

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mDate = period.month ? new Date(period.month + '-01') : new Date();
  const MON_SHORT = period.monthShort || MON[mDate.getMonth()]; // e.g. "Jun"

  // Fiscal Year boundaries (Indian FY: Apr 1 �' Mar 31)
  const fyStartYear = mDate.getMonth() >= 3 ? mDate.getFullYear() : mDate.getFullYear() - 1;
  const fyStart  = new Date(fyStartYear, 3, 1);         // Apr 1 current FY
  const lyStart  = new Date(fyStartYear - 1, 3, 1);     // Apr 1 last FY
  const today    = new Date(); today.setHours(0,0,0,0); // today 00:00
  // TillMay must be < current month start to avoid double-counting with DOD
  const curMonthStart = new Date(mDate.getFullYear(), mDate.getMonth(), 1);

  // ── Date parsing (handles ISO "2026-06-01", "01-Jun-2026", month strings) ──
  const parseD = v => {
    if (!v) return null;
    const s2 = String(v).trim();
    // ISO
    let d = new Date(s2);
    if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
    // DD-Mon-YYYY
    const m2 = s2.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
    if (m2) { d = new Date(`${m2[2]} ${m2[1]} ${m2[3]}`); d.setHours(0,0,0,0); return d; }
    // Month-Year like "Apr-2026" or "Apr 2026"
    const m3 = s2.match(/([A-Za-z]{3})[-\s](\d{4})/);
    if (m3) { d = new Date(`${m3[1]} 1 ${m3[2]}`); d.setHours(0,0,0,0); return d; }
    return null;
  };

  // ── Header finder ──────────────────────────────────────
  const findH = (headers, ...terms) =>
    headers.findIndex(h => terms.some(t => h.toLowerCase().trim() === t.toLowerCase().trim() ||
                                           h.toLowerCase().includes(t.toLowerCase())));

  // ── Number parser (handles commas, "Cr" suffix etc.) ──
  const pNum = v => parseFloat(String(v||'0').replace(/,/g,'').replace(/\s*cr\b/gi,'').trim()) || 0;

  // ── Month column finder (handles "Jun Orders", "Jun-26 Orders", "June Orders") ──
  const findMonthCol = (headers, mon, kind) => {
    // Exact: "Jun Orders" / "Jun Collection"
    let i = findH(headers, `${mon} ${kind}`);
    if (i >= 0) return i;
    // Starts with month + contains kind: "Jun-26 Orders", "Jun 2026 Collection"
    i = headers.findIndex(h => {
      const low = h.toLowerCase();
      return low.startsWith(mon.toLowerCase()) && low.includes(kind.toLowerCase());
    });
    if (i >= 0) return i;
    // Full month name: "June Orders", "June Collection"
    try {
      const fullMon = new Date(`${mon} 1 2000`).toLocaleString('en-US', { month: 'long' }).toLowerCase();
      i = headers.findIndex(h => {
        const low = h.toLowerCase();
        return low.includes(fullMon) && low.includes(kind.toLowerCase());
      });
    } catch {}
    return i >= 0 ? i : -1;
  };

  // ── TARGETS VERTICAL FORMAT columns ───────────────────
  const tH = s.targets.headers;
  const tExamI    = findH(tH, 'Updated Exam', 'updated_exam');
  const tLeaderI  = findH(tH, 'Leader');
  const tTypeI    = findH(tH, 'Type');
  // Dynamic month columns — use same flexible matching as AC-Target
  const tMonOrdI  = findMonthCol(tH, MON_SHORT, 'Orders');
  const tMonColI  = findMonthCol(tH, MON_SHORT, 'Collection');
  const tFyOrdI   = findH(tH, 'FY YTD Orders', 'FY YTD Order');
  const tAyOrdI   = findH(tH, 'AY YTD Orders', 'AY YTD Order');
  const tFyColI   = findH(tH, 'FY YTD Collection', 'FY YTD Coll');
  const tAyColI   = findH(tH, 'AY YTD Collection', 'AY YTD Coll');

  // ── AC-TARGET columns ──────────────────────────────────
  const acH = s.acTarget.connected ? s.acTarget.headers : [];
  const acExamI   = findH(acH, 'Updated Category', 'Updated Exam', 'updated_category');
  const acMonOrdI = findMonthCol(acH, MON_SHORT, 'Orders');
  const acMonColI = findMonthCol(acH, MON_SHORT, 'Collection');
  const acYtdOrdI = findH(acH, 'YTD Orders');
  const acYtdColI = findH(acH, 'YTD Collection');

  // ── DOD ACHIEVED DATA columns (formula: B=exam, C=date, F=orders, G=collection) ──
  // Schema: batch(A), exam(B), [possibly date(C)], ..., total_orders_fy27(F), collection_fy27(G)
  const dodH = s.dod.connected ? s.dod.headers : [];
  // Exam: try "Updated_exam for test series" first (best match for "Updated Exam"),
  //       then "exam", then fallback to column B (index 1)
  const dodExamI  = (() => {
    const byUpdated = findH(dodH, 'Updated_exam for test series', 'Updated Exam', 'updated_exam');
    if (byUpdated >= 0) return byUpdated;
    const byExam = findH(dodH, 'exam');
    return byExam >= 0 ? byExam : 1;
  })();
  // Date: look for date-like header, fallback to column C (index 2)
  const dodDateI  = (() => {
    const i = dodH.findIndex(h => {
      const low = h.toLowerCase().trim();
      return low === 'date' || low === 'converted_date' || low.endsWith('_date') ||
             low.includes('date') && !low.startsWith('up');
    });
    return i >= 0 ? i : 2;
  })();
  // Orders: look by name, fallback to column F (index 5)
  const dodOrdI = (() => {
    const i = findH(dodH, 'total_orders_fy27', 'orders_fy27', 'total_orders', 'orders');
    return i >= 0 ? i : 5;
  })();
  // Collection: look by name, fallback to column G (index 6)
  const dodColI = (() => {
    const i = findH(dodH, 'collection_fy27', 'collection_fy', 'total_collection', 'collection');
    return i >= 0 ? i : 6;
  })();

  // ── TILL MAY ACHIEVED columns (B=Updated Exam, C=converted_date, F=orders, G=collection) ──
  // Same schema as DOD but WITH Leader + date columns
  const tmH = s.tillMay.headers;
  // Exam: "Updated Exam" (col B=1). Also try "Updated_exam for test series" as fallback
  const tmExamI = (() => {
    const i = findH(tmH, 'Updated Exam', 'updated_exam');
    if (i >= 0) return i;
    const j = findH(tmH, 'Updated_exam for test series', 'updated_exam for');
    return j >= 0 ? j : 1;  // fallback to col B
  })();
  // Date: "converted_date" (col C=2)
  const tmDateI = (() => {
    const i = tmH.findIndex(h => {
      const low = h.toLowerCase().trim();
      return low === 'converted_date' || low === 'date' || low.endsWith('_date') ||
             (low.includes('date') && !low.startsWith('up'));
    });
    return i >= 0 ? i : 2;  // fallback to col C
  })();
  const tmOrdI  = (() => {
    const i = findH(tmH, 'total_orders_fy27', 'orders_fy27', 'total_orders', 'orders');
    return i >= 0 ? i : 5;  // fallback to col F
  })();
  const tmColI  = (() => {
    const i = findH(tmH, 'collection_fy27', 'collection_fy', 'total_collection', 'collection');
    return i >= 0 ? i : 6;  // fallback to col G
  })();

  // ── LAST YEAR NUMBERS columns (B=Updated Exam, C=month_year, F=orders, G=collection) ──
  const lyH = s.lastYear.connected ? s.lastYear.headers : [];
  const lyExamI = findH(lyH, 'Updated Exam', 'updated_exam');
  const lyDateI = findH(lyH, 'month_year', 'converted_date', 'date');
  const lyOrdI  = findH(lyH, 'total_orders_fy26', 'orders_fy26', 'total_orders');
  const lyColI  = findH(lyH, 'total_collection_fy26', 'collection_fy26', 'total_collection');

  // ── SCALE: Targets collection ÷ CRORE = Crores; DOD/TillMay/LY already in Crores ──
  const CRORE = 10_000_000;

  // ── Pre-aggregate all source data by exam ────────────────
  // Mirrors Excel SUMIFS logic exactly

  const agAop = {};  // exam �' { monOrd, monCol(Cr), ytdOrd, ytdCol(Cr) }
  const agDod = {};  // exam �' { ord, col(Cr) }  — formula: date < TODAY()
  const agTm  = {};  // exam �' { ord, col(Cr) }  — formula: date >= DATE(FY,4,1)
  const agLy  = {};  // exam �' { ord, col(Cr) }  — formula: date >= DATE(LY,4,1)
  const dodByDate = {}; // exam �' { "YYYY-MM-DD" �' { ord, col(Cr) } }

  const addTo = (map, exam, ord, col) => {
    if (!exam) return;
    if (!map[exam]) map[exam] = { ord: 0, col: 0 };
    map[exam].ord += ord;
    map[exam].col += col;
  };

  // ISO date key for internal use
  const isoKey = d => d
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    : '';

  // Display format matching reference: "1-Jun-2026"
  const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDateLabel = d => d ? `${d.getDate()}-${MON3[d.getMonth()]}-${d.getFullYear()}` : '';

  // 1. Targets Vertical Format �' AOP month + YTD (collection ÷ CRORE �' Crores)
  for (const row of s.targets.rows) {
    const exam = tExamI >= 0 ? String(row[tExamI]||'').trim() : '';
    if (!exam) continue;
    if (!agAop[exam]) agAop[exam] = { monOrd:0, monCol:0, ytdOrd:0, ytdCol:0 };
    if (tMonOrdI >= 0) agAop[exam].monOrd += pNum(row[tMonOrdI]);
    if (tMonColI >= 0) agAop[exam].monCol += pNum(row[tMonColI]) / CRORE; // ÷10^7
    if (tFyOrdI  >= 0) agAop[exam].ytdOrd += pNum(row[tFyOrdI]);
    if (tFyColI  >= 0) agAop[exam].ytdCol += pNum(row[tFyColI]) / CRORE;
  }

  // 2. AC-Target �' additional AOP (collection ÷ CRORE)
  if (s.acTarget.connected) {
    for (const row of s.acTarget.rows) {
      const exam = acExamI >= 0 ? String(row[acExamI]||'').trim() : '';
      if (!exam) continue;
      if (!agAop[exam]) agAop[exam] = { monOrd:0, monCol:0, ytdOrd:0, ytdCol:0 };
      if (acMonOrdI >= 0) agAop[exam].monOrd += pNum(row[acMonOrdI]);
      if (acMonColI >= 0) agAop[exam].monCol += pNum(row[acMonColI]) / CRORE;
      if (acYtdOrdI >= 0) agAop[exam].ytdOrd += pNum(row[acYtdOrdI]);
      if (acYtdColI >= 0) agAop[exam].ytdCol += pNum(row[acYtdColI]) / CRORE;
    }
  }

  // 3. DOD Achieved Data �' MTD (filter: date < TODAY); already in Crores
  if (s.dod.connected) {
    for (const row of s.dod.rows) {
      const exam    = String(row[dodExamI]||'').trim();
      const dateStr = String(row[dodDateI]||'');
      const d = parseD(dateStr);
      if (!exam || !d || d >= today) continue;
      const ord  = pNum(row[dodOrdI]);
      const col  = pNum(row[dodColI]);
      addTo(agDod, exam, ord, col);
      // Track per-date for last-3 days columns
      const dk = isoKey(d);
      if (!dodByDate[exam]) dodByDate[exam] = {};
      if (!dodByDate[exam][dk]) dodByDate[exam][dk] = { ord:0, col:0 };
      dodByDate[exam][dk].ord += ord;
      dodByDate[exam][dk].col += col;
    }
  }

  // 4. Till May Achieved �' YTD historical (filter: date >= FY start = April 1)
  //    Also used as DOD fallback if DOD sheet not connected
  for (const row of s.tillMay.rows) {
    const exam    = tmExamI >= 0 ? String(row[tmExamI]||'').trim() : '';
    const dateStr = String(row[tmDateI]||'');
    const d = parseD(dateStr);
    if (!exam || !d) continue;
    const ord = pNum(row[tmOrdI]);
    const col = pNum(row[tmColI]);
    // TillMay = FY historical BEFORE current month (DOD handles current month)
    // This prevents double-counting: if TillMay has June data AND DOD has June data
    if (d >= fyStart && d < curMonthStart) addTo(agTm, exam, ord, col);

    // Fallback: if DOD not connected, use TillMay as the "DOD" source too
    if (!s.dod.connected && d < today) {
      addTo(agDod, exam, ord, col);
      const dk = isoKey(d);
      if (!dodByDate[exam]) dodByDate[exam] = {};
      if (!dodByDate[exam][dk]) dodByDate[exam][dk] = { ord:0, col:0 };
      dodByDate[exam][dk].ord += ord;
      dodByDate[exam][dk].col += col;
    }
  }

  // 5. Last Year Numbers �' LY YTD (filter: date >= last FY April 1)
  if (s.lastYear.connected) {
    for (const row of s.lastYear.rows) {
      const exam    = lyExamI >= 0 ? String(row[lyExamI]||'').trim() : '';
      const dateStr = String(row[lyDateI]||'');
      const d = parseD(dateStr);
      if (!exam) continue;
      const ord = pNum(row[lyOrdI]);
      const col = pNum(row[lyColI]);
      if (!d || d >= lyStart) addTo(agLy, exam, ord, col);
    }
  }

  // ── Global last-3 DOD dates (for column headers & per-exam lookup) ──
  const allDodDates = new Set();
  const srcRows = s.dod.connected ? s.dod.rows : s.tillMay.rows;
  const srcDateI = s.dod.connected ? dodDateI : tmDateI;
  for (const row of srcRows) {
    const d = parseD(String(row[srcDateI]||''));
    if (d && d < today) allDodDates.add(isoKey(d));
  }
  const last3IsoKeys = [...allDodDates].sort().reverse().slice(0, 3);
  const last3Dates   = last3IsoKeys.map(k => parseD(k));
  const last3Labels  = last3Dates.map(fmtDateLabel);   // "1-Jun-2026" etc.

  // DRR: remaining days = daysInMonth �' day(lastDodDate)
  // Formula: =(D4-F4)/(30�'DAY(TODAY()�'1))
  const lastDodDate  = last3Dates[0] || today;
  const daysInMonth  = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
  const dayOfLastDod = lastDodDate.getDate();
  const daysLeft     = Math.max(1, daysInMonth - dayOfLastDod);

  // ── Build output rows ─────────────────────────────────────
  const hasLY = s.lastYear.connected;

  // Helpers matching reference format (plain numbers, no "Cr")
  const f1  = n => n == null || isNaN(n) ? '' : parseFloat(n.toFixed(1));
  const f2  = n => n == null || isNaN(n) ? '' : parseFloat(n.toFixed(2));
  const fi  = n => n == null || isNaN(n) || n === 0 ? '' : Math.round(n).toLocaleString();
  const fiv = n => n == null || isNaN(n) ? '' : Math.round(n).toLocaleString();  // AOV
  const pct = (n, d) => d > 0 ? ((n/d)*100).toFixed(1)+'%' : '';
  const grw = (a, b) => b > 0 ? (((a-b)/b)*100).toFixed(1)+'%' : '';
  const calcAov = (colCr, ord) => ord > 0 ? Math.round((colCr * CRORE) / ord) : null;

  const D0 = last3Labels[0] || 'Day-1';
  const D1 = last3Labels[1] || 'Day-2';
  const D2 = last3Labels[2] || 'Day-3';

  const summaryHeaders = [
    'Check', 'Leader', 'Category',
    'Bizfin AOP - Gross', 'Bizfin AOP - Net',
    'Achieved - Gross', 'Achieved - Net', 'Achieved% MTD',
    `Projected - ${MON_SHORT}`, 'Projected % Bizfin AOP', 'Delta',
    'Bizfin AOP - Orders', 'Achieved Orders', 'Achieved% MTD',
    'Bizfin AOP - AOV', 'Achieved AOV',
    D0, D1, D2, 'DRR', '',
    'Bizfin AOP - YTD Gross', 'Bizfin AOP - YTD Net',
    'Achieved YTD', 'Achieved YTD Net', 'Achieved% YTD',
    'Bizfin AOP - Orders YTD', 'Achieved Orders YTD', 'Achieved% YTD',
    'Bizfin AOP - AOV YTD', 'Achieved AOV YTD', '',
    ...(hasLY ? [
      'Last Year YTD', 'Last Year YTD Net', 'This Year YTD', 'This Year YTD Net', 'Growth%',
      'Last Year YTD', 'This Year YTD', 'Growth%',
      'Last Year YTD', 'This Year YTD', '', '',
    ] : []),
    'Projected from Business Team',
  ];

  const summaryRows = [];

  // Derive exam list from Targets, preserving order, one row per unique exam
  const seenExams = new Set();
  const examList  = [];
  for (const row of s.targets.rows) {
    const exam   = tExamI   >= 0 ? String(row[tExamI]  ||'').trim() : '';
    const leader = tLeaderI >= 0 ? String(row[tLeaderI]||'').trim() : '';
    if (!exam || !leader || seenExams.has(exam)) continue;
    seenExams.add(exam);
    examList.push({ exam, leader, type: tTypeI >= 0 ? String(row[tTypeI]||'').trim() : '' });
  }

  for (const { exam, leader } of examList) {
    const aop = agAop[exam] || { monOrd:0, monCol:0, ytdOrd:0, ytdCol:0 };
    const dod = agDod[exam] || { ord:0, col:0 };
    const tm  = agTm[exam]  || { ord:0, col:0 };
    const ly  = agLy[exam]  || { ord:0, col:0 };
    const db  = dodByDate[exam] || {};

    // MTD AOP (Crores)
    const aopGross = aop.monCol;
    const aopOrd   = aop.monOrd;

    // MTD Achieved = DOD (date < today)  — Crores
    const achGross = dod.col;
    const achOrd   = dod.ord;

    // Last 3 days from DOD
    const d0col = (db[last3IsoKeys[0]] || {}).col || 0;
    const d1col = (db[last3IsoKeys[1]] || {}).col || 0;
    const d2col = (db[last3IsoKeys[2]] || {}).col || 0;

    // DRR = (AOP - Achieved) / remaining days  [=(D4-F4)/(30-DAY(TODAY()-1))]
    const drr = daysLeft > 0 ? (aopGross - achGross) / daysLeft : 0;

    // Projected = Achieved + remaining × AVG(last3)  [=F4+(30-DAY($Q$3))×AVERAGE(Q4,R4,S4)]
    const avg3 = (d0col + d1col + d2col) / 3;
    const proj  = achGross + daysLeft * avg3;

    // AOV = Collection(Cr) × 10^7 / Orders  [=IFERROR(D4*10^7/L4,"")]
    const aovTgt = calcAov(aopGross, aopOrd);
    const aovAch = achOrd > 0 ? calcAov(achGross, achOrd) : null;

    // YTD: DOD (date<today) + TillMay (date>=FY_start)
    const ytdColl = dod.col + tm.col;   // Crores
    const ytdOrd  = dod.ord + tm.ord;
    const aopYtdGross = aop.ytdCol;
    const aopYtdOrd   = aop.ytdOrd;
    const ytdAovTgt = calcAov(aopYtdGross, aopYtdOrd);
    const ytdAovAch = ytdOrd > 0 ? calcAov(ytdColl, ytdOrd) : null;

    // Check value from reference: 1 for main exams, 0 for smaller ones
    // Use AOP size as proxy (> 5 Cr = 1, else 0)
    const check = aopGross >= 5 ? 1 : 0;

    const row = [
      check, leader, exam,
      f1(aopGross) || 0, f1(aopGross / 1.18) || 0,
      achGross > 0 ? f1(achGross) : 0.0,
      achGross > 0 ? f1(achGross / 1.18) : 0.0,
      pct(achGross, aopGross),
      proj > 0 ? f1(proj) : 0.0,
      pct(proj, aopGross),
      f1(proj - aopGross),
      fi(aopOrd) || 0, fi(achOrd) || 0, pct(achOrd, aopOrd),
      aovTgt ? fiv(aovTgt) : '',
      aovAch  ? fiv(aovAch)  : '-',
      f2(d0col) || 0.00, f2(d1col) || 0.00, f2(d2col) || 0.00,
      drr > 0 ? f1(drr) : 0.0, '',
      f1(aopYtdGross) || 0, f1(aopYtdGross / 1.18) || 0,
      ytdColl > 0 ? f1(ytdColl) : 0.0,
      ytdColl > 0 ? f1(ytdColl / 1.18) : 0.0,
      pct(ytdColl, aopYtdGross),
      fi(aopYtdOrd) || 0, fi(ytdOrd) || 0, pct(ytdOrd, aopYtdOrd),
      ytdAovTgt ? fiv(ytdAovTgt) : '', ytdAovAch ? fiv(ytdAovAch) : '', '',
      ...(hasLY ? [
        ly.col > 0 ? f1(ly.col) : 0.0,
        ly.col > 0 ? f1(ly.col / 1.18) : 0.0,
        ytdColl > 0 ? f1(ytdColl) : 0.0,
        ytdColl > 0 ? f1(ytdColl / 1.18) : 0.0,
        grw(ytdColl, ly.col),
        fi(ly.ord) || 0, fi(ytdOrd) || 0, grw(ytdOrd, ly.ord),
        ly.ord > 0 ? fiv(calcAov(ly.col, ly.ord)) : '',
        ytdOrd > 0 ? fiv(ytdAovAch) : '',
        '', '',
      ] : []),
      proj > 0 ? f1(proj) : 0.0,  // =I4 (Projected from Business Team)
    ];
    summaryRows.push(row);
  }

  return { headers: summaryHeaders, rows: summaryRows };
}

function wizardGenerateDashboard_SENTINEL() {} // sentinel — old code removed above


function wizardGenerateDashboard() {
  const err = document.getElementById('wizardError');
  err.textContent = '';

  try {
    // Choose the right engine
    const result = wizardState.mode === 'five'
      ? computeSummaryFromFiveSheets()
      : computeSummaryFromRaw(wizardState);

    if (!result.rows.length) {
      err.textContent = 'No data rows found. Check your sheet connections and period settings.';
      return;
    }

    const txCount = wizardState.mode === 'five'
      ? wizardState.sources.tillMay.rows.length
      : wizardState.sources.raw.rows.length;
    closeBuildWizard();

    // Clear refresh state — this is a computed source, not a live sheet
    wizardState._lastResult = result;
    state.currentSheetInfo = null;
    state.sheetsUrl = '';

    loadData({
      headers: result.headers,
      rows:    result.rows,
      label: wizardState.mode === 'five'
        ? `TVA Summary — ${wizardState.period.monthShort || wizardState.period.month}`
        : `Summary Dashboard — ${wizardState.period.month}`,
    });

    showToast(`Summary built from ${txCount.toLocaleString()} transactions`);
  } catch (e) {
    err.textContent = `Error: ${e.message}`;
  }
}

/* ════════════════════════════════════════════════════════
   ORACLE-STYLE UI FUNCTIONS
   ════════════════════════════════════════════════════════ */

/* ── Live clock ─────────────────────────────────────── */
function startClock() {
  const clockEl = document.getElementById('dpClock');
  if (!clockEl) return;
  const tick = () => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    clockEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ── View mode switching (TVA / TY / LY) ──────────── */
/* Report tabs */
const CRORE = 10000000;

function reportFind(headers, ...terms) {
  return headers.findIndex(h => terms.some(t => String(h).toLowerCase().trim() === t.toLowerCase().trim()));
}
function reportFindLoose(headers, ...terms) {
  return headers.findIndex(h => terms.every(t => String(h).toLowerCase().includes(t.toLowerCase())));
}
function sourceHeaders(key) { return wizardState.sources[key]?.connected ? wizardState.sources[key].headers : []; }
function sourceRows(key) { return wizardState.sources[key]?.connected ? wizardState.sources[key].rows : []; }
function targetTypeIndex(headers) {
  const finance = reportFindLoose(headers, 'finance category');
  return finance >= 0 ? finance : reportFind(headers, 'Type');
}
function isYtdSummary(headers) {
  return reportFind(headers, 'AY/FY') >= 0 && reportFindLoose(headers, 'aop', 'ytd', 'gross') >= 0;
}
function findSummaryCol(headers, terms, exclude = []) {
  return headers.findIndex(h => {
    const low = String(h || '').toLowerCase();
    return terms.every(t => low.includes(t.toLowerCase())) &&
      exclude.every(t => !low.includes(t.toLowerCase()));
  });
}
function findSummaryCols(headers, terms, exclude = []) {
  return headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => {
      const low = String(h || '').toLowerCase();
      return terms.every(t => low.includes(t.toLowerCase())) &&
        exclude.every(t => !low.includes(t.toLowerCase()));
    })
    .map(x => x.i);
}
function findSummaryColAfter(headers, terms, afterIndex, exclude = []) {
  return headers.findIndex((h, i) => {
    if (i <= afterIndex) return false;
    const low = String(h || '').toLowerCase();
    return terms.every(t => low.includes(t.toLowerCase())) &&
      exclude.every(t => !low.includes(t.toLowerCase()));
  });
}
function findPlainYtdCols(headers, label) {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\(\\d+\\))?$`, 'i');
  return headers.map((h, i) => ({ h, i })).filter(({ h }) => re.test(String(h || '').trim())).map(x => x.i);
}
function formatOneDecimal(n) {
  return Number.isFinite(n) ? parseFloat(n.toFixed(1)) : '';
}
function formatWhole(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '';
}
function formatPctValue(num, den) {
  return den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '';
}
function calcAovValue(collCr, orders) {
  return orders > 0 ? Math.round((collCr * CRORE) / orders) : NaN;
}
function buildYtdTargetMap(mode) {
  const map = new Map();
  const add = (exam, grossCr, orders) => {
    const key = String(exam || '').trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, { gross: 0, orders: 0 });
    const item = map.get(key);
    item.gross += Number(grossCr) || 0;
    item.orders += Number(orders) || 0;
  };

  const th = sourceHeaders('targets');
  const examI = reportFindLoose(th, 'updated exam');
  const ordI = mode === 'FY'
    ? reportFindLoose(th, 'fy ytd orders')
    : reportFindLoose(th, 'ay ytd orders');
  const colI = mode === 'FY'
    ? reportFindLoose(th, 'fy ytd collection')
    : reportFindLoose(th, 'ay ytd collection');
  for (const row of sourceRows('targets')) {
    add(row[examI], colI >= 0 ? (toNum(row[colI]) || 0) / CRORE : 0, ordI >= 0 ? toNum(row[ordI]) || 0 : 0);
  }

  const ah = sourceHeaders('acTarget');
  const acExamI = reportFindLoose(ah, 'updated category') >= 0 ? reportFindLoose(ah, 'updated category') : reportFindLoose(ah, 'updated exam');
  const acOrdI = reportFindLoose(ah, 'ytd orders');
  const acColI = reportFindLoose(ah, 'ytd collection');
  for (const row of sourceRows('acTarget')) {
    add(row[acExamI], acColI >= 0 ? (toNum(row[acColI]) || 0) / CRORE : 0, acOrdI >= 0 ? toNum(row[acOrdI]) || 0 : 0);
  }

  return map;
}
function buildComputedFyTargetMap() {
  const computed = state.reportMeta.computed;
  const map = new Map();
  if (!computed?.headers?.length || !computed?.rows?.length) return map;
  const h = computed.headers;
  const examI = reportFind(h, 'Category');
  const grossI = findSummaryCol(h, ['aop', 'ytd', 'gross']);
  const ordersI = findSummaryCol(h, ['aop', 'orders', 'ytd']);
  for (const row of computed.rows) {
    const exam = String(row[examI] || '').trim();
    if (!exam) continue;
    map.set(exam, {
      gross: grossI >= 0 ? toNum(row[grossI]) || 0 : 0,
      orders: ordersI >= 0 ? toNum(row[ordersI]) || 0 : 0,
    });
  }
  return map;
}
function applyYtdModeToSummary(summary, mode = 'AY') {
  if (!summary || !summary.headers || mode === 'AY' || !isYtdSummary(summary.headers)) {
    return {
      headers: summary.headers,
      rows: summary.rows.map(r => [...r]),
      totalRow: summary.totalRow ? [...summary.totalRow] : null,
    };
  }

  const headers = summary.headers;
  const computedMap = mode === 'FY' ? buildComputedFyTargetMap() : new Map();
  const targetMap = computedMap.size ? computedMap : buildYtdTargetMap(mode);
  const idx = {
    exam: reportFind(headers, 'Category'),
    basis: reportFind(headers, 'AY/FY'),
    aopYtdGross: findSummaryCol(headers, ['aop', 'ytd', 'gross']),
    aopYtdNet: findSummaryCol(headers, ['aop', 'ytd', 'net']),
    achievedYtdGross: findSummaryCol(headers, ['achieved', 'ytd', 'gross']),
    achievedYtdNet: findSummaryCol(headers, ['achieved', 'ytd', 'net']),
    aopOrdersYtd: findSummaryColAfter(headers, ['aop', 'orders'], reportFind(headers, 'AY/FY'), ['mtd']),
    achievedOrdersYtd: findSummaryColAfter(headers, ['achieved', 'orders'], reportFind(headers, 'AY/FY'), ['mtd']),
    aopAovYtd: findSummaryColAfter(headers, ['aop', 'aov'], reportFind(headers, 'AY/FY')),
    achievedAovYtd: findSummaryColAfter(headers, ['achieved', 'aov'], reportFind(headers, 'AY/FY')),
    tyGross: findSummaryCol(headers, ['this year', 'ytd', 'gross']),
    tyNet: findSummaryCol(headers, ['this year', 'ytd', 'net']),
    growthColl: findSummaryCols(headers, ['growth%'])[0] ?? -1,
    tyOrders: findPlainYtdCols(headers, 'This Year YTD')[0] ?? -1,
    growthOrders: findSummaryCols(headers, ['growth%'])[1] ?? -1,
    tyAov: findPlainYtdCols(headers, 'This Year YTD')[1] ?? -1,
  };
  const pctCols = findSummaryCols(headers, ['achieved%', 'ytd']);
  idx.achPctYtdColl = pctCols[0] ?? -1;
  idx.achPctYtdOrders = pctCols[1] ?? -1;

  const set = (row, i, value) => { if (i >= 0) row[i] = value; };
  const transformRow = rawRow => {
    const row = [...rawRow];
    const exam = String(row[idx.exam] || '').trim();
    const target = targetMap.get(exam);
    if (!target) {
      set(row, idx.basis, mode);
      return row;
    }
    const gross = target.gross;
    const orders = target.orders;
    const net = gross / 1.18;
    const achievedGross = toNum(row[idx.achievedYtdGross]) || 0;
    const achievedNet = toNum(row[idx.achievedYtdNet]) || (achievedGross ? achievedGross / 1.18 : 0);
    const achievedOrders = toNum(row[idx.achievedOrdersYtd]) || 0;
    const targetAov = calcAovValue(gross, orders);
    const achievedAov = calcAovValue(achievedGross, achievedOrders);

    set(row, idx.basis, mode);
    set(row, idx.aopYtdGross, formatOneDecimal(gross) || 0);
    set(row, idx.aopYtdNet, formatOneDecimal(net) || 0);
    set(row, idx.achPctYtdColl, formatPctValue(achievedGross, gross));
    set(row, idx.aopOrdersYtd, formatWhole(orders) || 0);
    set(row, idx.achPctYtdOrders, formatPctValue(achievedOrders, orders));
    set(row, idx.aopAovYtd, Number.isFinite(targetAov) ? formatWhole(targetAov) : '');
    set(row, idx.achievedAovYtd, Number.isFinite(achievedAov) ? formatWhole(achievedAov) : row[idx.achievedAovYtd]);
    set(row, idx.tyGross, achievedGross > 0 ? formatOneDecimal(achievedGross) : 0);
    set(row, idx.tyNet, achievedNet > 0 ? formatOneDecimal(achievedNet) : 0);
    set(row, idx.tyOrders, achievedOrders > 0 ? formatWhole(achievedOrders) : 0);
    set(row, idx.tyAov, Number.isFinite(achievedAov) ? formatWhole(achievedAov) : row[idx.tyAov]);

    const lyGross = toNum(row[findSummaryCol(headers, ['last year', 'ytd', 'gross'])]) || 0;
    const lyOrders = toNum(row[findPlainYtdCols(headers, 'Last Year YTD')[0] ?? -1]) || 0;
    set(row, idx.growthColl, lyGross > 0 ? `${(((achievedGross - lyGross) / lyGross) * 100).toFixed(1)}%` : '');
    set(row, idx.growthOrders, lyOrders > 0 ? `${(((achievedOrders - lyOrders) / lyOrders) * 100).toFixed(1)}%` : '');
    return row;
  };

  const rows = summary.rows.map(transformRow);
  const totalRow = summary.totalRow ? [...summary.totalRow] : null;
  if (totalRow) {
    const sum = i => i >= 0 ? rows.reduce((s, r) => s + (toNum(r[i]) || 0), 0) : 0;
    const aopGross = sum(idx.aopYtdGross);
    const aopOrders = sum(idx.aopOrdersYtd);
    const achievedGross = sum(idx.achievedYtdGross);
    const achievedOrders = sum(idx.achievedOrdersYtd);
    const targetAov = calcAovValue(aopGross, aopOrders);
    const achievedAov = calcAovValue(achievedGross, achievedOrders);
    set(totalRow, idx.basis, mode);
    set(totalRow, idx.aopYtdGross, formatOneDecimal(aopGross) || 0);
    set(totalRow, idx.aopYtdNet, formatOneDecimal(aopGross / 1.18) || 0);
    set(totalRow, idx.achPctYtdColl, formatPctValue(achievedGross, aopGross));
    set(totalRow, idx.aopOrdersYtd, formatWhole(aopOrders) || 0);
    set(totalRow, idx.achPctYtdOrders, formatPctValue(achievedOrders, aopOrders));
    set(totalRow, idx.aopAovYtd, Number.isFinite(targetAov) ? formatWhole(targetAov) : '');
    set(totalRow, idx.achievedAovYtd, Number.isFinite(achievedAov) ? formatWhole(achievedAov) : '');
    set(totalRow, idx.tyGross, formatOneDecimal(achievedGross) || 0);
    set(totalRow, idx.tyNet, formatOneDecimal(achievedGross / 1.18) || 0);
    set(totalRow, idx.tyOrders, formatWhole(achievedOrders) || 0);
    set(totalRow, idx.tyAov, Number.isFinite(achievedAov) ? formatWhole(achievedAov) : '');
  }
  return { headers, rows, totalRow };
}
function applyYtdModeSelection(mode) {
  state.ytdMode = mode === 'FY' ? 'FY' : 'AY';
  const select = document.getElementById('ytdModeSelect');
  if (select) select.value = state.ytdMode;
  const raw = state.reportMeta.rawSummary;
  if (!raw) return;
  const adjusted = applyYtdModeToSummary(raw, state.ytdMode);
  state.headers = adjusted.headers;
  state.allRows = adjusted.rows;
  state.colTypes = detectTypes(adjusted.headers, adjusted.rows);
  state.reportMeta.totalRow = adjusted.totalRow;
  state.page = 0;
  initMetricSelector();
  initFilterPanel();
  renderOracleKPIs();
  renderCharts();
  applyFilter();
  const activeTab = document.querySelector('.dp-subtab.active');
  if (activeTab?.dataset.subtab === 'overview') renderActiveReport();
  updateSidebarInfo();
}
function updateYtdModeControl() {
  const wrap = document.getElementById('ytdModeWrap');
  const select = document.getElementById('ytdModeSelect');
  if (!wrap || !select) return;
  const visible = state.sourceMode === 'auto-summary' && isYtdSummary(state.headers);
  wrap.style.display = visible ? 'inline-flex' : 'none';
  select.value = state.ytdMode || 'AY';
}
function parseReportDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  const m = s.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (m) {
    d = new Date(`${m[2]} ${m[1]} ${m[3]}`);
    if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  }
  return null;
}
function moneyCr(n, dec = 1) {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? `${v.toFixed(dec)} Cr` : '0';
}
function shortOrders(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '0';
  if (v >= 100000) return `${(v / 100000).toFixed(1)} L`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return Math.round(v).toLocaleString();
}
function rupee(n) {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? `₹${Math.round(v).toLocaleString()}` : '-';
}
function pctText(n, d) { return d > 0 ? `${(n / d * 100).toFixed(1)}%` : '-'; }
function pctClassValue(p) {
  if (!Number.isFinite(p)) return '';
  if (p >= 100) return 'ach-green';
  if (p >= 80) return 'ach-amber';
  if (p >= 60) return 'ach-purple';
  return 'ach-red';
}
function compactChartValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  if (n >= 100) return Math.round(n).toString();
  return n.toFixed(n >= 10 ? 0 : 1);
}
function chartValueLabelPlugin({ spikesOnly = false } = {}) {
  return {
    id: spikesOnly ? 'spikeValueLabels' : 'barValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = '800 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        const data = dataset.data || [];
        const labelIndexes = new Set();
        if (spikesOnly) {
          const sorted = data.map((v, i) => ({ v: Number(v) || 0, i })).sort((a, b) => b.v - a.v);
          sorted.slice(0, 5).forEach(x => labelIndexes.add(x.i));
          for (let i = 1; i < data.length - 1; i++) {
            const prev = Number(data[i - 1]) || 0, cur = Number(data[i]) || 0, next = Number(data[i + 1]) || 0;
            if ((cur > prev * 1.35 && cur > next * 1.35) || (cur < prev * 0.65 && cur < next * 0.65)) labelIndexes.add(i);
          }
        }
        meta.data.forEach((el, i) => {
          if (spikesOnly && !labelIndexes.has(i)) return;
          const value = compactChartValue(data[i]);
          if (!value) return;
          const pos = el.tooltipPosition();
          ctx.fillStyle = dataset.borderColor || dataset.backgroundColor || '#111827';
          const y = chart.config.type === 'line' ? pos.y - 12 : pos.y - 10;
          ctx.fillText(value, pos.x, y);
        });
      });
      ctx.restore();
    },
  };
}
function reportHeaderGroup(header) {
  const low = String(header || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  if (/aov|avg\s*ticket|ticket\s*size/.test(low)) return 'AOV';
  if (/orders?|ord\b/.test(low)) return 'Orders';
  if (/coll|collection|gross|net|revenue|delta|gap|short|drr|projected/.test(low)) return 'Collections';
  if (/last\s*year|this\s*year|\bly\b|\bty\b|yoy|growth/.test(low)) return 'YoY';
  if (/type\s*mix|mix|share/.test(low)) return 'Mix';
  if (/trend|date|day|peak|average|avg\s*daily|last\s*7|last\s*90/.test(low)) return 'Trend';
  if (/target|achieved|achievement|%/.test(low)) return 'Performance';
  return 'Details';
}
function buildGroupedThead(headers, renderSubHeader) {
  const groups = headers.map(reportHeaderGroup);
  const groupCells = [];
  for (let i = 0; i < headers.length;) {
    const group = groups[i] || 'Details';
    let span = 1;
    while (i + span < headers.length && groups[i + span] === group) span++;
    const sticky = i === 0 ? ' sticky-col' : i === 1 ? ' sticky-col-2' : '';
    const sep = group !== 'Details' ? ' sep-left' : '';
    groupCells.push(`<th class="report-group-cell${sticky}${sep}" colspan="${span}">${esc(group)}</th>`);
    i += span;
  }
  return `<tr class="report-group-row">${groupCells.join('')}</tr><tr class="report-sub-row">${headers.map(renderSubHeader).join('')}</tr>`;
}
function tableSectionClass(headers, i) {
  if (i <= 0) return '';
  return reportHeaderGroup(headers[i]) !== reportHeaderGroup(headers[i - 1]) ? 'sep-left' : '';
}
function reportTable(headers, rows) {
  const clsFor = (h, i) => {
    const low = String(h).toLowerCase();
    const classes = [];
    if (i === 0) classes.push('sticky-col');
    if (i === 1) classes.push('sticky-col-2');
    const sectionClass = tableSectionClass(headers, i);
    if (sectionClass) classes.push(sectionClass);
    if (/%|growth|achievement/.test(low)) classes.push('sep-soft');
    return classes.join(' ');
  };
  return `<div class="dp-tva-table-wrap"><table class="dp-tva-table"><thead>${buildGroupedThead(headers, (h, i) => `<th class="${clsFor(h, i)}">${esc(h)}</th>`)}</thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${clsFor(headers[i] || '', i)}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function reportShell(title, subtitle, body) {
  const el = document.getElementById('reportContent');
  if (!el) return;
  el.innerHTML = `<section class="report-section"><div class="report-title">${title}</div><div class="report-subtitle">${esc(subtitle || '')}</div>${body}</section>`;
}
function summaryIndices() {
  const h = state.headers;
  const mtdAop = kind => h.findIndex(col => {
    const low = String(col).toLowerCase();
    return low.includes('aop') && low.includes(kind) && !low.includes('ytd') && !/\(\d+\)$/.test(low);
  });
  return {
    leader: reportFind(h, 'Leader'),
    exam: reportFind(h, 'Category'),
    tgtColl: mtdAop('gross'),
    achColl: reportFind(h, 'Achieved - Gross'),
    tgtOrd: mtdAop('orders'),
    achOrd: reportFind(h, 'Achieved Orders'),
    tgtAov: mtdAop('aov'),
    achAov: reportFind(h, 'Achieved AOV'),
    lyColl: reportFind(h, 'Last Year YTD Gross'),
    tyColl: reportFind(h, 'This Year YTD Gross'),
    lyOrd: reportFind(h, 'Last Year YTD'),
    tyOrd: reportFind(h, 'This Year YTD'),
    lyAov: reportFind(h, 'Last Year YTD (2)'),
    tyAov: reportFind(h, 'This Year YTD (2)'),
  };
}
function buildSourceLookups() {
  const th = sourceHeaders('targets'), rows = sourceRows('targets');
  const examI = reportFindLoose(th, 'updated exam'), typeI = targetTypeIndex(th), batchI = reportFindLoose(th, 'batch name'), genericI = reportFindLoose(th, 'generic name'), leaderI = reportFind(th, 'Leader');
  const examType = new Map(), batchMeta = new Map();
  for (const row of rows) {
    const exam = String(row[examI] || '').trim(), type = String(row[typeI] || '').trim(), batch = String(row[batchI] || '').trim(), generic = String(row[genericI] || '').trim(), leader = String(row[leaderI] || '').trim();
    if (exam && type && !examType.has(exam)) examType.set(exam, type);
    if (batch) batchMeta.set(batch.toLowerCase(), { generic: generic || batch, exam, type, leader, batch });
  }
  return { examType, batchMeta };
}

function renderReportTva() {
  const idx = summaryIndices(), total = state.reportMeta.totalRow || [], pctI = reportFind(state.headers, 'Achieved% MTD');
  const rows = getActiveRows().filter(r => String(r[idx.exam] || '').trim()).sort((a,b)=>(toNum(b[idx.tgtColl])||0)-(toNum(a[idx.tgtColl])||0));
  const tableRows = [
    ['<strong>TOTAL</strong>', '<strong>All</strong>', `<strong>${moneyCr(toNum(total[idx.tgtColl]))}</strong>`, `<strong>${moneyCr(toNum(total[idx.achColl]))}</strong>`, `<strong>${esc(total[pctI] || pctText(toNum(total[idx.achColl]), toNum(total[idx.tgtColl])))}</strong>`, `<strong>${shortOrders(toNum(total[idx.tgtOrd]))}</strong>`, `<strong>${shortOrders(toNum(total[idx.achOrd]))}</strong>`, `<strong>${rupee(toNum(total[idx.tgtAov]))}</strong>`, `<strong>${rupee(toNum(total[idx.achAov]))}</strong>`],
    ...rows.map(r => {
      const p = toNum(r[idx.tgtColl]) > 0 ? toNum(r[idx.achColl]) / toNum(r[idx.tgtColl]) * 100 : NaN;
      return [esc(r[idx.exam]), esc(r[idx.leader]), moneyCr(toNum(r[idx.tgtColl])), moneyCr(toNum(r[idx.achColl])), `<span class="${pctClassValue(p)}">${pctText(toNum(r[idx.achColl]), toNum(r[idx.tgtColl]))}</span>`, shortOrders(toNum(r[idx.tgtOrd])), shortOrders(toNum(r[idx.achOrd])), rupee(toNum(r[idx.tgtAov])), rupee(toNum(r[idx.achAov]))];
    }),
  ];
  reportShell('📊 Targets vs Achievement', 'Exact formula output loaded from the summary tab.', reportTable(['Exam','Leader','Tgt Coll','Achv Coll','% Coll','Tgt Orders','Achv Orders','Tgt AOV','Achv AOV'], tableRows));
}

function monthKeys() {
  const end = new Date(`${AUTO_SUMMARY_CONFIG.period.month}-01`), start = new Date(end.getFullYear(), 3, 1), keys = [];
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) keys.push({ key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label:d.toLocaleString('en-US',{month:'long'}), short:d.toLocaleString('en-US',{month:'short'}) });
  return keys;
}
function buildMonthReport() {
  const th = sourceHeaders('targets'), tTypeI = targetTypeIndex(th), months = monthKeys(), data = new Map();
  const get = (m, type='TOTAL') => { const k = `${m}||${type || '(no type)'}`; if (!data.has(k)) data.set(k, { month:m, type:type || '(no type)', tgtOrd:0, tgtColl:0, achOrd:0, achColl:0 }); return data.get(k); };
  for (const row of sourceRows('targets')) {
    const type = String(row[tTypeI] || '').trim();
    for (const m of months) {
      const ordI = reportFindLoose(th, m.short, 'orders'), collI = reportFindLoose(th, m.short, 'collection');
      const ord = ordI >= 0 ? toNum(row[ordI]) || 0 : 0, coll = collI >= 0 ? (toNum(row[collI]) || 0) / CRORE : 0;
      get(m.label).tgtOrd += ord; get(m.label).tgtColl += coll; get(m.label, type).tgtOrd += ord; get(m.label, type).tgtColl += coll;
    }
  }
  const addAch = (rows, h) => {
    const dateI = reportFind(h, 'converted_date'), typeI = reportFind(h, 'type'), ordI = reportFindLoose(h, 'total_orders'), collI = reportFindLoose(h, 'collection');
    for (const row of rows) {
      const d = parseReportDate(row[dateI]); if (!d) continue;
      const m = months.find(x => x.key === `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); if (!m) continue;
      const type = String(row[typeI] || '').trim(), ord = toNum(row[ordI]) || 0, coll = toNum(row[collI]) || 0;
      get(m.label).achOrd += ord; get(m.label).achColl += coll; get(m.label, type).achOrd += ord; get(m.label, type).achColl += coll;
    }
  };
  addAch(sourceRows('tillMay'), sourceHeaders('tillMay')); addAch(sourceRows('dod'), sourceHeaders('dod'));
  return [...data.values()];
}
function renderReportMonth() {
  const data = buildMonthReport();
  const totalRows = data.filter(x => x.type === 'TOTAL').map(x => {
    const op = x.tgtOrd > 0 ? x.achOrd / x.tgtOrd * 100 : NaN, cp = x.tgtColl > 0 ? x.achColl / x.tgtColl * 100 : NaN;
    return [esc(x.month), shortOrders(x.tgtOrd), shortOrders(x.achOrd), `<span class="${pctClassValue(op)}">${pctText(x.achOrd,x.tgtOrd)}</span>`, moneyCr(x.tgtColl), moneyCr(x.achColl), `<span class="${pctClassValue(cp)}">${pctText(x.achColl,x.tgtColl)}</span>`];
  });
  const typeRows = data.filter(x => x.type !== 'TOTAL' && x.type !== '(no type)' && (x.tgtColl || x.achColl)).sort((a,b)=>a.month.localeCompare(b.month)||b.achColl-a.achColl).map(x => {
    const cp = x.tgtColl > 0 ? x.achColl / x.tgtColl * 100 : NaN;
    return [esc(x.month), esc(x.type), moneyCr(x.tgtColl), moneyCr(x.achColl), `<span class="${pctClassValue(cp)}">${pctText(x.achColl,x.tgtColl)}</span>`, shortOrders(x.tgtOrd), shortOrders(x.achOrd)];
  });
  reportShell('🗓️ Month-wise Target vs Achievement', 'Monthly target and achieved values with type breakdown from source sheets.', `<div class="chart-card chart-card-full"><div class="chart-wrap" style="height:340px"><canvas id="reportChart"></canvas></div></div>` + reportTable(['Month','Tgt Orders','Achv Orders','% Orders','Tgt Coll','Achv Coll','% Coll'], totalRows) + '<div style="height:18px"></div>' + reportTable(['Month','Type','Tgt Coll','Achv Coll','% Coll','Tgt Orders','Achv Orders'], typeRows));
  destroyChart('report');
  const canvas = document.getElementById('reportChart');
  if (canvas) {
    const months = [...new Set(data.map(x => x.month))];
    const typeTotals = data
      .filter(x => x.type !== 'TOTAL' && x.type !== '(no type)')
      .reduce((acc, x) => {
        acc[x.type] = (acc[x.type] || 0) + (Number(x.achColl) || 0);
        return acc;
      }, {});
    const types = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type]) => type);
    state.charts.report = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: months,
        datasets: types.map((type, i) => ({
          label: type,
          data: months.map(month => data.filter(x => x.month === month && x.type === type).reduce((s, x) => s + x.achColl, 0)),
          backgroundColor: ['#7c9ab4','#9677aa','#e7c875','#e17655','#7aa06b'][i % 5],
          stack: 'achieved',
        })),
      },
      options: { ...multiOptions(true), scales: { ...multiOptions(true).scales, x: { ...multiOptions(true).scales.x, stacked: true }, y: { ...multiOptions(true).scales.y, stacked: true } }, layout:{ padding:{ top: 20 } } },
      plugins: [chartValueLabelPlugin()],
    });
  }
}

function renderChartReport(title, subtitle, labels, datasets, tableHeaders, tableRows) {
  reportShell(title, subtitle, `<div class="chart-card chart-card-full"><div class="chart-wrap" style="height:360px"><canvas id="reportChart"></canvas></div></div>${reportTable(tableHeaders, tableRows)}`);
  destroyChart('report');
  const canvas = document.getElementById('reportChart');
  if (canvas) state.charts.report = new Chart(canvas.getContext('2d'), { type:'bar', data:{ labels, datasets }, options:{ ...multiOptions(true), layout:{ padding:{ top: 24 } } }, plugins:[chartValueLabelPlugin()] });
}
function renderReportLyTy() {
  const idx = summaryIndices(), rows = getActiveRows().sort((a,b)=>(toNum(b[idx.tgtColl])||0)-(toNum(a[idx.tgtColl])||0)).slice(0,10);
  const labels = rows.map(r => String(r[idx.exam]).slice(0,22)), ly = rows.map(r => toNum(r[idx.lyColl]) || 0), ty = rows.map(r => toNum(r[idx.tyColl]) || 0);
  renderChartReport('📈 LY vs TY Growth', 'Top exams by target, comparing last-year and this-year YTD collection.', labels, [{label:'Last Year (Cr)',data:ly,backgroundColor:'#7c9ab4'},{label:'This Year (Cr)',data:ty,backgroundColor:'#e17655'}], ['Exam','Last Year','This Year','Growth'], rows.map((r,i)=>[esc(r[idx.exam]), moneyCr(ly[i]), moneyCr(ty[i]), pctText(ty[i]-ly[i], ly[i])]));
}
function renderReportAov() {
  const idx = summaryIndices(), rows = getActiveRows().sort((a,b)=>(toNum(b[idx.tgtColl])||0)-(toNum(a[idx.tgtColl])||0)).slice(0,10);
  const labels = rows.map(r => String(r[idx.exam]).slice(0,22)), tgt = rows.map(r=>toNum(r[idx.tgtAov])||0), ach = rows.map(r=>toNum(r[idx.achAov])||0), ly = rows.map(r=>toNum(r[idx.lyAov])||0);
  renderChartReport('💎 AOV Analysis', 'Target vs achieved AOV with last-year AOV overlay.', labels, [{label:'Target AOV',data:tgt,backgroundColor:'#a99155'},{label:'Achieved AOV',data:ach,backgroundColor:'#e17655'},{label:'LY AOV',data:ly,backgroundColor:'#7c9ab4'}], ['Exam','Target AOV','Achieved AOV','AOV%','LY AOV'], rows.map((r,i)=>[esc(r[idx.exam]), rupee(tgt[i]), rupee(ach[i]), `<span class="${pctClassValue(ach[i]/tgt[i]*100)}">${pctText(ach[i],tgt[i])}</span>`, rupee(ly[i])]));
}
function groupedByType() {
  const idx = summaryIndices(), { examType } = buildSourceLookups(), groups = new Map();
  const get = type => { const k = type || '(no type)'; if (!groups.has(k)) groups.set(k, { type:k, tgtColl:0, achColl:0, tgtOrd:0, achOrd:0, lyColl:0, lyOrd:0 }); return groups.get(k); };
  for (const r of getActiveRows()) {
    const g = get(examType.get(String(r[idx.exam] || '').trim()) || '(no type)');
    g.tgtColl += toNum(r[idx.tgtColl]) || 0; g.achColl += toNum(r[idx.achColl]) || 0; g.tgtOrd += toNum(r[idx.tgtOrd]) || 0; g.achOrd += toNum(r[idx.achOrd]) || 0; g.lyColl += toNum(r[idx.lyColl]) || 0; g.lyOrd += toNum(r[idx.lyOrd]) || 0;
  }
  return [...groups.values()].filter(g => g.type !== '(no type)' || g.achColl || g.tgtColl).sort((a,b)=>b.achColl-a.achColl);
}
function renderReportTypeAov() {
  const rows = groupedByType();
  reportShell('🏷️ Type-wise AOV', 'Type-level target, achieved, and LY AOV derived from exact summary rows.', reportTable(['Type','Target AOV','Achieved AOV','AOV%','LY AOV','Tgt Orders','Tgt Coll','Achv Orders','Achv Coll'], rows.map(g => {
    const tgtAov = g.tgtOrd ? g.tgtColl*CRORE/g.tgtOrd : 0, achAov = g.achOrd ? g.achColl*CRORE/g.achOrd : 0, lyAov = g.lyOrd ? g.lyColl*CRORE/g.lyOrd : 0;
    return [esc(g.type), rupee(tgtAov), rupee(achAov), `<span class="${pctClassValue(achAov/tgtAov*100)}">${pctText(achAov,tgtAov)}</span>`, rupee(lyAov), shortOrders(g.tgtOrd), moneyCr(g.tgtColl), shortOrders(g.achOrd), moneyCr(g.achColl)];
  })));
}
function buildBatchGenericRows(mode) {
  const { batchMeta } = buildSourceLookups(), th = sourceHeaders('targets'), tgtOrdI = reportFindLoose(th, AUTO_SUMMARY_CONFIG.period.monthShort, 'orders'), tgtCollI = reportFindLoose(th, AUTO_SUMMARY_CONFIG.period.monthShort, 'collection');
  const batchI = reportFindLoose(th, 'batch name'), genericI = reportFindLoose(th, 'generic name'), examI = reportFindLoose(th, 'updated exam'), typeI = targetTypeIndex(th), map = new Map();
  const get = (key, meta={}) => { if (!map.has(key)) map.set(key, { name:key, generic:meta.generic||key, batch:meta.batch||key, exam:meta.exam||'', type:meta.type||'', tgtOrd:0, tgtColl:0, achOrd:0, achColl:0 }); return map.get(key); };
  for (const row of sourceRows('targets')) {
    const batch = String(row[batchI] || '').trim(), generic = String(row[genericI] || '').trim() || batch, key = mode === 'generic' ? generic : batch;
    const g = get(key, { generic, batch, exam:String(row[examI]||''), type:String(row[typeI]||'') });
    g.tgtOrd += toNum(row[tgtOrdI]) || 0; g.tgtColl += (toNum(row[tgtCollI]) || 0) / CRORE;
  }
  const addAch = (rows, h) => {
    const batchJ = reportFind(h, 'batch'), examJ = reportFindLoose(h, 'updated exam'), typeJ = reportFind(h, 'type'), ordJ = reportFindLoose(h, 'total_orders'), collJ = reportFindLoose(h, 'collection');
    for (const row of rows) {
      const batch = String(row[batchJ] || '').trim(), meta = batchMeta.get(batch.toLowerCase()) || { generic:batch, batch, exam:String(row[examJ]||''), type:String(row[typeJ]||'') };
      const g = get(mode === 'generic' ? meta.generic : batch, { ...meta, batch });
      g.achOrd += toNum(row[ordJ]) || 0; g.achColl += toNum(row[collJ]) || 0;
    }
  };
  addAch(sourceRows('tillMay'), sourceHeaders('tillMay')); addAch(sourceRows('dod'), sourceHeaders('dod'));
  return [...map.values()].filter(g => g.name && (g.tgtColl || g.achColl)).sort((a,b)=>b.achColl-a.achColl);
}
function renderReportGeneric() {
  const rows = buildBatchGenericRows('generic').slice(0,120);
  reportShell('📖 Generic Name Target vs Achievement', 'Generic names are mapped from target batch data and joined to achieved batch rows.', reportTable(['Generic Name','Type','Exam','Tgt Orders','Tgt Coll','Tgt AOV','Achv Orders','Achv Coll','Achv AOV','% Achv'], rows.map(g => {
    const tgtAov = g.tgtOrd ? g.tgtColl*CRORE/g.tgtOrd : 0, achAov = g.achOrd ? g.achColl*CRORE/g.achOrd : 0;
    return [esc(g.generic), esc(g.type), esc(g.exam), shortOrders(g.tgtOrd), moneyCr(g.tgtColl), rupee(tgtAov), shortOrders(g.achOrd), moneyCr(g.achColl), rupee(achAov), `<span class="${pctClassValue(g.achColl/g.tgtColl*100)}">${pctText(g.achColl,g.tgtColl)}</span>`];
  })));
}
function renderReportBatch() {
  const rows = buildBatchGenericRows('batch').slice(0,200);
  reportShell('📦 Batch-wise AOV', 'Batch-level target AOV and achieved AOV with real source joins.', reportTable(['Batch','Exam','Type','Orders','Revenue','Target AOV','Achieved AOV','Achievement'], rows.map(g => {
    const tgtAov = g.tgtOrd ? g.tgtColl*CRORE/g.tgtOrd : 0, achAov = g.achOrd ? g.achColl*CRORE/g.achOrd : 0;
    return [esc(g.batch), esc(g.exam), esc(g.type), shortOrders(g.achOrd), moneyCr(g.achColl), rupee(tgtAov), rupee(achAov), `<span class="${pctClassValue(achAov/tgtAov*100)}">${pctText(achAov,tgtAov)}</span>`];
  })));
}
function dailySeries() {
  const map = new Map(), add = key => {
    const h = sourceHeaders(key), dateI = reportFind(h, 'converted_date'), ordI = reportFindLoose(h, 'total_orders'), collI = reportFindLoose(h, 'collection');
    for (const r of sourceRows(key)) {
      const d = parseReportDate(r[dateI]); if (!d) continue;
      const dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!map.has(dk)) map.set(dk, { date:d, key:dk, ord:0, coll:0 });
      const g = map.get(dk); g.ord += toNum(r[ordI]) || 0; g.coll += toNum(r[collI]) || 0;
    }
  };
  add('tillMay'); add('dod');
  return [...map.values()].sort((a,b)=>a.date-b.date).slice(-90);
}
function renderReportDod() {
  const rows = dailySeries(), labels = rows.map(r => `${String(r.date.getDate()).padStart(2,'0')} ${r.date.toLocaleString('en-US',{month:'short'})}`);
  reportShell('🧮 Day-on-Day Trend', 'Daily collection and order trend from Till May plus DOD source tabs.', `<div class="chart-card chart-card-full"><div class="chart-wrap" style="height:430px"><canvas id="reportChart"></canvas></div></div>${reportTable(['Date','Collection','Orders'], rows.slice(-14).map(r => [esc(r.key), moneyCr(r.coll), shortOrders(r.ord)]))}`);
  destroyChart('report');
  const canvas = document.getElementById('reportChart');
  if (canvas) state.charts.report = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{ labels, datasets:[{ label:'TY Collection (Cr)', data:rows.map(r=>r.coll), borderColor:'#e17655', backgroundColor:'rgba(225,118,85,.18)', fill:true, tension:.35, pointRadius:3, pointHoverRadius:5 }] },
    options:{ ...multiOptions(false), layout:{ padding:{ top: 26 } } },
    plugins:[chartValueLabelPlugin({ spikesOnly:true })],
  });
}
function renderReportEdtech() {
  const idx = summaryIndices(), min = 5, rows = getActiveRows().filter(r => (toNum(r[idx.tgtColl]) || 0) >= min).sort((a,b)=>(toNum(b[idx.achColl])||0)-(toNum(a[idx.achColl])||0));
  reportShell('🎓 Edtech analytics', `Large-category focus. Minimum target threshold: ${min} Cr.`, reportTable(['#','Exam','Target','Achieved','% Achievement','Achieved AOV'], rows.map((r,i) => {
    const p = toNum(r[idx.tgtColl]) ? toNum(r[idx.achColl]) / toNum(r[idx.tgtColl]) * 100 : NaN;
    return [i+1, esc(r[idx.exam]), moneyCr(toNum(r[idx.tgtColl])), moneyCr(toNum(r[idx.achColl])), `<span class="${pctClassValue(p)}">${pctText(toNum(r[idx.achColl]),toNum(r[idx.tgtColl]))}</span>`, rupee(toNum(r[idx.achAov]))];
  })));
}
function renderActiveReport() {
  if (!state.headers.length) return;
  destroyChart('report');
  const renderers = { tva:renderReportTva, month:renderReportMonth, lyty:renderReportLyTy, aov:renderReportAov, typeAov:renderReportTypeAov, generic:renderReportGeneric, batch:renderReportBatch, dod:renderReportDod, edtech:renderReportEdtech };
  (renderers[state.activeReport] || renderReportTva)();
}

let dpCurrentView = 'tva';
function switchView(viewId) {
  dpCurrentView = viewId;
  document.querySelectorAll('.dp-nav-item').forEach(b => {
    if (b.dataset.view) b.classList.toggle('active', b.dataset.view === viewId);
  });
  const titles = {
    tva: { title: 'Targets vs Achievement', desc: 'Plan, actuals, AOV and YoY. Explore performance, compare leaders and export detailed views.', eyebrow: 'Live performance intelligence' },
    ty:  { title: 'This Year Achievement', desc: 'Current fiscal year monthly performance and trends.', eyebrow: 'Current fiscal year' },
    ly:  { title: 'Last Year Achievement', desc: 'FY26 comparison period for year-on-year analysis.', eyebrow: 'Previous fiscal year' },
  };
  const def = titles[viewId] || titles.tva;
  const h1 = document.getElementById('dpViewTitle');
  const p  = document.getElementById('dpViewDesc');
  const ey = document.getElementById('dpEyebrow');
  if (h1) h1.textContent = def.title;
  if (p)  p.textContent  = def.desc;
  if (ey) ey.textContent = def.eyebrow;
  if (state.headers.length) {
    const reportMap = { tva: 'tva', ty: 'month', ly: 'lyty' };
    state.activeReport = reportMap[viewId] || state.activeReport;
    document.querySelectorAll('.report-tab[data-report]').forEach(b => b.classList.toggle('active', b.dataset.report === state.activeReport));
    switchSubtab('overview');
  }
}

/* ── Sub-tab switching ──────────────────────────────── */
function switchSubtab(tabId) {
  document.querySelectorAll('.dp-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === tabId));
  document.querySelectorAll('.dp-tab-panel').forEach(p => {
    p.style.display = p.id === `tab-${tabId}` ? '' : 'none';
  });
  if (tabId === 'overview' && state.headers.length) {
    renderActiveReport();
  }
  if (tabId === 'charts') renderCharts();
}

/* ── Oracle-style KPI renderer ─────────────────────── */
function renderOracleKPIs() {
  const rows = getActiveRows();
  const h = state.headers;

  const findCol = (...terms) => h.find(col => terms.some(t => col.toLowerCase().includes(t.toLowerCase())));
  const sumCol = (colName) => {
    if (!colName) return 0;
    const idx = h.indexOf(colName);
    if (idx < 0) return 0;
    return rows.reduce((s, r) => { const n = toNum(r[idx]); return s + (isNaN(n) ? 0 : n); }, 0);
  };

  const aopGrossCol  = findCol('Bizfin AOP - Gross', 'AOP - Gross', 'AOP Collection', 'AOP Gross', 'Bizfin AOP');
  const achGrossCol  = findCol('Achieved - Gross', 'Achieved Gross', 'Achieved MTD', 'Achieved Collection');
  const aopOrdersCol = findCol('Bizfin AOP - Orders', 'AOP - Orders', 'AOP Orders', 'Bizfin AOP - Order');
  const achOrdersCol = findCol('Achieved Orders');
  const aopAovCol    = findCol('Bizfin AOP - AOV', 'AOP - AOV', 'AOP AOV');
  const achAovCol    = findCol('Achieved AOV');
  const lyCol        = findCol('Last Year YTD', 'LY Collection', 'Last Year Collection', 'Last Year YTD');
  const tyCol        = findCol('This Year YTD', 'Achieved YTD', 'This Year Collection');

  const exactIdx = summaryIndices();
  const exactTotal = state.reportMeta.totalRow || null;
  const exactNum = idx => exactTotal && idx >= 0 ? toNum(exactTotal[idx]) : NaN;
  const aopGross  = !isNaN(exactNum(exactIdx.tgtColl)) ? exactNum(exactIdx.tgtColl) : sumCol(aopGrossCol);
  const achGross  = !isNaN(exactNum(exactIdx.achColl)) ? exactNum(exactIdx.achColl) : sumCol(achGrossCol);
  const aopOrders = !isNaN(exactNum(exactIdx.tgtOrd)) ? exactNum(exactIdx.tgtOrd) : sumCol(aopOrdersCol);
  const achOrders = !isNaN(exactNum(exactIdx.achOrd)) ? exactNum(exactIdx.achOrd) : sumCol(achOrdersCol);
  const achPct    = aopGross  > 0 ? (achGross  / aopGross  * 100) : 0;
  const ordPct    = aopOrders > 0 ? (achOrders / aopOrders * 100) : 0;
  const lyTotal   = !isNaN(exactNum(exactIdx.lyColl)) ? exactNum(exactIdx.lyColl) : sumCol(lyCol);
  const tyTotal   = (!isNaN(exactNum(exactIdx.tyColl)) ? exactNum(exactIdx.tyColl) : sumCol(tyCol)) || achGross;
  const yoy       = lyTotal > 0 ? ((tyTotal - lyTotal) / lyTotal * 100) : null;

  const aovTgtVals = rows.map(r => { const i = h.indexOf(aopAovCol); return i >= 0 ? toNum(r[i]) : NaN; }).filter(v => !isNaN(v) && v > 0);
  const aovAchVals = rows.map(r => { const i = h.indexOf(achAovCol); return i >= 0 ? toNum(r[i]) : NaN; }).filter(v => !isNaN(v) && v > 0);
  const aovTgt     = !isNaN(exactNum(exactIdx.tgtAov)) ? exactNum(exactIdx.tgtAov) : (aovTgtVals.length ? aovTgtVals.reduce((a,b)=>a+b,0) / aovTgtVals.length : 0);
  const aovAch     = !isNaN(exactNum(exactIdx.achAov)) ? exactNum(exactIdx.achAov) : (aovAchVals.length ? aovAchVals.reduce((a,b)=>a+b,0) / aovAchVals.length : 0);
  const aovPct     = aovTgt > 0 ? (aovAch / aovTgt * 100) : 0;

  const fCr  = n => n >= 1 ? n.toFixed(2)+' Cr' : n > 0 ? (n*100).toFixed(1)+' L' : '0';
  const fK   = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : Math.round(n).toLocaleString();
  const fPct = n => n.toFixed(1)+'%';
  const achColor = pct => pct >= 100 ? 'up' : pct < 30 ? 'down' : '';

  // If no oracle-specific columns found, fall back to generic KPIs
  const hasOracleCols = aopGrossCol || achGrossCol || aopOrdersCol;
  if (!hasOracleCols) { renderKPIs(); return; }

  const kpis = [
    {
      label:'Target Collection',
      value: aopGross > 0 ? fCr(aopGross) : '--',
      sub:'annual plan', accent:'violet'
    },
    {
      label:'Achieved (TY)',
      value: achGross > 0 ? fCr(achGross) : '--',
      sub: aopGross>0 ? `<span class="${achColor(achPct)}">${fPct(achPct)} of target</span>` : '',
      accent: achPct>=100?'green':achPct>=70?'amber':'red'
    },
    {
      label:'Last Year YTD',
      value: lyTotal > 0 ? fCr(lyTotal) : '--',
      sub: yoy !== null ? `<span class="${yoy>=0?'up':'down'}">${yoy>=0?'+':''}${yoy.toFixed(1)}% YoY</span>` : '',
      accent:'blue'
    },
    {
      label:'Target AOV',
      value: aovTgt > 0 ? '&#8377;'+Math.round(aovTgt).toLocaleString() : '--',
      sub:'per order', accent:'violet'
    },
    {
      label:'Achieved AOV',
      value: aovAch > 0 ? '&#8377;'+Math.round(aovAch).toLocaleString() : '--',
      sub: aovTgt>0 ? `<span class="${achColor(aovPct)}">${fPct(aovPct)} of target</span>` : '',
      accent: aovPct>=100?'green':aovPct>=70?'amber':'red'
    },
    {
      label:'Target Orders',
      value: aopOrders > 0 ? fK(aopOrders) : '--',
      sub:'annual', accent:'violet'
    },
    {
      label:'Achieved Orders',
      value: achOrders > 0 ? fK(achOrders) : '--',
      sub: aopOrders>0 ? `<span class="${achColor(ordPct)}">${fPct(ordPct)} of target</span>` : '',
      accent: ordPct>=100?'green':ordPct>=70?'amber':'red'
    },
  ];

  const grid = document.getElementById('kpiGrid');
  grid.className = 'dp-kpi-row';
  grid.innerHTML = kpis.map(k => `
    <div class="dp-kpi-card" data-accent="${k.accent}">
      <div class="dp-kpi-label">${esc(k.label)}</div>
      <div class="dp-kpi-value">${k.value}</div>
      ${k.sub ? `<div class="dp-kpi-sub">${k.sub}</div>` : ''}
    </div>`).join('');
}

/* ── Oracle TVA bar chart ───────────────────────────── */
function renderTvaBarChart() {
  const wrap = document.getElementById('tvaChartCard');
  if (!wrap || !state.headers.length) return;

  const rows = getActiveRows();
  const h    = state.headers;
  const examIdx   = h.findIndex(c => /^(updated\s+)?exam$|^category$/i.test(c.trim()));
  const aopColIdx = h.findIndex(c => (c.toLowerCase().includes('aop') || c.toLowerCase().includes('bizfin')) && (c.toLowerCase().includes('gross') || c.toLowerCase().includes('collection')) && !c.toLowerCase().includes('ytd') && !c.toLowerCase().includes('net'));
  const achColIdx = h.findIndex(c => /achieved.*(gross|collection|mtd)/i.test(c) && !c.toLowerCase().includes('net') && !c.toLowerCase().includes('ytd'));

  if ((examIdx < 0 && aopColIdx < 0) || !rows.length) return;

  const useExam = examIdx >= 0 ? examIdx : 0;
  const useVal  = aopColIdx >= 0 ? aopColIdx : achColIdx >= 0 ? achColIdx : -1;
  if (useVal < 0) return;

  // Aggregate by exam
  const grouped = {};
  rows.forEach(r => {
    const exam = String(r[useExam] || '').trim().slice(0, 30);
    if (!exam) return;
    const v = toNum(r[useVal]);
    grouped[exam] = (grouped[exam] || 0) + (isNaN(v) ? 0 : v);
  });

  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const labels   = sorted.map(([k]) => k);
  const aopData  = sorted.map(([k]) => grouped[k] || 0);

  // Achieved data
  const achData = achColIdx >= 0 ? sorted.map(([k]) => {
    const sub = rows.filter(r => String(r[useExam]||'').trim().slice(0,30) === k);
    return sub.reduce((s, r) => { const n = toNum(r[achColIdx]); return s + (isNaN(n)?0:n); }, 0);
  }) : null;

  if (state.charts.tvaBar) { state.charts.tvaBar.destroy(); delete state.charts.tvaBar; }
  const canvas = document.getElementById('tvaBarChart');
  if (!canvas) return;

  const datasets = [
    {
      label: 'Target',
      data: aopData,
      backgroundColor: 'rgba(91,91,214,0.4)',
      borderColor: '#5b5bd6',
      borderWidth: 1, borderRadius: 4,
    }
  ];
  if (achData) {
    datasets.push({
      label: 'Achieved',
      data: achData,
      backgroundColor: 'rgba(22,139,98,0.7)',
      borderColor: '#168b62',
      borderWidth: 0, borderRadius: 4,
    });
  }

  state.charts.tvaBar = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { ...CHART_DEFAULTS.plugins.legend, display: true, position: 'top' },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxRotation: 45 } },
      },
    },
  });
}

/* ── Insight cards ──────────────────────────────────── */
function renderInsightCards() {
  const list = document.getElementById('insightList');
  if (!list || !state.headers.length) return;

  const rows = getActiveRows();
  const h    = state.headers;

  const aopColIdx = h.findIndex(c => (c.toLowerCase().includes('aop') || c.toLowerCase().includes('bizfin')) && (c.toLowerCase().includes('gross') || c.toLowerCase().includes('collection')) && !c.toLowerCase().includes('ytd') && !c.toLowerCase().includes('net'));
  const achColIdx = h.findIndex(c => /achieved.*(gross|collection|mtd)/i.test(c) && !c.toLowerCase().includes('net') && !c.toLowerCase().includes('ytd'));
  const examIdx   = h.findIndex(c => /^(updated\s+)?exam$|^category$/i.test(c.trim()));

  const insights = [];

  if (aopColIdx >= 0 && achColIdx >= 0) {
    const aopTotal = rows.reduce((s,r) => { const n=toNum(r[aopColIdx]); return s+(isNaN(n)?0:n); }, 0);
    const achTotal = rows.reduce((s,r) => { const n=toNum(r[achColIdx]); return s+(isNaN(n)?0:n); }, 0);
    const pct = aopTotal > 0 ? (achTotal/aopTotal*100) : 0;
    insights.push({ label:'Overall Achievement', val: pct.toFixed(1)+'%', sub: `${achTotal.toFixed(2)} vs ${aopTotal.toFixed(2)} Cr target`, color: pct>=100?'#168b62':pct>=70?'#b86d1f':'#d6455d' });
  }

  if (examIdx >= 0 && aopColIdx >= 0) {
    // Top performer
    const grouped = {};
    rows.forEach(r => {
      const k = String(r[examIdx]||'').trim();
      if (!k) return;
      const v = toNum(r[aopColIdx]);
      grouped[k] = (grouped[k]||0) + (isNaN(v)?0:v);
    });
    const top = Object.entries(grouped).sort((a,b)=>b[1]-a[1])[0];
    if (top) insights.push({ label:'Highest Target', val: top[0].slice(0,22), sub: top[1].toFixed(2)+' Cr', color:'#5b5bd6' });
  }

  if (examIdx >= 0 && achColIdx >= 0) {
    // Best achieved
    const grouped = {};
    rows.forEach(r => {
      const k = String(r[examIdx]||'').trim();
      if (!k) return;
      const v = toNum(r[achColIdx]);
      grouped[k] = (grouped[k]||0) + (isNaN(v)?0:v);
    });
    const top = Object.entries(grouped).sort((a,b)=>b[1]-a[1])[0];
    if (top) insights.push({ label:'Top Achiever', val: top[0].slice(0,22), sub: top[1].toFixed(2)+' Cr', color:'#168b62' });
  }

  if (!insights.length) {
    list.innerHTML = '<div style="color:#475569;font-size:12px">Load data with Target/Achievement columns to see insights.</div>';
    return;
  }

  list.innerHTML = insights.map(ins => `
    <div class="dp-insight-item">
      <div class="dp-insight-label">${esc(ins.label)}</div>
      <div class="dp-insight-val" style="color:${ins.color}">${esc(ins.val)}</div>
      <div class="dp-insight-sub">${esc(ins.sub)}</div>
    </div>`).join('');
}

/* ── Oracle TVA table renderer ─────────────────────── */
function renderTvaTable() {
  const wrap = document.getElementById('tvaTableWrap');
  if (!wrap || !state.headers.length) return;

  const rows = getActiveRows();
  const h    = state.headers;

  // Detect column indices
  const examIdx    = h.findIndex(c => /^(updated\s+)?exam$|^category$/i.test(c.trim()));
  const leaderIdx  = h.findIndex(c => /^leader$/i.test(c.trim()));
  const aopOrdIdx  = h.findIndex(c => c.toLowerCase().includes('aop') && c.toLowerCase().includes('order') && !c.toLowerCase().includes('ytd') && !c.toLowerCase().includes('aov'));
  const achOrdIdx  = h.findIndex(c => /achieved orders/i.test(c) && !c.toLowerCase().includes('ytd'));
  const aopCollIdx = h.findIndex(c => (c.toLowerCase().includes('aop') || c.toLowerCase().includes('bizfin')) && (c.toLowerCase().includes('gross') || c.toLowerCase().includes('collection')) && !c.toLowerCase().includes('ytd') && !c.toLowerCase().includes('net'));
  const achCollIdx = h.findIndex(c => /achieved.*(gross|collection|mtd)/i.test(c) && !c.toLowerCase().includes('net') && !c.toLowerCase().includes('ytd'));
  const aovTgtIdx  = h.findIndex(c => /bizfin.*aov|aop.*aov/i.test(c) && !c.toLowerCase().includes('ytd'));
  const aovAchIdx  = h.findIndex(c => /achieved.*aov/i.test(c) && !c.toLowerCase().includes('ytd'));
  const lyCollIdx  = h.findIndex(c => /last year.*ytd|ly.*ytd|ly collection|last year collection/i.test(c));
  const tyCollIdx  = h.findIndex(c => /this year.*ytd|ty.*ytd|achieved ytd/i.test(c));

  const achPct = (ach, aop) => {
    const a = toNum(ach), t = toNum(aop);
    return t > 0 ? (a / t * 100) : NaN;
  };
  const achClass = pct => {
    if (isNaN(pct)) return '';
    if (pct >= 100) return 'ach-green';
    if (pct >= 70)  return 'ach-amber';
    if (pct >= 30)  return 'ach-purple';
    return 'ach-red';
  };
  const fCr  = v => { const n = toNum(v); return isNaN(n)||n===0 ? '-' : n >= 1 ? n.toFixed(2)+' Cr' : (n*100).toFixed(1)+' L'; };
  const fK   = v => { const n = toNum(v); return isNaN(n)||n===0 ? '-' : n >= 1000 ? (n/1000).toFixed(1)+'K' : Math.round(n).toLocaleString(); };

  const hasColl   = achCollIdx >= 0 && aopCollIdx >= 0;
  const hasOrders = achOrdIdx  >= 0 && aopOrdIdx  >= 0;
  const hasAov    = aovTgtIdx  >= 0 && aovAchIdx  >= 0;
  const hasYoY    = lyCollIdx  >= 0 && tyCollIdx  >= 0;

  // If nothing oracle-specific found, show a message
  if (!hasColl && !hasOrders && !hasAov && !hasYoY) {
    wrap.innerHTML = `<div style="padding:24px;color:#475569;font-size:13px;text-align:center">
      No Target/Achievement columns detected. The Overview table works best with columns like<br>
      "Bizfin AOP - Gross", "Achieved - Gross", "Bizfin AOP - Orders", "Achieved Orders", etc.
    </div>`;
    return;
  }

  const examLabel = examIdx >= 0 ? h[examIdx] : (leaderIdx >= 0 ? 'Leader' : 'Item');
  const useExam   = examIdx >= 0 ? examIdx : (leaderIdx >= 0 ? leaderIdx : 0);

  // Totals
  const tot = { achColl:0, aopColl:0, achOrd:0, aopOrd:0, lyColl:0, tyColl:0 };
  rows.forEach(r => {
    if (aopCollIdx>=0) tot.aopColl += toNum(r[aopCollIdx])||0;
    if (achCollIdx>=0) tot.achColl += toNum(r[achCollIdx])||0;
    if (aopOrdIdx>=0)  tot.aopOrd  += toNum(r[aopOrdIdx]) ||0;
    if (achOrdIdx>=0)  tot.achOrd  += toNum(r[achOrdIdx]) ||0;
    if (lyCollIdx>=0)  tot.lyColl  += toNum(r[lyCollIdx]) ||0;
    if (tyCollIdx>=0)  tot.tyColl  += toNum(r[tyCollIdx]) ||0;
  });

  // Sort by AOP collection descending
  const sorted = [...rows].sort((a,b) => {
    const av = aopCollIdx>=0 ? (toNum(a[aopCollIdx])||0) : 0;
    const bv = aopCollIdx>=0 ? (toNum(b[aopCollIdx])||0) : 0;
    return bv - av;
  });

  let html = '<table class="dp-tva-table"><thead>';

  // Group header row
  html += '<tr>';
  html += `<th class="th-group sticky col-sep" style="text-align:left;min-width:160px" rowspan="2">${esc(examLabel)}</th>`;
  if (leaderIdx >= 0 && leaderIdx !== useExam) html += '<th class="th-group sticky col-sep" style="text-align:left;min-width:100px;left:160px" rowspan="2">Leader</th>';
  if (hasColl)   html += '<th class="th-group col-sep" colspan="3">Collection</th>';
  if (hasOrders) html += '<th class="th-group col-sep" colspan="3">Orders</th>';
  if (hasAov)    html += '<th class="th-group col-sep" colspan="2">AOV (&#8377;)</th>';
  if (hasYoY)    html += '<th class="th-group col-sep" colspan="2">vs Last Year</th>';
  html += '</tr><tr>';
  if (hasColl)   html += '<th class="th-sub">Target</th><th class="th-sub">Achieved</th><th class="th-sub col-sep">%</th>';
  if (hasOrders) html += '<th class="th-sub">Target</th><th class="th-sub">Achieved</th><th class="th-sub col-sep">%</th>';
  if (hasAov)    html += '<th class="th-sub">Target</th><th class="th-sub col-sep">Achv</th>';
  if (hasYoY)    html += '<th class="th-sub">LY</th><th class="th-sub col-sep">TY</th>';
  html += '</tr></thead><tbody>';

  const showLeader = leaderIdx >= 0 && leaderIdx !== useExam;

  sorted.forEach(row => {
    const examVal = String(row[useExam]||'');
    const ldrVal  = showLeader ? String(row[leaderIdx]||'') : '';
    const aopC    = aopCollIdx>=0 ? row[aopCollIdx] : null;
    const achC    = achCollIdx>=0 ? row[achCollIdx] : null;
    const aopO    = aopOrdIdx>=0  ? row[aopOrdIdx]  : null;
    const achO    = achOrdIdx>=0  ? row[achOrdIdx]  : null;
    const pctC    = achPct(achC, aopC);
    const pctO    = achPct(achO, aopO);

    html += '<tr>';
    html += `<td class="sticky col-sep">${esc(examVal)}</td>`;
    if (showLeader) html += `<td class="sticky col-sep" style="left:160px;color:#475569">${esc(ldrVal)}</td>`;
    if (hasColl) {
      html += `<td>${fCr(aopC)}</td>`;
      html += `<td>${fCr(achC)}</td>`;
      html += `<td class="col-sep ${achClass(pctC)}">${isNaN(pctC)?'-':pctC.toFixed(1)+'%'}</td>`;
    }
    if (hasOrders) {
      html += `<td>${fK(aopO)}</td>`;
      html += `<td>${fK(achO)}</td>`;
      html += `<td class="col-sep ${achClass(pctO)}">${isNaN(pctO)?'-':pctO.toFixed(1)+'%'}</td>`;
    }
    if (hasAov) {
      const tav = aovTgtIdx>=0 ? toNum(row[aovTgtIdx]) : NaN;
      const aav = aovAchIdx>=0 ? toNum(row[aovAchIdx]) : NaN;
      html += `<td>${isNaN(tav)||!tav?'-':'&#8377;'+Math.round(tav).toLocaleString()}</td>`;
      html += `<td class="col-sep">${isNaN(aav)||!aav?'-':'&#8377;'+Math.round(aav).toLocaleString()}</td>`;
    }
    if (hasYoY) {
      const lyv = lyCollIdx>=0 ? toNum(row[lyCollIdx]) : NaN;
      const tyv = tyCollIdx>=0 ? toNum(row[tyCollIdx]) : NaN;
      const yoy = lyv>0 ? ((tyv-lyv)/lyv*100) : NaN;
      html += `<td>${fCr(lyv)}</td>`;
      html += `<td class="col-sep ${isNaN(yoy)?'':yoy>=0?'ach-green':'ach-red'}">${fCr(tyv)}</td>`;
    }
    html += '</tr>';
  });

  // Total row
  html += '<tr class="total-row">';
  html += `<td class="sticky col-sep" style="font-weight:800">TOTAL</td>`;
  if (showLeader) html += '<td class="sticky col-sep" style="left:160px"></td>';
  if (hasColl) {
    const tp = tot.aopColl>0 ? (tot.achColl/tot.aopColl*100) : NaN;
    html += `<td>${fCr(tot.aopColl)}</td><td>${fCr(tot.achColl)}</td><td class="col-sep ${achClass(tp)}">${isNaN(tp)?'-':tp.toFixed(1)+'%'}</td>`;
  }
  if (hasOrders) {
    const op = tot.aopOrd>0 ? (tot.achOrd/tot.aopOrd*100) : NaN;
    html += `<td>${fK(tot.aopOrd)}</td><td>${fK(tot.achOrd)}</td><td class="col-sep ${achClass(op)}">${isNaN(op)?'-':op.toFixed(1)+'%'}</td>`;
  }
  if (hasAov) html += '<td>-</td><td class="col-sep">-</td>';
  if (hasYoY) {
    const yoy = tot.lyColl>0 ? ((tot.tyColl-tot.lyColl)/tot.lyColl*100) : NaN;
    html += `<td>${fCr(tot.lyColl)}</td><td class="col-sep ${isNaN(yoy)?'':yoy>=0?'ach-green':'ach-red'}">${fCr(tot.tyColl)}</td>`;
  }
  html += '</tr></tbody></table>';
  wrap.innerHTML = html;
}

/* ── Update sidebar info ────────────────────────────── */
function updateSidebarInfo() {
  const foot    = document.getElementById('sidebarFoot');
  const name    = document.getElementById('sidebarSourceName');
  const meta    = document.getElementById('sidebarSourceMeta');
  const actions = document.getElementById('sidebarHeroActions');
  if (!foot) return;
  if (state.sourceLabel) {
    foot.style.display    = 'block';
    if (actions) actions.style.display = 'none';
    if (name) name.textContent = state.sourceLabel;
    if (meta) meta.textContent = `${state.allRows.length.toLocaleString()} rows · ${state.headers.length} cols`;
  } else {
    foot.style.display = 'none';
    if (actions) actions.style.display = 'flex';
  }
}

/* ── Init & Event Wiring ─────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // Start clock
  startClock();

  // Nav / hero buttons
  document.getElementById('btnSheets').addEventListener('click', () => showModal('sheetsModal'));
  document.getElementById('btnMetabase').addEventListener('click', () => showModal('metabaseModal'));
  document.getElementById('btnDemo').addEventListener('click', () => {
    state.sourceMode = 'demo';
    state.currentSheetInfo = null;
    loadData({ ...DEMO, label: 'Demo Data' });
  });
  document.getElementById('btnDemoNav').addEventListener('click', () => {
    state.sourceMode = 'demo';
    state.currentSheetInfo = null;
    loadData({ ...DEMO, label: 'Demo Data' });
  });

  // Sidebar nav view switching
  document.querySelectorAll('.dp-nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'build') { openBuildWizard(); return; }
      switchView(btn.dataset.view);
    });
  });

  document.querySelectorAll('.report-tab[data-report]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeReport = btn.dataset.report;
      document.querySelectorAll('.report-tab[data-report]').forEach(b => b.classList.toggle('active', b === btn));
      switchSubtab('overview');
      renderActiveReport();
    });
  });
  document.getElementById('ytdModeSelect')?.addEventListener('change', e => {
    applyYtdModeSelection(e.target.value);
  });
  document.getElementById('saveReportPng')?.addEventListener('click', () => {
    const canvas = document.getElementById('reportChart');
    if (!canvas) { showToast('This report has no chart to save.'); return; }
    const link = document.createElement('a');
    link.download = `${state.activeReport}-report.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // Sub-tab switching
  document.querySelectorAll('.dp-subtab').forEach(btn => {
    btn.addEventListener('click', () => switchSubtab(btn.dataset.subtab));
  });

  // Date filter clear
  const dateClear = document.getElementById('dateClear');
  if (dateClear) {
    dateClear.addEventListener('click', () => {
      const df = document.getElementById('dateFrom');
      const dt = document.getElementById('dateTo');
      if (df) df.value = '';
      if (dt) dt.value = '';
    });
  }

  // Hidden formula-builder hooks are optional; the visible wizard UI has been removed.
  document.getElementById('wizardNextBtn')?.addEventListener('click', wizardNext);
  document.getElementById('wizardBackBtn')?.addEventListener('click', wizardBack);
  document.getElementById('wizardCloseBtn')?.addEventListener('click', closeBuildWizard);
  document.getElementById('buildWizardModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('buildWizardModal')) closeBuildWizard();
  });

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
      if (e.target === bd) hideModal(bd.id);
    });
  });

  // Modal connect buttons
  document.getElementById('sheetsConnect').addEventListener('click', connectSheets);
  document.getElementById('metabaseConnect').addEventListener('click', connectMetabase);

  // Enter key in modals
  document.getElementById('sheetsUrl').addEventListener('keydown', e => { if (e.key === 'Enter') connectSheets(); });
  document.getElementById('mbQuestionId').addEventListener('keydown', e => { if (e.key === 'Enter') connectMetabase(); });

  // Chart type toggle
  document.querySelectorAll('.chip[data-chart]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-chart]').forEach(c => c.classList.remove('chip-active'));
      chip.classList.add('chip-active');
      state.chartType = chip.dataset.chart;
      if (state.headers.length) renderMainChart();
    });
  });

  // Search
  document.getElementById('tableSearch').addEventListener('input', e => {
    state.search = e.target.value;
    applyFilter();
  });

  // Pagination
  document.getElementById('prevPage').addEventListener('click', () => {
    if (state.page > 0) { state.page--; renderTable(); }
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    const total = Math.ceil(state.filtered.length / state.pageSize);
    if (state.page < total - 1) { state.page++; renderTable(); }
  });

  // AI chat
  const chatInput = document.getElementById('chatInput');
  const chatSend  = document.getElementById('chatSend');

  chatSend.addEventListener('click', () => {
    const q = chatInput.value.trim();
    if (q) { chatInput.value = ''; sendQuestion(q); }
  });
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const q = chatInput.value.trim();
      if (q) { chatInput.value = ''; sendQuestion(q); }
    }
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendQuestion(btn.dataset.q));
  });

  // Customize filter panel toggle
  document.getElementById('btnCustomize').addEventListener('click', () => {
    const panel = document.getElementById('filterSection');
    const btn   = document.getElementById('btnCustomize');
    const isHidden = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = isHidden ? 'block' : 'none';
    btn.classList.toggle('btn-primary', isHidden);
    btn.classList.toggle('btn-ghost', !isHidden);
    if (isHidden) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Auto-refresh controls
  document.getElementById('refreshToggle').addEventListener('click', () => {
    if (state.autoRefresh) stopAutoRefresh();
    else startAutoRefresh(state.refreshInterval);
  });

  document.getElementById('refreshNow').addEventListener('click', () => {
    state.refreshCountdown = state.refreshInterval;
    silentRefresh();
  });

  document.getElementById('refreshIntervalSel').addEventListener('change', e => {
    const secs = parseInt(e.target.value, 10);
    if (state.autoRefresh) startAutoRefresh(secs);
    else state.refreshInterval = secs;
  });

  // Keyboard shortcut: Esc closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(bd => {
        if (bd.style.display !== 'none') hideModal(bd.id);
      });
    }
  });

  loadConfiguredSummary();
});
