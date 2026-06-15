/* global XLSX, Chart */
const palette = [
  '#60a5fa', '#4b5563', '#74e36d', '#fb923c', '#818cf8', '#f43f5e',
  '#dacb21', '#159a9a', '#ef4444', '#67d7d7', '#9333ea', '#0f9f7a',
  '#f59e0b', '#334155', '#14b8a6', '#dc2626', '#22c55e', '#0284c7'
];

const knownGroups = [
  { name: 'Basics', keys: ['发动机转速', 'engine speed', 'rpm', '车速', 'vehicle speed', 'gear', '档', 'ambient', '环境'] },
  { name: 'Air', keys: ['空气', 'air', '进气', '节气门', 'camshaft', '凸轮', '气流', '质量流量'] },
  { name: 'Boost', keys: ['增压', 'boost', '涡轮', 'wastegate', 'pressure', '压力'] },
  { name: 'Fuel', keys: ['燃油', 'fuel', '喷油', 'rail', '油压'] },
  { name: 'AFR', keys: ['空燃比', 'afr', 'lambda', 'air fuel', 'a/f', '混合气', 'fuel trim', 'equivalence'] },
  { name: 'Ignition', keys: ['点火', 'ignition', 'knk', 'knock', 'retard', '延迟角', '正时', 'timing', 'iga'] },
  { name: 'Temperature', keys: ['温度', 'temperature', 'temp', '*c', '°c'] },
  { name: 'Other', keys: [] }
];

const els = {
  drawerToggle: document.getElementById('drawerToggle'),
  controlDrawer: document.getElementById('controlDrawer'),
  fileInput: document.getElementById('fileInput'),
  slotFileInput: document.getElementById('slotFileInput'),
  fileMeta: document.getElementById('fileMeta'),
  loadCompareBtn: document.getElementById('loadCompareBtn'),
  reloadAllBtn: document.getElementById('reloadAllBtn'),
  logGrid: document.getElementById('logGrid'),
  themeToggle: document.getElementById('themeToggle'),
  toggleAllBtn: document.getElementById('toggleAllBtn'),
  dataTableToggle: document.getElementById('dataTableToggle'),
  showExtrema: document.getElementById('showExtrema'),
  showPoints: document.getElementById('showPoints'),
  measureGroups: document.getElementById('measureGroups'),
  measureCount: document.getElementById('measureCount'),
  visibleCount: document.getElementById('visibleCount'),
  statsTable: document.getElementById('statsTable'),
  dataTablePanel: document.getElementById('dataTablePanel'),
  dataTableWrap: document.getElementById('dataTableWrap'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  chartTitle: document.getElementById('chartTitle'),
  emptyState: document.getElementById('emptyState'),
  canvasWrap: document.getElementById('canvasWrap')
};

let currentTheme = localStorage.getItem('log-viewer-theme') || 'light';
let resizeFrame = 0;
let globalRenderFrame = 0;
let pendingSlotId = 'primary';
let activeTooltipSlotId = 'primary';
const MAX_CHART_POINTS = 1800;
const MAX_NAVIGATOR_POINTS = 900;
const MAX_TABLE_ROWS = 900;

const slotOrder = ['primary', 'compare'];
const slotLabels = { primary: 'LOG A', compare: 'LOG B' };
const logSlots = slotOrder.map(createLogSlot);

function createTooltipState() {
  return {
    dataIndex: -1,
    x: 0,
    y: 0,
    scale: 1,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    renderedIndex: -1,
    raf: 0,
    active: false,
    pinned: false,
    keyboard: false,
    programmatic: false,
    restoreFrame: 0
  };
}

function createLogSlot(id) {
  const root = document.querySelector(`[data-log-id="${id}"]`);
  return {
    id,
    label: slotLabels[id],
    root,
    title: root.querySelector('[data-role="slotTitle"]'),
    loadButton: document.querySelector(`[data-load-slot="${id}"]`),
    chartCanvas: root.querySelector('[data-role="chart"]'),
    navigatorCanvas: root.querySelector('[data-role="navigatorCanvas"]'),
    navigator: root.querySelector('[data-role="navigator"]'),
    navigatorTrack: root.querySelector('[data-role="navigatorTrack"]'),
    navigatorSelection: root.querySelector('[data-role="navigatorSelection"]'),
    navigatorLeftHandle: root.querySelector('[data-role="leftHandle"]'),
    navigatorRightHandle: root.querySelector('[data-role="rightHandle"]'),
    rangeMeta: root.querySelector('[data-role="rangeMeta"]'),
    zoomInButton: root.querySelector('[data-action="zoom-in"]'),
    zoomOutButton: root.querySelector('[data-action="zoom-out"]'),
    tooltip: root.querySelector('[data-role="tooltip"]'),
    chart: null,
    navigatorChart: null,
    measures: [],
    sampleLabels: [],
    sourceName: '',
    strategy: '',
    xView: { start: 0, end: 0 },
    navDrag: null,
    renderFrame: 0,
    layoutFrame: 0,
    chartRawIndices: [],
    navigatorRawIndices: [],
    renderTableOnFrame: false,
    tooltipState: createTooltipState()
  };
}

const activeSlots = () => logSlots.filter(slot => slot.measures.length);
const allMeasures = () => logSlots.flatMap(slot => slot.measures);
const findSlot = id => logSlots.find(slot => slot.id === id) || logSlots[0];
const isCompareMode = () => Boolean(findSlot('compare').measures.length);
const activeTooltipSlot = () => activeSlots().find(slot => slot.id === activeTooltipSlotId) || activeSlots()[0] || null;

const crosshairPlugin = {
  id: 'crosshairPlugin',
  afterDraw(activeChart) {
    const active = activeChart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const { ctx, chartArea } = activeChart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = themeColors().crosshair;
    ctx.stroke();
    ctx.restore();
  }
};
if (window.Chart) {
  Chart.register(crosshairPlugin);
  Chart.defaults.font.family = 'Monaco, "Monaco", "PingFang SC", "Microsoft YaHei", monospace';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#666';
}

applyTheme(currentTheme, false);

function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 0.001) return v.toExponential(2);
  if (abs >= 1000) return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(v);
  return Number(v.toFixed(digits)).toString();
}

function applyTheme(theme, shouldRender = true) {
  currentTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem('log-viewer-theme', currentTheme);
  if (els.themeToggle) {
    els.themeToggle.dataset.theme = currentTheme;
    const label = els.themeToggle.querySelector('span');
    if (label) label.textContent = currentTheme === 'dark' ? '暗色' : '亮色';
  }
  if (window.Chart) {
    Chart.defaults.color = currentTheme === 'dark' ? '#94a3b8' : '#64748b';
  }
  if (shouldRender) {
    for (const slot of activeSlots()) {
      renderChart(slot);
      renderNavigator(slot);
    }
  }
}

function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function cleanName(name) {
  return String(name ?? '')
    .replace(/^\s*位置\s*/i, '')
    .replace(/^\s*(IDE|ENG)\d+(?:[-_][A-Z0-9]+)*\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-:：\s]+|[-:：\s]+$/g, '')
    .trim();
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(v, options = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (!s || /^[-–—]$/.test(s)) return null;
  if (/[\u4e00-\u9fff]/.test(s)) return null;

  s = s.replace(/[％%]\s*$/, '%').replace(/\u00a0/g, ' ');
  const unitSuffix = '(?:%|°|℃|°c|\\*c|c|v|mv|kv|a|ma|bar|mbar|hpa|kpa|mpa|pa|psi|nm|n·m|rpm|\\/min|1\\/min|min-1|r\\/min|km\\/h|kph|mph|lambda|afr|ms|s|kw|hp|hz|khz|mhz|kg\\/h|g\\/s|mg\\/str|mg\\/stroke|l\\/h|l\\/min|ohm|Ω|cfm)';
  const match = s.match(new RegExp(`^([+-]?(?:\\d|[.,])(?:[\\d\\s'.,]*\\d)?(?:e[+-]?\\d+)?)\\s*${unitSuffix}?$`, 'i'));
  if (!match) return null;

  const numericText = normalizeLocaleNumber(match[1], options);
  if (!numericText) return null;
  const n = Number(numericText);
  return Number.isFinite(n) ? n : null;
}

const looksNumeric = (v, options = {}) => toNumber(v, options) !== null;

