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
  fileMeta: document.getElementById('fileMeta'),
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
  exportShareBtn: document.getElementById('exportShareBtn'),
  chartTitle: document.getElementById('chartTitle'),
  emptyState: document.getElementById('emptyState'),
  coordinateTooltip: document.getElementById('coordinateTooltip'),
  canvasWrap: document.getElementById('canvasWrap'),
  canvas: document.getElementById('logChart'),
  chartNavigator: document.getElementById('chartNavigator'),
  navigatorCanvas: document.getElementById('navigatorCanvas'),
  navigatorTrack: document.getElementById('navigatorTrack'),
  navigatorSelection: document.getElementById('navigatorSelection'),
  navigatorLeftHandle: document.getElementById('navigatorLeftHandle'),
  navigatorRightHandle: document.getElementById('navigatorRightHandle'),
  rangeMeta: document.getElementById('rangeMeta'),
  xZoomInBtn: document.getElementById('xZoomInBtn'),
  xZoomOutBtn: document.getElementById('xZoomOutBtn')
};

let chart;
let navigatorChart;
let measures = [];
let sampleLabels = [];
let sourceName = '';
let currentTheme = localStorage.getItem('log-viewer-theme') || 'light';
let xView = { start: 0, end: 0 };
let navDrag = null;
let tooltipState = {
  dataIndex: -1,
  x: 0,
  y: 0,
  scale: 1,
  targetX: 0,
  targetY: 0,
  targetScale: 1,
  raf: 0,
  active: false
};

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
  if (shouldRender && chart) renderChart();
}

function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

async function loadFile(file) {
  if (!file) return;
  sourceName = file.name;
  updateParseProgress(`读取文件：${file.name} (${Math.round(file.size / 1024)} KB)`);
  try {
    const data = await readFile(file);
    updateParseProgress('识别编码与表格结构…');
    const parsed = parseFileData(file, data);
    if (!parsed.measures.length) throw new Error('没有找到可绘图的数值列');
    setData(parsed.measures, parsed.sampleLabels);
    updateParseProgress(`已载入：${file.name}｜${parsed.sampleLabels.length} 个采样点｜${parsed.measures.length} 条数据流｜${parsed.strategy}`);
    els.fileInput.value = '';
  } catch (err) {
    console.error(err);
    updateParseProgress(`解析失败：${err.message || err}`);
    els.fileInput.value = '';
    alert('文件解析失败，请确认是有效的 CSV/XLSX 日志。');
  }
}

const updateParseProgress = message => { els.fileMeta.textContent = message; };

function parseFileData(file, data) {
  const isTextTable = /\.(csv|txt|tsv)$/i.test(file.name);
  if (isTextTable) {
    const text = decodeText(data);
    const delimiter = guessDelimiter(text);
    updateParseProgress(`识别编码与分隔符：${delimiterName(delimiter)}｜提取数据名称和数值列…`);
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
  updateParseProgress(`识别到 ${workbook.SheetNames.length} 个工作表｜提取数据名称和数值列…`);

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
    const nums = bucketItems
      .flatMap(m => m.values)
      .filter(v => v !== null && Number.isFinite(v));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
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
  // Higher-priority semantic buckets first.
  if (['空燃比', 'afr', 'lambda', 'air fuel', 'a/f', '混合气', 'fuel trim', 'equivalence'].some(k => s.includes(k))) return 'AFR';
  if (['点火', 'ignition', 'knk', 'knock', 'retard', '延迟角', '正时', 'timing', 'iga'].some(k => s.includes(k))) return 'Ignition';
  if (['燃油', 'fuel', 'rail', '喷油', '油压'].some(k => s.includes(k))) return 'Fuel';
  if (['温度', 'temperature', 'temp', '*c', '°c'].some(k => s.includes(k))) return 'Temperature';
  return knownGroups.find(g => g.keys.length && g.keys.some(k => s.includes(k.toLowerCase())))?.name || 'Other';
}

function setData(newMeasures, labels) {
  rebuildNormalizedValues(newMeasures);
  measures = newMeasures;
  sampleLabels = labels;
  resetXView();
  syncToggleAllButton();
  els.emptyState.style.display = 'none';
  els.canvasWrap.classList.add('with-navigator');
  els.chartNavigator.classList.add('ready');
  els.chartNavigator.setAttribute('aria-hidden', 'false');
  hideCoordinateTooltip(true);
  renderViews();
}

function restoreSharedLog(payload) {
  if (!payload?.sampleLabels?.length || !payload?.measures?.length) throw new Error('分享数据格式无效');
  sourceName = payload.name || payload.sourceName || `log-${payload.id || 'shared'}`;
  const restored = payload.measures.map((m, index) => makeMeasure({
    name: m.name || `Measure ${index + 1}`,
    unit: m.unit || '',
    values: Array.isArray(m.values) ? m.values.map(v => toNumber(v)) : [],
    color: m.color || palette[index % palette.length]
  }));
  restored.forEach((m, index) => {
    if (payload.measures[index]?.visible === false) m.visible = false;
  });
  setData(restored, payload.sampleLabels.map(String));
  updateParseProgress(`已载入分享 LOG：${sourceName}｜${payload.sampleLabels.length} 个采样点｜${restored.length} 条数据流`);
}

function renderViews() {
  renderMeasureControls();
  renderChart();
  renderNavigator();
  renderStats();
  renderDataTable();
}

function refreshAfterVisibilityChange() {
  hideCoordinateTooltip(true);
  renderViews();
}

function renderMeasureControls() {
  els.measureCount.textContent = measures.length;
  syncToggleAllButton();
  els.measureGroups.classList.remove('empty');
  els.measureGroups.innerHTML = '';
  const byGroup = groupMeasures(measures);
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
      refreshAfterVisibilityChange();
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
        refreshAfterVisibilityChange();
      });
      wrap.appendChild(item);
    }
    els.measureGroups.appendChild(wrap);
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