function normalizeLocaleNumber(input, options = {}) {
  let s = String(input).trim().replace(/[\s']/g, '');
  if (!s) return '';

  let exponent = '';
  const expMatch = s.match(/^(.*?)(e[+-]?\d+)$/i);
  if (expMatch) {
    s = expMatch[1];
    exponent = expMatch[2];
  }
  if (!/^[-+]?[0-9.,]+$/.test(s)) return '';

  const sign = /^[+-]/.test(s) ? s[0] : '';
  if (sign) s = s.slice(1);
  if (!s || !/\d/.test(s)) return '';

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep = '';
  let thousandSep = '';

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
    thousandSep = decimalSep === ',' ? '.' : ',';
  } else if (lastComma >= 0) {
    decimalSep = inferSingleSeparator(s, ',', options);
    thousandSep = decimalSep ? '' : ',';
  } else if (lastDot >= 0) {
    decimalSep = inferSingleSeparator(s, '.', options);
    thousandSep = decimalSep ? '' : '.';
  }

  if (thousandSep) s = s.split(thousandSep).join('');
  if (decimalSep && decimalSep !== '.') s = s.replace(decimalSep, '.');

  if (!/^\d+(?:\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return '';
  return `${sign}${s}${exponent}`;
}

function inferSingleSeparator(value, sep, options = {}) {
  const parts = value.split(sep);
  if (parts.length === 1) return '';
  if (parts.length === 2) {
    const [left, right] = parts;
    if (!left) return sep;
    if (sep === ',' && options.delimiter === ',' && right.length === 3 && left.length <= 3) return '';
    return sep;
  }
  const last = parts[parts.length - 1];
  const allThousands = parts.slice(1).every(part => part.length === 3);
  if (allThousands) return '';
  return last.length ? sep : '';
}

const isBlank = v => v === null || v === undefined || String(v).trim() === '';

function isSkippedDataColumn(name) {
  return /^(时间|time|timestamp|date|日期|sec|秒|记录值|插入标记号|marker|mark|sample|index|序号)$/i.test(String(name ?? '').trim());
}

const stripUnitBrackets = value => compactText(value).replace(/^[\[(（]\s*|\s*[\])）]$/g, '').trim();

function isUnitLike(value) {
  let t = stripUnitBrackets(value).toLowerCase();
  if (!t) return false;
  if (t.length > 24) return false;
  return /^(\/min|1\/min|min-1|rpm|r\/min|km\/h|kph|mph|%|percent|°|deg|°c|℃|\*c|c|k|v|mv|kv|a|ma|bar|mbar|hpa|kpa|mpa|pa|psi|nm|n·m|kg\/h|g\/s|mg\/str|mg\/stroke|lambda|afr|ms|s|kw|hp|hz|khz|mhz|l\/h|l\/min|ohm|Ω|cfm)$/i.test(t)
    || /^(?:m|μ|u|k|milli)?(?:v|a|pa|bar|s|hz)$/i.test(t);
}

const normalizeUnit = value => {
  const unit = stripUnitBrackets(value);
  return isUnitLike(unit) ? unit : '';
};

function splitHeaderNameUnit(rawName, rawUnit = '') {
  let name = cleanName(rawName);
  let unit = normalizeUnit(rawUnit);
  if (!name) return { name, unit };

  const bracketMatch = name.match(/^(.*?)[\s_-]*[\[(（]([^()[\]（）]{1,24})[\])）]\s*$/);
  if (!unit && bracketMatch && isUnitLike(bracketMatch[2])) {
    name = cleanName(bracketMatch[1]);
    unit = normalizeUnit(bracketMatch[2]);
  }

  const trailingUnitMatch = name.match(/^(.*?)(?:\s+|_)(\/min|1\/min|min-1|rpm|r\/min|km\/h|kph|mph|%|°|deg|°c|℃|\*c|c|v|mv|kv|a|ma|bar|mbar|hpa|kpa|mpa|pa|psi|nm|n·m|kg\/h|g\/s|mg\/str|mg\/stroke|lambda|afr|ms|s|kw|hp|hz|khz|mhz|l\/h|l\/min|ohm|Ω|cfm)$/i);
  if (!unit && trailingUnitMatch && isUnitLike(trailingUnitMatch[2])) {
    name = cleanName(trailingUnitMatch[1]);
    unit = normalizeUnit(trailingUnitMatch[2]);
  }

  return { name, unit };
}

function normalizeRows(rows) {
  return rows
    .map(row => Array.from(row || []).map(v => (v === undefined ? null : v)))
    .filter(row => row.some(v => !isBlank(v)));
}

function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    for (const enc of ['gb18030', 'gbk', 'gb2312', 'big5']) {
      try { return new TextDecoder(enc).decode(bytes); } catch { /* try next */ }
    }
    return new TextDecoder('latin1').decode(bytes);
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}

async function loadFile(file, slot = logSlots[0]) {
  if (!file) return;
  slot.sourceName = file.name;
  updateParseProgress(`${slot.label} 读取文件：${file.name} (${Math.round(file.size / 1024)} KB)`);
  await nextFrame();
  try {
    const data = await readFile(file);
    updateParseProgress(`${slot.label} 识别编码与表格结构...`);
    await nextFrame();
    const parsed = parseFileData(file, data, slot);
    if (!parsed.measures.length) throw new Error('没有找到可绘图的数值列');
    setData(slot, parsed.measures, parsed.sampleLabels, file.name, parsed.strategy);
    updateParseProgress(`已载入：${file.name} | ${parsed.sampleLabels.length} 个采样点 | ${parsed.measures.length} 条数据流 | ${parsed.strategy}`);
    els.fileInput.value = '';
    els.slotFileInput.value = '';
  } catch (err) {
    console.error(err);
    updateParseProgress(`${slot.label} 解析失败：${err.message || err}`);
    els.fileInput.value = '';
    els.slotFileInput.value = '';
    alert('文件解析失败，请确认是有效的 CSV/XLSX 日志。');
  }
}

const updateParseProgress = message => { els.fileMeta.textContent = message; };

async function loadFiles(files) {
  const selected = Array.from(files || []).slice(0, 2);
  if (!selected.length) return;
  for (let index = 0; index < selected.length; index++) {
    await loadFile(selected[index], logSlots[index]);
  }
}

function parseFileData(file, data, slot = logSlots[0]) {
  const isTextTable = /\.(csv|txt|tsv)$/i.test(file.name);
  if (isTextTable) {
    const text = decodeText(data);
    const delimiter = guessDelimiter(text);
    updateParseProgress(`${slot.label} 识别编码与分隔符：${delimiterName(delimiter)} | 提取数据名称和数值列...`);
    const rows = parseDelimitedRows(text, delimiter);
    const parsed = parseRows(rows, { delimiter });
    parsed.strategy = `${parsed.strategy} · ${delimiterName(delimiter)}`;
    return parsed;
  }

  const workbook = XLSX.read(data, {
    type: 'array',
    raw: true,
    cellDates: false,
    dense: false
  });
  updateParseProgress(`${slot.label} 识别到 ${workbook.SheetNames.length} 个工作表 | 提取数据名称和数值列...`);

  const candidates = [];
  const errors = [];
  for (const sheetName of workbook.SheetNames) {
    try {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false
      });
      const parsed = parseRows(rows);
      const numericCount = parsed.measures.reduce((sum, m) => sum + m.values.filter(v => v !== null).length, 0);
      candidates.push({
        sheetName,
        parsed,
        score: parsed.measures.length * 100000 + parsed.sampleLabels.length * 100 + numericCount
      });
    } catch (err) {
      errors.push(`${sheetName}: ${err.message || err}`);
    }
  }

  if (!candidates.length) throw new Error(errors[0] || '未找到可用工作表');
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  best.parsed.strategy = `${best.parsed.strategy} · sheet: ${best.sheetName}`;
  return best.parsed;
}

const delimiterName = delimiter => ({ '\t': 'TSV', ';': 'semicolon CSV', '|': 'pipe table' }[delimiter] || 'comma CSV');

function guessDelimiter(text) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 40);
  const delimiters = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of delimiters) {
    const counts = lines.map(line => splitSimpleDelimitedLine(line, delimiter).length);
    const multiCounts = counts.filter(n => n > 1);
    if (multiCounts.length < Math.min(2, lines.length)) continue;
    const freq = new Map();
    for (const count of multiCounts) freq.set(count, (freq.get(count) || 0) + 1);
    const [modeCount, modeHits] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const avg = multiCounts.reduce((a, b) => a + b, 0) / multiCounts.length;
    const variance = multiCounts.reduce((sum, n) => sum + Math.abs(n - avg), 0) / multiCounts.length;
    const consistency = modeHits / counts.length;
    const singleLinePenalty = counts.filter(n => n === 1).length * 1.6;
    const score = modeCount * 2.5 + multiCounts.length * 1.2 + consistency * 18 - variance * 2.5 - singleLinePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function parseDelimitedRows(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      if (quoted && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(v => !isBlank(v))) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some(v => !isBlank(v))) rows.push(row);
  return rows;
}

function splitSimpleDelimitedLine(line, delimiter) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

function parseRows(rows, options = {}) {
  const normalizedRows = normalizeRows(rows);
  if (!normalizedRows.length) throw new Error('文件为空');
  const pairedProfile = detectPairedValueProfile(normalizedRows, options);
  if (pairedProfile) {
    try {
      return buildSeriesFromPairedProfile(normalizedRows, pairedProfile, options);
    } catch (err) {
      console.warn('Paired parser failed, falling back to generic table parser:', err);
    }
  }
  const profile = detectTableProfile(normalizedRows, options);
  return buildSeriesFromProfile(normalizedRows, profile, options);
}

function detectPairedValueProfile(rows, options = {}) {
  const stats = rows.map(row => rowStats(row, options));
  for (let i = 0; i < rows.length - 3; i++) {
    const nameRow = rows[i + 1] || [];
    const unitRow = rows[i + 2] || [];
    const dataStats = stats[i + 3];
    let pairScore = 0;
    let nameCount = 0;
    for (let c = 0; c < Math.max(rows[i]?.length || 0, nameRow.length); c++) {
      const currentName = cleanName(nameRow[c]);
      const nextLabel = compactText(nameRow[c + 1]).toLowerCase();
      const currentTop = compactText(rows[i]?.[c]).toLowerCase();
      if (currentName && !isSkippedDataColumn(currentName) && (nextLabel === '记录值' || nextLabel === 'value')) pairScore += 2;
      if (currentTop && /^(时间|time)$/.test(compactText(rows[i]?.[c + 1]).toLowerCase())) pairScore += 0.5;
      if (currentName && !isSkippedDataColumn(currentName) && !isUnitLike(currentName)) nameCount++;
    }
    if (pairScore >= 4 && nameCount >= 2 && dataStats?.numeric >= 4) {
      return { topRowIdx: i, nameRowIdx: i + 1, unitRowIdx: unitRow.some(isUnitLike) ? i + 2 : -1, dataStartIdx: i + 3 };
    }
  }
  return null;
}

function buildSeriesFromPairedProfile(rows, profile, options = {}) {
  const dataRows = rows.slice(profile.dataStartIdx).filter(row => rowStats(row, options).numeric >= 1);
  const series = [];
  const labels = dataRows.map((_, i) => `#${i + 1}`);
  const nameRow = rows[profile.nameRowIdx] || [];
  const unitRow = profile.unitRowIdx >= 0 ? rows[profile.unitRowIdx] || [] : [];

  for (let c = 0; c < nameRow.length; c++) {
    const parsedHeader = splitHeaderNameUnit(nameRow[c], unitRow[c]);
    const name = parsedHeader.name;
    if (!name || isSkippedDataColumn(name) || isUnitLike(name)) continue;
    const nextLabel = compactText(nameRow[c + 1]).toLowerCase();
    const prevLabel = compactText(nameRow[c - 1]).toLowerCase();
    const likelyValueColumn = prevLabel === '记录值' || prevLabel === 'value'
      || nextLabel === '记录值' || nextLabel === 'value'
      || unitRow[c];
    if (!likelyValueColumn) continue;
    const values = dataRows.map(row => toNumber(row[c], options));
    const count = values.filter(v => v !== null).length;
    if (count < Math.max(2, Math.ceil(dataRows.length * 0.08))) continue;
    series.push(makeMeasure({
      name,
      unit: parsedHeader.unit,
      values,
      color: palette[series.length % palette.length]
    }));
  }

  if (!series.length) throw new Error('没有找到可绘图的数值列');
  return {
    measures: series,
    sampleLabels: labels,
    strategy: 'VCDS paired value columns'
  };
}

function rowStats(row, options = {}) {
  const cells = row || [];
  let nonBlank = 0;
  let numeric = 0;
  let unitLike = 0;
  let textLike = 0;
  for (const cell of cells) {
    if (isBlank(cell)) continue;
    nonBlank++;
    if (looksNumeric(cell, options)) numeric++;
    else {
      textLike++;
      if (isUnitLike(cell)) unitLike++;
    }
  }
  return { nonBlank, numeric, textLike, unitLike, numericRatio: nonBlank ? numeric / nonBlank : 0 };
}

function detectTableProfile(rows, options = {}) {
  const stats = rows.map(row => rowStats(row, options));
  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < rows.length; i++) {
    const current = stats[i];
    const nextRows = stats.slice(i + 1, Math.min(rows.length, i + 8));
    const numericRows = nextRows.filter(s => s.numeric >= 2 && s.numericRatio >= 0.45).length;
    if (!numericRows) continue;

    const prev = stats[i - 1] || { textLike: 0, nonBlank: 0 };
    const next = stats[i + 1] || { unitLike: 0, textLike: 0, numeric: 0, numericRatio: 0 };
    const hasTextHeader = current.textLike >= 1 || prev.textLike >= 2;
    const unitBonus = next.unitLike >= 1 && stats[i + 2]?.numericRatio >= 0.45 ? next.unitLike * 1.8 : 0;
    const score = numericRows * 10 + current.textLike * 2 + prev.textLike + unitBonus - current.numeric * 0.6;
    if (hasTextHeader && score > bestScore) {
      bestIdx = i;
      bestScore = score;
    }
  }

  if (bestIdx < 0) {
    const firstNumericIdx = rows.findIndex((_, i) =>
      stats[i].numeric >= 2
      && stats[i].numericRatio >= 0.45
      && stats.slice(i, i + 6).filter(s => s.numeric >= 2 && s.numericRatio >= 0.45).length >= 2
    );
    if (firstNumericIdx >= 0) {
      return { headerRows: [], unitRowIdx: -1, dataStartIdx: firstNumericIdx };
    }
  }
  if (bestIdx < 0) throw new Error('未找到可用的数据表头');

  const unitRowIdx = stats[bestIdx + 1]?.unitLike >= 1 && stats[bestIdx + 2]?.numericRatio >= 0.45 ? bestIdx + 1 : -1;
  const dataStartIdx = unitRowIdx >= 0 ? unitRowIdx + 1 : bestIdx + 1;
  const headerRows = [];
  if (bestIdx > 0 && stats[bestIdx - 1].textLike >= 2 && stats[bestIdx - 1].numericRatio < 0.35) headerRows.push(bestIdx - 1);
  headerRows.push(bestIdx);

  return { headerRows, unitRowIdx, dataStartIdx };
}

function buildSeriesFromProfile(rows, profile, options = {}) {
  const dataRows = rows.slice(profile.dataStartIdx).filter(row => rowStats(row, options).numeric >= 1);
  if (!dataRows.length) throw new Error('未找到数据行');

  const maxCols = Math.max(...rows.map(r => r.length));
  const series = [];
  const labels = dataRows.map((_, i) => `#${i + 1}`);

  for (let c = 0; c < maxCols; c++) {
    const headerParts = profile.headerRows
      .map(rIdx => cleanName(rows[rIdx]?.[c]))
      .filter(Boolean)
      .filter(part => !isSkippedDataColumn(part));
    const rawName = mergeHeaderParts(headerParts);
    const explicitUnit = profile.unitRowIdx >= 0 ? rows[profile.unitRowIdx]?.[c] : '';
    const values = dataRows.map(row => toNumber(row[c], options));
    const count = values.filter(v => v !== null).length;
    if (count < Math.max(2, Math.ceil(dataRows.length * 0.08))) continue;

    const parsedHeader = splitHeaderNameUnit(rawName || inferNameFromColumn(rows, c), explicitUnit);
    const name = parsedHeader.name || `Column ${c + 1}`;
    if (isSkippedDataColumn(name) || isUnitLike(name)) continue;
    series.push(makeMeasure({
      name,
      unit: parsedHeader.unit,
      values,
      color: palette[series.length % palette.length]
    }));
  }

  if (!series.length) throw new Error('没有找到可绘图的数值列');
  return {
    measures: series,
    sampleLabels: labels,
    strategy: 'generic header / unit table'
  };
}

function mergeHeaderParts(parts) {
  const cleaned = parts
    .map(part => cleanName(part))
    .filter(Boolean)
    .filter(part => !/^(g\d+|f\d+|ide\d+|eng\d+)$/i.test(part));
  if (!cleaned.length) return '';
  const unique = [];
  for (const part of cleaned) {
    if (!unique.some(existing => existing === part || existing.includes(part))) unique.push(part);
  }
  return unique.join(' - ');
}