function resetXView() {
  xView = { start: 0, end: Math.max(0, sampleLabels.length - 1) };
}

function currentWindow() {
  const total = sampleLabels.length;
  if (!total) return { start: 0, end: 0, labels: [] };
  const start = clamp(Math.round(xView.start), 0, total - 1);
  const end = clamp(Math.round(xView.end), start, total - 1);
  return { start, end, labels: sampleLabels.slice(start, end + 1) };
}

function setXView(start, end, shouldRender = true) {
  const total = sampleLabels.length;
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
  xView = {
    start: clamp(nextStart, 0, total - 1),
    end: clamp(nextEnd, 0, total - 1)
  };
  if (shouldRender) {
    hideCoordinateTooltip(true);
    renderChart();
    renderNavigator();
    renderDataTable();
  }
}

function zoomX(factor, anchorRatio = 0.5) {
  const total = sampleLabels.length;
  if (!total) return;
  const width = xView.end - xView.start + 1;
  const nextWidth = clamp(Math.round(width * factor), Math.min(total, 8), total);
  const anchor = xView.start + (width - 1) * anchorRatio;
  setXView(anchor - (nextWidth - 1) * anchorRatio, anchor + (nextWidth - 1) * (1 - anchorRatio));
}

function rangeText() {
  if (!sampleLabels.length) return '区间 --';
  return `${xView.start + 1} - ${xView.end + 1} / ${sampleLabels.length}`;
}

function renderChart() {
  const visible = measures.filter(m => m.visible);
  hideCoordinateTooltip(true);
  const colors = themeColors();
  const win = currentWindow();
  const datasets = visible.map(m => ({
    label: `${m.name}${m.unit ? ` (${m.unit})` : ''}`,
    data: m.normalized.slice(win.start, win.end + 1),
    borderColor: m.color,
    backgroundColor: m.color,
    borderWidth: 2.2,
    pointRadius: els.showPoints.checked ? 2 : 0,
    pointHoverRadius: 5,
    tension: 0.15,
    spanGaps: true,
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
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: renderCoordinateTooltip }
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

  if (!chart) {
    chart = new Chart(els.canvas, { type: 'line', data: { labels: win.labels, datasets }, options });
  } else {
    chart.data.labels = win.labels;
    chart.data.datasets = datasets;
    chart.options = options;
    chart.update();
  }
  els.chartTitle.textContent = sourceName || 'Data Stream';
}

function markerDataset(m, type, index, y, rawValue, win = currentWindow()) {
  const inView = index >= win.start && index <= win.end;
  return {
    label: `${m.name} ${type} ${fmt(rawValue)}`,
    data: win.labels.map((_, i) => inView && i === index - win.start ? y : null),
    borderColor: 'transparent',
    backgroundColor: m.color,
    pointRadius: 4,
    pointHoverRadius: 7,
    showLine: false,
    metaMeasure: m
  };
}

function renderNavigator() {
  if (!els.navigatorCanvas || !sampleLabels.length) return;
  const visible = measures.filter(m => m.visible);
  const datasets = visible.map(m => ({
    data: m.normalized,
    borderColor: m.color,
    backgroundColor: m.color,
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.12,
    spanGaps: true
  }));
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
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

  if (!navigatorChart) {
    navigatorChart = new Chart(els.navigatorCanvas, { type: 'line', data: { labels: sampleLabels, datasets }, options });
  } else {
    navigatorChart.data.labels = sampleLabels;
    navigatorChart.data.datasets = datasets;
    navigatorChart.options = options;
    navigatorChart.update('none');
  }
  updateNavigatorSelection();
  if (els.rangeMeta) els.rangeMeta.textContent = rangeText();
}

function updateNavigatorSelection() {
  if (!els.navigatorSelection || sampleLabels.length < 2) return;
  const max = sampleLabels.length - 1;
  const left = (xView.start / max) * 100;
  const right = 100 - (xView.end / max) * 100;
  els.navigatorSelection.style.left = `${left}%`;
  els.navigatorSelection.style.width = `${Math.max(0, 100 - left - right)}%`;
}

function pointerToSampleIndex(event) {
  const box = els.navigatorTrack.getBoundingClientRect();
  const ratio = clamp((event.clientX - box.left) / Math.max(1, box.width), 0, 1);
  return ratio * Math.max(0, sampleLabels.length - 1);
}

function startNavigatorDrag(mode, event) {
  if (!sampleLabels.length) return;
  event.preventDefault();
  const startIndex = pointerToSampleIndex(event);
  navDrag = {
    mode,
    pointerId: event.pointerId,
    startIndex,
    start: xView.start,
    end: xView.end
  };
  els.navigatorTrack.classList.add('dragging');
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveNavigatorDrag(event) {
  if (!navDrag) return;
  const current = pointerToSampleIndex(event);
  const delta = Math.round(current - navDrag.startIndex);
  if (navDrag.mode === 'left') setXView(current, xView.end, false);
  else if (navDrag.mode === 'right') setXView(xView.start, current, false);
  else setXView(navDrag.start + delta, navDrag.end + delta, false);
  renderChart();
  renderNavigator();
  renderDataTable();
}

function stopNavigatorDrag(event) {
  if (!navDrag) return;
  try { event.currentTarget.releasePointerCapture?.(navDrag.pointerId); } catch { /* ignore */ }
  navDrag = null;
  els.navigatorTrack.classList.remove('dragging');
}

function renderCoordinateTooltip(context) {
  const tooltip = context.tooltip;
  const panel = els.coordinateTooltip;
  if (!panel) return;

  if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    hideCoordinateTooltip();
    return;
  }

  const dataIndex = currentWindow().start + tooltip.dataPoints[0].dataIndex;
  const visible = measures.filter(m => m.visible);
  if (!visible.length || dataIndex < 0) return;
  if (tooltipState.dataIndex !== dataIndex) {
    panel.innerHTML = buildCoordinateTooltipHtml(dataIndex, visible);
    tooltipState.dataIndex = dataIndex;
  }
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
  positionCoordinateTooltip(context.chart, tooltip);
}

function hideCoordinateTooltip(force = false) {
  const panel = els.coordinateTooltip;
  if (!panel) return;
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden', 'true');
  tooltipState.active = false;
  tooltipState.dataIndex = -1;
  if (force && tooltipState.raf) {
    cancelAnimationFrame(tooltipState.raf);
    tooltipState.raf = 0;
  }
}

function positionCoordinateTooltip(chartInstance, tooltip) {
  const panel = els.coordinateTooltip;
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
  setTooltipTarget(left, top, scale);
}

function setTooltipTarget(x, y, scale) {
  tooltipState.targetX = x;
  tooltipState.targetY = y;
  tooltipState.targetScale = scale;
  if (!tooltipState.active) {
    tooltipState.x = x;
    tooltipState.y = y;
    tooltipState.scale = scale;
    tooltipState.active = true;
    applyTooltipTransform();
  }
  if (!tooltipState.raf) tooltipState.raf = requestAnimationFrame(animateTooltip);
}

function animateTooltip() {
  tooltipState.raf = 0;
  if (!tooltipState.active || !els.coordinateTooltip?.classList.contains('show')) return;

  const ease = 0.28;
  tooltipState.x += (tooltipState.targetX - tooltipState.x) * ease;
  tooltipState.y += (tooltipState.targetY - tooltipState.y) * ease;
  tooltipState.scale += (tooltipState.targetScale - tooltipState.scale) * ease;

  const dx = Math.abs(tooltipState.targetX - tooltipState.x);
  const dy = Math.abs(tooltipState.targetY - tooltipState.y);
  const ds = Math.abs(tooltipState.targetScale - tooltipState.scale);
  if (dx < 0.35 && dy < 0.35 && ds < 0.003) {
    tooltipState.x = tooltipState.targetX;
    tooltipState.y = tooltipState.targetY;
    tooltipState.scale = tooltipState.targetScale;
  }
  applyTooltipTransform();

  if (dx >= 0.35 || dy >= 0.35 || ds >= 0.003) {
    tooltipState.raf = requestAnimationFrame(animateTooltip);
  }
}

function applyTooltipTransform() {
  if (!els.coordinateTooltip) return;
  els.coordinateTooltip.style.transform = `translate3d(${tooltipState.x}px, ${tooltipState.y}px, 0) scale(${tooltipState.scale})`;
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


function renderDataTable() {
  if (!els.dataTableWrap) return;
  const visible = measures.filter(m => m.visible);
  if (!visible.length) {
    els.dataTableWrap.className = 'data-table-wrap empty';
    els.dataTableWrap.textContent = measures.length ? '没有开启的数据流' : '请先上传日志文件';
    return;
  }

  const groups = [];
  const byGroup = groupMeasures(visible);
  const win = currentWindow();
  for (const groupName of knownGroups.map(g => g.name)) {
    const items = byGroup.get(groupName) || [];
    if (items.length) groups.push({ name: groupName, items });
  }
  const flat = groups.flatMap(g => g.items);
  const headerGroups = groups.map(g => `<th colspan="${g.items.length}">${escapeHtml(g.name)}</th>`).join('');
  const headerMeasures = flat.map(m => `
    <th class="dt-measure" style="color:${m.color}">
      <span>${escapeHtml(m.name)}</span>
      <small>[ ${escapeHtml(m.unit || '-')} ]</small>
    </th>
  `).join('');
  const bodyRows = win.labels.map((label, offset) => {
    const rowIndex = win.start + offset;
    return `
    <tr>
      ${flat.map(m => `<td>${fmt(m.values[rowIndex])}</td>`).join('')}
    </tr>
  `;
  }).join('');

  els.dataTableWrap.className = 'data-table-wrap';
  els.dataTableWrap.innerHTML = `
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
  const visible = measures.filter(m => m.visible);
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
        <span class="stat-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
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
  setTimeout(() => chart?.resize(), 240);
}

function closeDrawer() { setDrawerOpen(false); }

function toggleDrawer() { setDrawerOpen(!els.controlDrawer.classList.contains('open')); }


function exportVisibleCsv() {
  const visible = measures.filter(m => m.visible);
  if (!visible.length) return;
  const headers = visible.map(m => `${m.name}${m.unit ? ` [${m.unit}]` : ''}`);
  const lines = [headers.map(csvEscape).join(',')];
  for (let i = 0; i < sampleLabels.length; i++) {
    lines.push(visible.map(m => csvEscape(m.values[i] ?? '')).join(','));
  }
  downloadText(`${(sourceName || 'datalog').replace(/\.[^.]+$/, '')}-visible.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
}

function exportSharePackage() {
  if (!measures.length) return;
  const id = createShareId();
  const payload = buildSharePayload(id);
  const json = JSON.stringify(payload, null, 2);
  const html = buildShareIndexHtml(id);
  const readme = [
    `ECU Log Viewer 分享包：${id}`,
    '',
    '使用方式：',
    '1. 解压本 ZIP 到 GitHub Pages 仓库根目录。',
    `2. 确认存在 log/${id}/data.json 和 log/${id}/index.html。`,
    '3. 提交并 push 到 GitHub。',
    `4. 分享链接：你的 GitHub Pages 域名/log/${id}/`,
    '',
    `主页面也可直接访问：?log=${id}`
  ].join('\n');
  downloadBlob(`log-${id}.zip`, buildZipBlob([
    { path: `log/${id}/data.json`, text: json },
    { path: `log/${id}/index.html`, text: html },
    { path: `log/${id}/README.txt`, text: readme }
  ]));
  updateParseProgress(`分享包已生成：解压 log-${id}.zip 到 GitHub Pages 仓库根目录即可分享`);
}

function createShareId() {
  if (crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function buildSharePayload(id) {
  return {
    version: 1,
    id,
    name: sourceName || 'ECU LOG',
    createdAt: new Date().toISOString(),
    sampleLabels,
    measures: measures.map(m => ({
      name: m.name,
      unit: m.unit,
      color: m.color,
      visible: m.visible,
      values: m.values
    }))
  };
}

function buildShareIndexHtml(id) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>ECU Log ${escapeHtml(id)}</title></head>
<body>
<script>
location.replace('../../?log=${encodeURIComponent(id)}');
</script>
</body>
</html>
`;
}

function downloadText(filename, text, type) {
  downloadBlob(filename, new Blob([text], { type }));
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const localHeader = zipHeader([
      0x04034b50, 20, 0x0800, 0, 0, 0, crc, data.length, data.length, name.length, 0
    ], [4, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2]);
    localParts.push(localHeader, name, data);

    const centralHeader = zipHeader([
      0x02014b50, 20, 20, 0x0800, 0, 0, 0, crc, data.length, data.length,
      name.length, 0, 0, 0, 0, 0, offset
    ], [4, 2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4]);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipHeader([
    0x06054b50, 0, 0, files.length, files.length, centralSize, offset, 0
  ], [4, 2, 2, 2, 2, 4, 4, 2]);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function zipHeader(values, sizes) {
  const length = sizes.reduce((sum, size) => sum + size, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  let offset = 0;
  values.forEach((value, index) => {
    const size = sizes[index];
    if (size === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value >>> 0, true);
    offset += size;
  });
  return out;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function loadSharedLogFromUrl() {
  const id = new URLSearchParams(location.search).get('log');
  if (!id) return;
  if (!/^[a-z0-9_-]{3,64}$/i.test(id)) {
    updateParseProgress('分享 LOG ID 格式无效');
    return;
  }
  updateParseProgress(`正在加载分享 LOG：${id}`);
  try {
    const res = await fetch(`./log/${encodeURIComponent(id)}/data.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    restoreSharedLog(await res.json());
  } catch (err) {
    console.error(err);
    updateParseProgress(`分享 LOG 加载失败：请确认 log/${id}/data.json 已部署到 GitHub Pages`);
  }
}

function csvEscape(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

els.fileInput?.addEventListener('change', e => loadFile(e.target.files[0]));

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
    loadFile(e.dataTransfer.files[0]);
  });
}

function syncToggleAllButton() {
  const hasVisible = measures.some(m => m.visible);
  els.toggleAllBtn.textContent = hasVisible ? '隐藏全部' : '显示全部';
}

els.toggleAllBtn.addEventListener('click', () => {
  const shouldHide = measures.some(m => m.visible);
  measures.forEach(m => { m.visible = !shouldHide; });
  refreshAfterVisibilityChange();
});
els.dataTableToggle.addEventListener('click', toggleDataTable);
els.exportCsvBtn.addEventListener('click', exportVisibleCsv);
els.exportShareBtn.addEventListener('click', exportSharePackage);
els.showExtrema.addEventListener('change', renderChart);
els.showPoints.addEventListener('change', renderChart);
els.themeToggle?.addEventListener('click', toggleTheme);
els.drawerToggle.addEventListener('click', toggleDrawer);
els.xZoomInBtn.addEventListener('click', () => zoomX(0.75));
els.xZoomOutBtn.addEventListener('click', () => zoomX(1.35));
els.navigatorTrack.addEventListener('wheel', e => {
  if (!sampleLabels.length) return;
  e.preventDefault();
  const box = els.navigatorTrack.getBoundingClientRect();
  zoomX(e.deltaY > 0 ? 1.18 : 0.82, clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1));
}, { passive: false });
els.canvas.addEventListener('wheel', e => {
  if (!sampleLabels.length) return;
  e.preventDefault();
  const box = els.canvas.getBoundingClientRect();
  zoomX(e.deltaY > 0 ? 1.18 : 0.82, clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1));
}, { passive: false });
els.navigatorTrack.addEventListener('pointerdown', e => {
  if (e.target.closest('.navigator-handle')) return;
  startNavigatorDrag('move', e);
});
els.navigatorLeftHandle.addEventListener('pointerdown', e => startNavigatorDrag('left', e));
els.navigatorRightHandle.addEventListener('pointerdown', e => startNavigatorDrag('right', e));
for (const target of [els.navigatorTrack, els.navigatorLeftHandle, els.navigatorRightHandle]) {
  target.addEventListener('pointermove', moveNavigatorDrag);
  target.addEventListener('pointerup', stopNavigatorDrag);
  target.addEventListener('pointercancel', stopNavigatorDrag);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
window.addEventListener('resize', () => { hideCoordinateTooltip(true); chart?.resize(); navigatorChart?.resize(); updateNavigatorSelection(); });

loadSharedLogFromUrl();