function inferNameFromColumn(rows, col) {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const text = cleanName(rows[r]?.[col]);
    if (text && !isSkippedDataColumn(text) && !isUnitLike(text) && !looksNumeric(text)) return text;
  }
  return '';
}

function makeMeasure({ name, unit, values, color }) {
  const nums = values.filter(v => v !== null && Number.isFinite(v));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const minIndex = values.findIndex(v => v === min);
  const maxIndex = values.findIndex(v => v === max);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name,
    unit: unit || '',
    values,
    min,
    max,
    minIndex,
    maxIndex,
    avg,
    color,
    group: groupFor(name, unit),
    visible: true,
    normalized: []
  };
}

function rebuildNormalizedValues(items) {
  const buckets = new Map();
  for (const m of items) {
    const key = normalizationKey(m);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }

  for (const bucketItems of buckets.values()) {
    let min = Infinity;
    let max = -Infinity;
    for (const m of bucketItems) {
      for (const v of m.values) {
        if (v === null || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    for (const m of bucketItems) {
      m.normalized = buildMonotonicSharedScaleValues(m.values, min, max);
    }
  }
}

function normalizationKey(measure) {
  const unit = stripUnitBrackets(measure.unit || '').toLowerCase();
  return unit ? `unit|${unit}` : 'unit|unitless';
}

function buildMonotonicSharedScaleValues(values, min, max) {
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return values.map(v => v === null ? null : 50);

  return values.map(v => {
    if (v === null || !Number.isFinite(v)) return null;
    const ratio = clamp((v - min) / range, 0, 1);
    return 2 + ratio * 96;
  });
}

function groupFor(name, unit = '') {
  const s = `${name} ${unit}`.toLowerCase();
  const compactName = compactText(name);
  // Higher-priority semantic buckets first.
  if (compactName.startsWith('增压压力') || (compactName.startsWith('增压') && compactName.includes('压力'))) return 'Boost';
  if (['空燃比', 'afr', 'lambda', 'air fuel', 'a/f', '混合气', 'fuel trim', 'equivalence'].some(k => s.includes(k))) return 'AFR';
  if (['点火', 'ignition', 'knk', 'knock', 'retard', '延迟角', '正时', 'timing', 'iga'].some(k => s.includes(k))) return 'Ignition';
  if (['燃油', 'fuel', 'rail', '喷油', '油压'].some(k => s.includes(k))) return 'Fuel';
  if (['温度', 'temperature', 'temp', '*c', '°c'].some(k => s.includes(k))) return 'Temperature';
  return knownGroups.find(g => g.keys.length && g.keys.some(k => s.includes(k.toLowerCase())))?.name || 'Other';
}

function setData(slot, newMeasures, labels, sourceName, strategy = '') {
  rebuildNormalizedValues(newMeasures);
  slot.measures = newMeasures.map(m => ({ ...m, slotId: slot.id, slotLabel: slot.label }));
  slot.sampleLabels = labels;
  slot.sourceName = sourceName;
  slot.strategy = strategy;
  resetXView(slot);
  slot.root.classList.add('ready');
  slot.title.textContent = sourceName || slot.label;
  slot.loadButton.textContent = '重新加载';
  slot.navigator.classList.add('ready');
  slot.navigator.setAttribute('aria-hidden', 'false');
  syncToggleAllButton();
  updateEmptyState();
  els.canvasWrap.classList.add('with-navigator');
  hideCoordinateTooltip(slot, true);
  renderSlotsAfterLayout(activeSlots());
  scheduleGlobalViews();
}

function renderGlobalViews({ immediate = false } = {}) {
  if (immediate) {
    renderMeasureControls();
    renderStats();
    renderDataTable(false);
  } else {
    scheduleGlobalViews();
  }
  updateChartTitle();
}

function scheduleGlobalViews() {
  if (globalRenderFrame) cancelAnimationFrame(globalRenderFrame);
  globalRenderFrame = requestAnimationFrame(() => {
    globalRenderFrame = 0;
    renderMeasureControls();
    renderStats();
    renderDataTable(false);
    updateChartTitle();
  });
}

function refreshAfterVisibilityChange(slot = null) {
  for (const item of slot ? [slot] : activeSlots()) {
    hideCoordinateTooltip(item, true);
  }
  renderSlotsAfterLayout(slot ? [slot] : activeSlots());
  renderGlobalViews();
}

function renderSlotsAfterLayout(slots) {
  for (const slot of slots) scheduleSlotRenderAfterLayout(slot);
}

function scheduleSlotRenderAfterLayout(slot, attempt = 0) {
  if (slot.layoutFrame) cancelAnimationFrame(slot.layoutFrame);
  slot.layoutFrame = requestAnimationFrame(() => {
    slot.layoutFrame = 0;
    const chartBox = slot.chartCanvas.getBoundingClientRect();
    const ready = chartBox.width > 0 && chartBox.height > 0;
    if (!ready && attempt < 4) {
      scheduleSlotRenderAfterLayout(slot, attempt + 1);
      return;
    }
    renderChart(slot);
    renderNavigator(slot);
    requestAnimationFrame(() => resizeSlotCharts(slot));
  });
}

function resizeSlotCharts(slot) {
  slot.chart?.resize();
  slot.navigatorChart?.resize();
  slot.chart?.update('none');
  slot.navigatorChart?.update('none');
  updateNavigatorSelection(slot);
}

function renderMeasureControls() {
  const measures = allMeasures();
  els.measureCount.textContent = measures.length;
  syncToggleAllButton();
  if (!measures.length) {
    els.measureGroups.className = 'measure-groups empty';
    els.measureGroups.textContent = '请先上传日志文件';
    return;
  }
  els.measureGroups.className = 'measure-groups';
  els.measureGroups.innerHTML = '';

  const showSlotGroups = isCompareMode();
  for (const slot of activeSlots()) {
    const slotWrap = document.createElement('section');
    slotWrap.className = showSlotGroups ? 'slot-control-group' : 'slot-control-group single';
    slotWrap.innerHTML = showSlotGroups ? `
      <div class="slot-control-head">
        <div>
          <p class="eyebrow">${escapeHtml(slot.label)}</p>
          <h3>${escapeHtml(slot.sourceName || slot.label)}</h3>
        </div>
        <span>${slot.measures.length}</span>
      </div>
    ` : '';

    const byGroup = groupMeasures(slot.measures);
    const order = knownGroups.map(g => g.name).filter(g => byGroup.has(g));
    for (const group of order) {
      const groupItems = byGroup.get(group);
      const wrap = document.createElement('div');
      wrap.className = 'group';
      const checked = groupItems.every(m => m.visible);
      wrap.innerHTML = `
        <div class="group-head">
          <label class="group-title"><input class="group-toggle" type="checkbox" ${checked ? 'checked' : ''}> ${escapeHtml(group)}</label>
          <span>${groupItems.length}</span>
        </div>
      `;
      const groupToggle = wrap.querySelector('.group-toggle');
      groupToggle.addEventListener('change', () => {
        groupItems.forEach(m => { m.visible = groupToggle.checked; });
        refreshAfterVisibilityChange(slot);
      });

      for (const m of groupItems) {
        const item = document.createElement('div');
        item.className = `measure-item ${m.visible ? '' : 'off'}`;
        item.innerHTML = `
          <div class="color-dot" style="background:${m.color}"></div>
          <label>
            <input type="checkbox" ${m.visible ? 'checked' : ''} data-id="${m.id}">
            <div class="measure-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
          </label>
        `;
        item.addEventListener('click', () => {
          m.visible = !m.visible;
          refreshAfterVisibilityChange(slot);
        });
        wrap.appendChild(item);
      }
      slotWrap.appendChild(wrap);
    }
    els.measureGroups.appendChild(slotWrap);
  }
}

function groupMeasures(items) {
  const byGroup = new Map();
  for (const m of items) byGroup.set(m.group, [...(byGroup.get(m.group) || []), m]);
  return byGroup;
}

const escapeHtml = s => String(s).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

function themeColors() {
  return currentTheme === 'dark'
    ? {
        grid: 'rgba(148, 163, 184, .16)',
        gridStrong: 'rgba(148, 163, 184, .22)',
        tick: '#94a3b8',
        crosshair: 'rgba(226, 232, 240, .58)'
      }
    : {
        grid: 'rgba(148, 163, 184, .18)',
        gridStrong: 'rgba(148, 163, 184, .22)',
        tick: '#64748b',
        crosshair: 'rgba(15, 23, 42, .52)'
      };
}

function resetXView(slot) {
  slot.xView = { start: 0, end: Math.max(0, slot.sampleLabels.length - 1) };
}

function currentWindow(slot) {
  const total = slot.sampleLabels.length;
  if (!total) return { start: 0, end: 0, labels: [] };
  const start = clamp(Math.round(slot.xView.start), 0, total - 1);
  const end = clamp(Math.round(slot.xView.end), start, total - 1);
  return { start, end, labels: slot.sampleLabels.slice(start, end + 1) };
}

function sampledIndices(start, end, maxPoints) {
  const total = end - start + 1;
  if (total <= 0) return [];
  if (total <= maxPoints) return Array.from({ length: total }, (_, i) => start + i);
  const step = Math.ceil(total / maxPoints);
  const indices = [];
  for (let i = start; i <= end; i += step) indices.push(i);
  if (indices[indices.length - 1] !== end) indices.push(end);
  return indices;
}

function sampledWindow(slot, maxPoints = MAX_CHART_POINTS) {
  const win = currentWindow(slot);
  const rawIndices = sampledIndices(win.start, win.end, maxPoints);
  return {
    ...win,
    rawIndices,
    labels: rawIndices.map(index => slot.sampleLabels[index])
  };
}

function setXView(slot, start, end, shouldRender = true) {
  const total = slot.sampleLabels.length;
  if (!total) return;
  const minSpan = Math.min(total, 8);
  let nextStart = Math.round(start);
  let nextEnd = Math.round(end);
  if (nextEnd - nextStart + 1 < minSpan) {
    const mid = (nextStart + nextEnd) / 2;
    nextStart = Math.floor(mid - (minSpan - 1) / 2);
    nextEnd = nextStart + minSpan - 1;
  }
  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }
  if (nextEnd > total - 1) {
    nextStart -= nextEnd - (total - 1);
    nextEnd = total - 1;
  }
  slot.xView = {
    start: clamp(nextStart, 0, total - 1),
    end: clamp(nextEnd, 0, total - 1)
  };
  if (shouldRender) {
    hideCoordinateTooltip(slot, true);
    scheduleRangeRender(slot, true);
  }
}

function zoomX(slot, factor, anchorRatio = 0.5) {
  const total = slot.sampleLabels.length;
  if (!total) return;
  const width = slot.xView.end - slot.xView.start + 1;
  const nextWidth = clamp(Math.round(width * factor), Math.min(total, 8), total);
  const anchor = slot.xView.start + (width - 1) * anchorRatio;
  setXView(slot, anchor - (nextWidth - 1) * anchorRatio, anchor + (nextWidth - 1) * (1 - anchorRatio));
}

function rangeText(slot) {
  if (!slot.sampleLabels.length) return '区间 --';
  return `${slot.xView.start + 1} - ${slot.xView.end + 1} / ${slot.sampleLabels.length}`;
}

function renderChart(slot) {
  const visible = slot.measures.filter(m => m.visible);
  const pinnedIndex = slot.tooltipState.pinned ? slot.tooltipState.dataIndex : -1;
  if (!slot.tooltipState.pinned) hideCoordinateTooltip(slot, true);
  const colors = themeColors();
  const win = sampledWindow(slot);
  slot.chartRawIndices = win.rawIndices;
  const datasets = visible.map(m => ({
    label: `${m.name}${m.unit ? ` (${m.unit})` : ''}`,
    data: win.rawIndices.map(index => m.normalized[index]),
    borderColor: m.color,
    backgroundColor: m.color,
    borderWidth: 2.2,
    pointRadius: els.showPoints.checked ? 2 : 0,
    pointHoverRadius: 5,
    tension: 0.15,
    spanGaps: true,
    animation: false,
    metaMeasure: m
  }));

  if (els.showExtrema.checked) {
    for (const m of visible) {
      datasets.push(markerDataset(m, 'MAX', m.maxIndex, m.normalized[m.maxIndex], m.max, win));
      datasets.push(markerDataset(m, 'MIN', m.minIndex, m.normalized[m.minIndex], m.min, win));
    }
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    interaction: { mode: 'index', intersect: false },
    elements: {
      line: { borderJoinStyle: 'round' },
      point: { hitRadius: 8 }
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: context => renderCoordinateTooltip(slot, context) }
    },
    scales: {
      x: {
        grid: { color: colors.grid },
        ticks: { maxTicksLimit: 14, color: colors.tick, font: { size: 11, weight: 500 } },
        title: { display: false }
      },
      y: {
        min: -4,
        max: 104,
        title: { display: false },
        grid: { color: colors.gridStrong },
        ticks: { color: colors.tick, font: { size: 11, weight: 500 } }
      }
    }
  };

  if (!slot.chart) {
    slot.chart = new Chart(slot.chartCanvas, { type: 'line', data: { labels: win.labels, datasets }, options });
  } else {
    slot.chart.data.labels = win.labels;
    slot.chart.data.datasets = datasets;
    slot.chart.options = options;
    slot.chart.update('none');
  }
  slot.title.textContent = slot.sourceName || slot.label;
  if (pinnedIndex >= 0) scheduleTooltipRestore(slot, pinnedIndex);
}

function markerDataset(m, type, index, y, rawValue, win) {
  const inView = index >= win.start && index <= win.end;
  return {
    label: `${m.name} ${type} ${fmt(rawValue)}`,
    data: win.rawIndices.map(rawIndex => inView && rawIndex === index ? y : null),
    borderColor: 'transparent',
    backgroundColor: m.color,
    pointRadius: 4,
    pointHoverRadius: 7,
    showLine: false,
    animation: false,
    metaMeasure: m
  };
}

function renderNavigator(slot) {
  if (!slot.navigatorCanvas || !slot.sampleLabels.length) return;
  const visible = slot.measures.filter(m => m.visible);
  const rawIndices = sampledIndices(0, slot.sampleLabels.length - 1, MAX_NAVIGATOR_POINTS);
  slot.navigatorRawIndices = rawIndices;
  const datasets = visible.map(m => ({
    data: rawIndices.map(index => m.normalized[index]),
    borderColor: m.color,
    backgroundColor: m.color,
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.12,
    spanGaps: true,
    animation: false
  }));
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    events: [],
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      x: {
        display: false,
        grid: { display: false }
      },
      y: {
        display: false,
        min: -4,
        max: 104,
        grid: { display: false }
      }
    }
  };

  if (!slot.navigatorChart) {
    slot.navigatorChart = new Chart(slot.navigatorCanvas, { type: 'line', data: { labels: rawIndices.map(index => slot.sampleLabels[index]), datasets }, options });
  } else {
    slot.navigatorChart.data.labels = rawIndices.map(index => slot.sampleLabels[index]);
    slot.navigatorChart.data.datasets = datasets;
    slot.navigatorChart.options = options;
    slot.navigatorChart.update('none');
  }
  updateNavigatorSelection(slot);
  if (slot.rangeMeta) slot.rangeMeta.textContent = rangeText(slot);
}

function updateNavigatorSelection(slot) {
  if (!slot.navigatorSelection || slot.sampleLabels.length < 2) return;
  const max = slot.sampleLabels.length - 1;
  const left = (slot.xView.start / max) * 100;
  const right = 100 - (slot.xView.end / max) * 100;
  slot.navigatorSelection.style.left = `${left}%`;
  slot.navigatorSelection.style.width = `${Math.max(0, 100 - left - right)}%`;
}

function pointerToSampleIndex(slot, event) {
  const box = slot.navigatorTrack.getBoundingClientRect();
  const ratio = clamp((event.clientX - box.left) / Math.max(1, box.width), 0, 1);
  return ratio * Math.max(0, slot.sampleLabels.length - 1);
}

function startNavigatorDrag(slot, mode, event) {
  if (!slot.sampleLabels.length) return;
  event.preventDefault();
  const startIndex = pointerToSampleIndex(slot, event);
  slot.navDrag = {
    mode,
    pointerId: event.pointerId,
    startIndex,
    start: slot.xView.start,
    end: slot.xView.end
  };
  slot.navigatorTrack.classList.add('dragging');
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveNavigatorDrag(slot, event) {
  if (!slot.navDrag) return;
  const current = pointerToSampleIndex(slot, event);
  const delta = Math.round(current - slot.navDrag.startIndex);
  if (slot.navDrag.mode === 'left') setXView(slot, current, slot.xView.end, false);
  else if (slot.navDrag.mode === 'right') setXView(slot, slot.xView.start, current, false);
  else setXView(slot, slot.navDrag.start + delta, slot.navDrag.end + delta, false);
  scheduleRangeRender(slot);
}

function stopNavigatorDrag(slot, event) {
  if (!slot.navDrag) return;
  try { event.currentTarget.releasePointerCapture?.(slot.navDrag.pointerId); } catch { /* ignore */ }
  slot.navDrag = null;
  slot.navigatorTrack.classList.remove('dragging');
  scheduleRangeRender(slot, true);
}

function scheduleRangeRender(slot, includeTable = false) {
  slot.renderTableOnFrame ||= includeTable;
  if (includeTable && slot.renderFrame) {
    cancelAnimationFrame(slot.renderFrame);
    slot.renderFrame = 0;
  }
  if (slot.renderFrame) return;
  slot.renderFrame = requestAnimationFrame(() => {
    const shouldRenderTable = slot.renderTableOnFrame;
    slot.renderFrame = 0;
    slot.renderTableOnFrame = false;
    renderChart(slot);
    renderNavigator(slot);
    renderDataTable(shouldRenderTable);
  });
}

function renderCoordinateTooltip(slot, context) {
  const tooltip = context.tooltip;
  const panel = slot.tooltip;
  if (!panel) return;

  if (slot.tooltipState.pinned && !slot.tooltipState.programmatic) {
    if (slot.tooltipState.dataIndex >= 0 && !panel.classList.contains('show')) {
      showTooltipAtDataIndex(slot, slot.tooltipState.dataIndex);
    }
    return;
  }

  if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    if (!slot.tooltipState.pinned && !slot.tooltipState.programmatic) hideCoordinateTooltip(slot);
    return;
  }

  const dataIndex = slot.chartRawIndices[tooltip.dataPoints[0].dataIndex] ?? (currentWindow(slot).start + tooltip.dataPoints[0].dataIndex);
  const effectiveIndex = slot.tooltipState.keyboard && slot.tooltipState.dataIndex >= 0
    ? slot.tooltipState.dataIndex
    : dataIndex;
  if (slot.tooltipState.pinned && !slot.tooltipState.programmatic && effectiveIndex !== slot.tooltipState.dataIndex) {
    scheduleTooltipRestore(slot, slot.tooltipState.dataIndex);
    return;
  }
  const visible = slot.measures.filter(m => m.visible);
  if (!visible.length || effectiveIndex < 0) return;
  activeTooltipSlotId = slot.id;
  if (slot.tooltipState.renderedIndex !== effectiveIndex) {
    panel.innerHTML = buildCoordinateTooltipHtml(effectiveIndex, visible);
    slot.tooltipState.renderedIndex = effectiveIndex;
    if (!slot.tooltipState.pinned || slot.tooltipState.programmatic) {
      slot.tooltipState.dataIndex = effectiveIndex;
    }
  } else if (!slot.tooltipState.pinned || slot.tooltipState.programmatic) {
    slot.tooltipState.dataIndex = effectiveIndex;
  }
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
  positionCoordinateTooltip(slot, context.chart, tooltip);
}

function hideCoordinateTooltip(slot, force = false) {
  const panel = slot.tooltip;
  if (!panel) return;
  if (slot.tooltipState.pinned && !force) return;
  if (force) slot.tooltipState.pinned = false;
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden', 'true');
  slot.tooltipState.active = false;
  slot.tooltipState.dataIndex = -1;
  slot.tooltipState.renderedIndex = -1;
  slot.tooltipState.keyboard = false;
  slot.tooltipState.programmatic = false;
  slot.chart?.tooltip?.setActiveElements?.([], { x: 0, y: 0 });
  slot.chart?.setActiveElements?.([]);
  slot.chart?.draw?.();
  if (slot.tooltipState.restoreFrame) {
    cancelAnimationFrame(slot.tooltipState.restoreFrame);
    slot.tooltipState.restoreFrame = 0;
  }
  if (force && slot.tooltipState.raf) {
    cancelAnimationFrame(slot.tooltipState.raf);
    slot.tooltipState.raf = 0;
  }
}

function scheduleTooltipRestore(slot, dataIndex) {
  if (slot.tooltipState.restoreFrame) cancelAnimationFrame(slot.tooltipState.restoreFrame);
  slot.tooltipState.restoreFrame = requestAnimationFrame(() => {
    slot.tooltipState.restoreFrame = 0;
    showTooltipAtDataIndex(slot, dataIndex);
  });
}

function showTooltipAtDataIndex(slot, dataIndex) {
  if (!slot.chart || !slot.sampleLabels.length) return false;
  const visible = slot.measures.filter(m => m.visible);
  if (!visible.length) return false;

  const index = clamp(Math.round(dataIndex), 0, slot.sampleLabels.length - 1);
  ensureDataIndexVisible(slot, index);
  const localIndex = nearestChartLocalIndex(slot, index);
  const datasetIndex = firstVisibleLineDatasetIndex(slot);
  if (datasetIndex < 0) return false;

  const xScale = slot.chart.scales.x;
  const yScale = slot.chart.scales.y;
  const x = xScale?.getPixelForValue?.(localIndex) ?? slot.chart.chartArea.left;
  const yValue = slot.chart.data.datasets[datasetIndex]?.data?.[localIndex];
  const y = yScale?.getPixelForValue?.(Number.isFinite(yValue) ? yValue : 50) ?? ((slot.chart.chartArea.top + slot.chart.chartArea.bottom) / 2);

  activeTooltipSlotId = slot.id;
  slot.tooltipState.programmatic = true;
  slot.tooltipState.keyboard = true;
  slot.tooltipState.dataIndex = index;
  slot.tooltipState.renderedIndex = index;
  renderManualTooltip(slot, index, x);
  slot.chart.setActiveElements?.([{ datasetIndex, index: localIndex }]);
  slot.chart.tooltip?.setActiveElements?.([{ datasetIndex, index: localIndex }], { x, y });
  slot.chart.update('none');
  slot.tooltipState.programmatic = false;
  return true;
}

function nearestChartLocalIndex(slot, dataIndex) {
  const rawIndices = slot.chartRawIndices;
  if (!rawIndices.length) return 0;
  let low = 0;
  let high = rawIndices.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rawIndices[mid] < dataIndex) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(rawIndices[low - 1] - dataIndex) <= Math.abs(rawIndices[low] - dataIndex)) return low - 1;
  return low;
}

function renderManualTooltip(slot, dataIndex, caretX = null) {
  const visible = slot.measures.filter(m => m.visible);
  if (!slot.tooltip || !visible.length) return;
  slot.tooltip.innerHTML = buildCoordinateTooltipHtml(dataIndex, visible);
  slot.tooltip.classList.add('show');
  slot.tooltip.setAttribute('aria-hidden', 'false');
  positionManualTooltip(slot, caretX);
}

function positionManualTooltip(slot, caretX = null) {
  if (!slot.chart || !slot.tooltip) return;
  const chartArea = slot.chart.chartArea;
  const x = Number.isFinite(caretX)
    ? caretX
    : slot.chart.scales.x?.getPixelForValue?.(nearestChartLocalIndex(slot, slot.tooltipState.dataIndex)) ?? chartArea.left;
  positionCoordinateTooltip(slot, slot.chart, {
    caretX: x,
    chartArea
  });
}

function firstVisibleLineDatasetIndex(slot) {
  return slot.chart?.data.datasets.findIndex(dataset =>
    dataset.metaMeasure
    && slot.measures.includes(dataset.metaMeasure)
    && dataset.metaMeasure.visible
  ) ?? -1;
}

function ensureDataIndexVisible(slot, index) {
  const total = slot.sampleLabels.length;
  if (!total) return;
  const width = Math.max(1, slot.xView.end - slot.xView.start + 1);
  let start = slot.xView.start;
  let end = slot.xView.end;
  if (index < start) {
    start = index;
    end = start + width - 1;
  } else if (index > end) {
    end = index;
    start = end - width + 1;
  }
  start = clamp(start, 0, Math.max(0, total - width));
  end = clamp(start + width - 1, 0, total - 1);
  if (start !== slot.xView.start || end !== slot.xView.end) {
    slot.xView = { start, end };
    renderChart(slot);
    renderNavigator(slot);
    renderDataTable(false);
  }
}

function positionCoordinateTooltip(slot, chartInstance, tooltip) {
  const panel = slot.tooltip;
  const canvasBox = chartInstance.canvas.getBoundingClientRect();
  const chartArea = chartInstance.chartArea || { top: 0, bottom: canvasBox.height };
  const viewportPadding = 8;
  const caretX = canvasBox.left + tooltip.caretX;
  const maxWidth = Math.min(620, window.innerWidth - viewportPadding * 2);

  panel.style.maxWidth = `${maxWidth}px`;
  panel.style.left = '0px';
  panel.style.top = '0px';

  const rawWidth = Math.min(panel.offsetWidth || 460, maxWidth);
  const rawHeight = panel.offsetHeight || 360;
  const scale = Math.min(1, (window.innerWidth - viewportPadding * 2) / rawWidth, (window.innerHeight - viewportPadding * 2) / rawHeight);
  const panelWidth = rawWidth * scale;
  const panelHeight = rawHeight * scale;
  const canPlaceRight = caretX + panelWidth + 14 < window.innerWidth - viewportPadding;
  let left = canPlaceRight ? caretX + 12 : caretX - panelWidth - 12;
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - panelWidth - viewportPadding));

  // Keep the coordinate tooltip vertically stable while following the sampled X position.
  const chartTop = canvasBox.top + chartArea.top;
  const chartHeight = Math.max(0, chartArea.bottom - chartArea.top);
  const preferredTop = chartTop + chartHeight * 0.38;
  const top = Math.max(
    viewportPadding,
    Math.min(preferredTop, window.innerHeight - panelHeight - viewportPadding)
  );

  panel.style.left = '0px';
  panel.style.top = '0px';
  setTooltipTarget(slot, left, top, scale);
}

function setTooltipTarget(slot, x, y, scale) {
  const state = slot.tooltipState;
  state.targetX = x;
  state.targetY = y;
  state.targetScale = scale;
  if (state.keyboard) {
    state.x = x;
    state.y = y;
    state.scale = scale;
    state.active = true;
    applyTooltipTransform(slot);
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    return;
  }
  if (!state.active) {
    state.x = x;
    state.y = y;
    state.scale = scale;
    state.active = true;
    applyTooltipTransform(slot);
  }
  if (!state.raf) state.raf = requestAnimationFrame(() => animateTooltip(slot));
}

function animateTooltip(slot) {
  const state = slot.tooltipState;
  state.raf = 0;
  if (!state.active || !slot.tooltip?.classList.contains('show')) return;

  const ease = 0.28;
  state.x += (state.targetX - state.x) * ease;
  state.y += (state.targetY - state.y) * ease;
  state.scale += (state.targetScale - state.scale) * ease;

  const dx = Math.abs(state.targetX - state.x);
  const dy = Math.abs(state.targetY - state.y);
  const ds = Math.abs(state.targetScale - state.scale);
  if (dx < 0.35 && dy < 0.35 && ds < 0.003) {
    state.x = state.targetX;
    state.y = state.targetY;
    state.scale = state.targetScale;
  }
  applyTooltipTransform(slot);

  if (dx >= 0.35 || dy >= 0.35 || ds >= 0.003) {
    state.raf = requestAnimationFrame(() => animateTooltip(slot));
  }
}

function applyTooltipTransform(slot) {
  if (!slot.tooltip) return;
  const state = slot.tooltipState;
  slot.tooltip.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
}

function buildCoordinateTooltipHtml(dataIndex, visible) {
  const byGroup = groupMeasures(visible);
  const orderedGroups = knownGroups.map(g => g.name).filter(g => byGroup.has(g));
  const groups = orderedGroups.map(group => {
    const items = byGroup.get(group).map(m => {
      const value = m.values[dataIndex];
      const valueHtml = value === null || Number.isNaN(value)
        ? '<span class="tip-missing">-</span>'
        : `<span class="tip-value">${fmt(value)}</span>`;
      return `
        <div class="tip-row" style="--series-color:${m.color}">
          ${valueHtml}
          <span class="tip-unit">${escapeHtml(m.unit || '-')}</span>
          <span class="tip-name">${escapeHtml(m.name)}</span>
        </div>
      `;
    }).join('');
    return `
      <section class="tip-group">
        <div class="tip-group-title">
          <span>${escapeHtml(group)}</span>
          <small>${byGroup.get(group).length}</small>
        </div>
        ${items}
      </section>
    `;
  }).join('');

  return `
    <div class="tip-body">${groups}</div>
  `;
}

function moveTooltipByKeyboard(direction) {
  const slot = activeTooltipSlot();
  if (!slot || !slot.sampleLabels.length) return;
  const visible = slot.measures.filter(m => m.visible);
  if (!visible.length) return;

  const currentIndex = slot.tooltipState.dataIndex >= 0
    ? slot.tooltipState.dataIndex
    : (slot.xView.start + Math.floor((slot.xView.end - slot.xView.start) / 2));
  const nextIndex = clamp(currentIndex + direction, 0, slot.sampleLabels.length - 1);
  showTooltipAtDataIndex(slot, nextIndex);
}

function toggleTooltipPin() {
  const slot = activeTooltipSlot();
  if (!slot) return;
  if (!slot.sampleLabels.length) return;
  const visible = slot.measures.filter(m => m.visible);
  if (!visible.length) return;

  if (slot.tooltipState.pinned) {
    slot.tooltipState.pinned = false;
    hideCoordinateTooltip(slot, true);
    return;
  }

  slot.tooltipState.pinned = true;
  if (slot.tooltipState.dataIndex < 0) {
    const mid = slot.xView.start + Math.floor((slot.xView.end - slot.xView.start) / 2);
    showTooltipAtDataIndex(slot, mid);
  } else {
    showTooltipAtDataIndex(slot, slot.tooltipState.dataIndex);
  }
}

function shouldHandleTooltipShortcut(event) {
  const target = event.target;
  if (!target) return true;
  const tag = target.tagName;
  return !target.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag);
}


function renderDataTable(force = false) {
  if (!els.dataTableWrap) return;
  if (!force && !els.dataTablePanel.classList.contains('open')) return;
  const slots = activeSlots();
  const visible = slots.flatMap(slot => slot.measures.filter(m => m.visible));
  if (!visible.length) {
    els.dataTableWrap.className = 'data-table-wrap empty';
    els.dataTableWrap.textContent = allMeasures().length ? '没有开启的数据流' : '请先上传日志文件';
    return;
  }

  const groups = [];
  const compare = isCompareMode();
  for (const slot of slots) {
    const slotVisible = slot.measures.filter(m => m.visible);
    if (slotVisible.length) groups.push({ name: compare ? `${slot.label} · ${slot.sourceName || 'LOG'}` : 'Data Stream', slot, items: slotVisible });
  }
  const flat = groups.flatMap(g => g.items.map(item => ({ ...item, sourceSlot: g.slot })));
  const headerGroups = groups.map(g => `<th colspan="${g.items.length}">${escapeHtml(g.name)}</th>`).join('');
  const headerMeasures = flat.map(m => `
    <th class="dt-measure" style="color:${m.color}">
      <span>${escapeHtml(m.name)}</span>
      <small>[ ${escapeHtml(m.unit || '-')} ]</small>
    </th>
  `).join('');
  const maxRows = Math.max(...groups.map(g => currentWindow(g.slot).labels.length));
  const displayRows = Math.min(maxRows, MAX_TABLE_ROWS);
  const bodyRows = Array.from({ length: displayRows }, (_, offset) => {
    return `
    <tr>
      ${flat.map(m => {
        const win = currentWindow(m.sourceSlot);
        const rowIndex = win.start + offset;
        return `<td>${offset < win.labels.length ? fmt(m.values[rowIndex]) : '-'}</td>`;
      }).join('')}
    </tr>
  `;
  }).join('');

  els.dataTableWrap.className = 'data-table-wrap';
  els.dataTableWrap.innerHTML = `
    ${maxRows > displayRows ? `<div class="table-limit-note">当前视窗 ${maxRows} 行，表格仅显示前 ${displayRows} 行以保持流畅，可用导航条缩小区间后查看完整局部数据。</div>` : ''}
    <table class="data-table">
      <thead>
        <tr>${headerGroups}</tr>
        <tr>${headerMeasures}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function toggleDataTable() {
  const open = !els.dataTablePanel.classList.contains('open');
  els.dataTablePanel.classList.toggle('open', open);
  els.dataTablePanel.setAttribute('aria-hidden', String(!open));
  els.dataTableToggle.classList.toggle('active', open);
  const label = els.dataTableToggle.querySelector('span');
  if (label) label.textContent = open ? '收起表格' : '展开表格';
  if (open) renderDataTable();
}

function renderStats() {
  const visible = allMeasures().filter(m => m.visible);
  els.visibleCount.textContent = `${visible.length} visible`;
  if (!visible.length) {
    els.statsTable.className = 'stats-table empty';
    els.statsTable.textContent = '没有开启的曲线';
    return;
  }
  els.statsTable.className = 'stats-table';
  els.statsTable.innerHTML = `
    <div class="stat-row header">
      <span></span><span>Measure</span><span>Min</span><span>Max</span><span>Avg</span><span>Unit</span>
    </div>
    ${visible.map(m => `
      <div class="stat-row">
        <span class="stat-color" style="background:${m.color}"></span>
        <span class="stat-name" title="${escapeHtml(isCompareMode() ? `${m.slotLabel} · ${m.name}` : m.name)}">${escapeHtml(isCompareMode() ? `${m.slotLabel} · ${m.name}` : m.name)}</span>
        <span class="stat-value">${fmt(m.min)}</span>
        <span class="stat-value">${fmt(m.max)}</span>
        <span class="stat-value">${fmt(m.avg)}</span>
        <span>${escapeHtml(m.unit || '-')}</span>
      </div>
    `).join('')}
  `;
}

function setDrawerOpen(open) {
  document.body.classList.toggle('drawer-open', open);
  els.controlDrawer.classList.toggle('open', open);
  els.drawerToggle.classList.toggle('open', open);
  els.controlDrawer.setAttribute('aria-hidden', String(!open));
  scheduleResize();
}

function closeDrawer() { setDrawerOpen(false); }

function toggleDrawer() { setDrawerOpen(!els.controlDrawer.classList.contains('open')); }

function updateEmptyState() {
  const hasData = activeSlots().length > 0;
  const compare = isCompareMode();
  els.emptyState.style.display = hasData ? 'none' : 'flex';
  els.canvasWrap.classList.toggle('with-navigator', hasData);
  els.canvasWrap.classList.toggle('compare-mode', compare);
  els.logGrid.classList.toggle('has-data', hasData);
  els.logGrid.classList.toggle('compare-mode', compare);
  for (const slot of logSlots) {
    slot.root.hidden = slot.id === 'compare' && !compare;
  }
  els.reloadAllBtn.hidden = !hasData;
  els.loadCompareBtn.hidden = !hasData || compare;
}

function updateChartTitle() {
  const primary = findSlot('primary');
  els.chartTitle.textContent = isCompareMode() ? 'LOG 对比' : (primary.sourceName || 'Data Stream');
}

function resetSlot(slot) {
  hideCoordinateTooltip(slot, true);
  slot.chart?.destroy();
  slot.navigatorChart?.destroy();
  slot.chart = null;
  slot.navigatorChart = null;
  slot.measures = [];
  slot.sampleLabels = [];
  slot.sourceName = '';
  slot.strategy = '';
  slot.xView = { start: 0, end: 0 };
  slot.navDrag = null;
  if (slot.layoutFrame) cancelAnimationFrame(slot.layoutFrame);
  slot.renderFrame = 0;
  slot.layoutFrame = 0;
  slot.renderTableOnFrame = false;
  slot.tooltipState = createTooltipState();
  slot.title.textContent = '等待加载';
  slot.loadButton.textContent = slot.id === 'primary' ? '重新加载' : '加载对比';
  slot.root.classList.remove('ready');
  slot.navigator.classList.remove('ready');
  slot.navigator.setAttribute('aria-hidden', 'true');
  slot.rangeMeta.textContent = '区间 --';
  updateNavigatorSelection(slot);
}

function reloadAllLogs() {
  for (const slot of logSlots) resetSlot(slot);
  updateParseProgress('拖入或点击上传LOG文件（支持2份LOG对比）');
  updateEmptyState();
  renderGlobalViews({ immediate: true });
}

function openSlotFilePicker(slot) {
  pendingSlotId = slot.id;
  els.slotFileInput.click();
}


function exportVisibleCsv() {
  const visible = allMeasures().filter(m => m.visible);
  if (!visible.length) return;
  const headers = visible.map(m => `${m.slotLabel} ${m.name}${m.unit ? ` [${m.unit}]` : ''}`);
  const lines = [headers.map(csvEscape).join(',')];
  const windows = new Map(activeSlots().map(slot => [slot.id, currentWindow(slot)]));
  const maxRows = Math.max(...[...windows.values()].map(win => win.labels.length));
  for (let i = 0; i < maxRows; i++) {
    lines.push(visible.map(m => {
      const win = windows.get(m.slotId);
      const rowIndex = win.start + i;
      return csvEscape(i < win.labels.length ? m.values[rowIndex] ?? '' : '');
    }).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `log-compare-visible.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

els.fileInput?.addEventListener('change', e => loadFiles(e.target.files));
els.slotFileInput?.addEventListener('change', e => loadFile(e.target.files[0], findSlot(pendingSlotId)));
els.loadCompareBtn?.addEventListener('click', () => openSlotFilePicker(findSlot('compare')));
els.reloadAllBtn?.addEventListener('click', reloadAllLogs);
for (const slot of logSlots) {
  slot.loadButton.addEventListener('click', () => openSlotFilePicker(slot));
}

for (const target of [els.emptyState].filter(Boolean)) {
  ['dragenter', 'dragover'].forEach(evt => target.addEventListener(evt, e => {
    e.preventDefault();
    target.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(evt => target.addEventListener(evt, e => {
    e.preventDefault();
    target.classList.remove('dragover');
  }));
  target.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    loadFiles(e.dataTransfer.files);
  });
}

function syncToggleAllButton() {
  const hasVisible = allMeasures().some(m => m.visible);
  els.toggleAllBtn.textContent = hasVisible ? '隐藏全部' : '显示全部';
}

els.toggleAllBtn.addEventListener('click', () => {
  const measures = allMeasures();
  const shouldHide = measures.some(m => m.visible);
  measures.forEach(m => { m.visible = !shouldHide; });
  refreshAfterVisibilityChange();
});
els.dataTableToggle.addEventListener('click', toggleDataTable);
els.exportCsvBtn.addEventListener('click', exportVisibleCsv);
els.showExtrema.addEventListener('change', () => activeSlots().forEach(renderChart));
els.showPoints.addEventListener('change', () => activeSlots().forEach(renderChart));
els.themeToggle?.addEventListener('click', toggleTheme);
els.drawerToggle.addEventListener('click', toggleDrawer);

for (const slot of logSlots) {
  slot.zoomInButton.addEventListener('click', () => zoomX(slot, 0.75));
  slot.zoomOutButton.addEventListener('click', () => zoomX(slot, 1.35));
  slot.navigatorTrack.addEventListener('wheel', e => {
    if (!slot.sampleLabels.length) return;
    e.preventDefault();
    const box = slot.navigatorTrack.getBoundingClientRect();
    zoomX(slot, e.deltaY > 0 ? 1.18 : 0.82, clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1));
  }, { passive: false });
  slot.chartCanvas.addEventListener('wheel', e => {
    if (!slot.sampleLabels.length) return;
    e.preventDefault();
    const box = slot.chartCanvas.getBoundingClientRect();
    zoomX(slot, e.deltaY > 0 ? 1.18 : 0.82, clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1));
  }, { passive: false });
  slot.chartCanvas.addEventListener('pointerenter', () => {
    activeTooltipSlotId = slot.id;
    if (slot.tooltipState.pinned) return;
    slot.tooltipState.keyboard = false;
  });
  slot.chartCanvas.addEventListener('pointermove', () => {
    activeTooltipSlotId = slot.id;
    if (!slot.tooltipState.pinned) slot.tooltipState.keyboard = false;
  });
  slot.navigatorTrack.addEventListener('pointerdown', e => {
    if (e.target.closest('.navigator-handle')) return;
    startNavigatorDrag(slot, 'move', e);
  });
  slot.navigatorLeftHandle.addEventListener('pointerdown', e => startNavigatorDrag(slot, 'left', e));
  slot.navigatorRightHandle.addEventListener('pointerdown', e => startNavigatorDrag(slot, 'right', e));
  for (const target of [slot.navigatorTrack, slot.navigatorLeftHandle, slot.navigatorRightHandle]) {
    target.addEventListener('pointermove', e => moveNavigatorDrag(slot, e));
    target.addEventListener('pointerup', e => stopNavigatorDrag(slot, e));
    target.addEventListener('pointercancel', e => stopNavigatorDrag(slot, e));
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDrawer();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!shouldHandleTooltipShortcut(e)) return;
    if (!activeSlots().length) return;
    e.preventDefault();
    moveTooltipByKeyboard(e.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (e.key === ' ') {
    if (!shouldHandleTooltipShortcut(e)) return;
    if (!activeSlots().length) return;
    e.preventDefault();
    toggleTooltipPin();
  }
});
function scheduleResize() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    for (const slot of activeSlots()) {
      hideCoordinateTooltip(slot, true);
      slot.chart?.resize();
      slot.navigatorChart?.resize();
      updateNavigatorSelection(slot);
    }
  });
}

window.addEventListener('resize', scheduleResize);
updateEmptyState();
renderGlobalViews({ immediate: true });
