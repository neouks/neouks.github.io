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
  chartTitle: document.getElementById('chartTitle'),
  emptyState: document.getElementById('emptyState'),
  coordinateTooltip: document.getElementById('coordinateTooltip'),
  canvas: document.getElementById('logChart')
};

let chart;
let measures = [];
let sampleLabels = [];
let sourceName = '';
let currentTheme = localStorage.getItem('log-viewer-theme') || 'light';
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (!s || /^[-–—]$/.test(s)) return null;
  if (/[\u4e00-\u9fff]/.test(s)) return null;
  s = s
    .replace(/[％%]$/, '')
    .replace(/\s+/g, '');

  const numericPattern = /^[-+]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:[.,]\d+)?(?:e[-+]?\d+)?(?:%|°|℃|°c|c|v|mv|a|ma|bar|mbar|hpa|kpa|pa|psi|nm|n·m|rpm|\/min|r\/min|km\/h|lambda|afr)?$/i;
  if (!numericPattern.test(s)) return null;

  let numericText = s.match(/^[-+]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:[.,]\d+)?(?:e[-+]?\d+)?/i)?.[0];
  if (!numericText) return null;
  if ((numericText.match(/,/g) || []).length === 1 && !numericText.includes('.')) numericText = numericText.replace(',', '.');
  else numericText = numericText.replace(/,/g, '');
  const n = Number(numericText);
  return Number.isFinite(n) ? n : null;
}

function looksNumeric(v) {
  return toNumber(v) !== null;
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function isSkippedDataColumn(name) {
  return /^(时间|time|timestamp|date|日期|sec|秒|记录值|插入标记号|marker|mark|sample|index|序号)$/i.test(String(name ?? '').trim());
}

function isUnitLike(value) {
  const t = compactText(value).toLowerCase();
  if (!t) return false;
  if (t.length > 24) return false;
  return /^(\/min|rpm|r\/min|km\/h|mph|%|°|deg|°c|℃|\*c|c|v|mv|a|ma|bar|mbar|hpa|kpa|pa|psi|nm|n·m|kg\/h|g\/s|mg\/str|lambda|afr|ms|s|kw|hp|l\/h|ohm|Ω)$/i.test(t)
    || /^[a-z%°℃Ω\/\.·-]{1,12}$/i.test(t);
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
    const isTextTable = /\.(csv|txt|tsv)$/i.test(file.name);
    const text = isTextTable ? decodeText(data) : '';
    const workbook = isTextTable
      ? XLSX.read(text, { type: 'string', raw: true, dense: false, FS: guessDelimiter(text) })
      : XLSX.read(data, { type: 'array', raw: true, cellDates: true, dense: false });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    updateParseProgress('提取数据名称和数值列…');
    const parsed = parseRows(rows);
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

function updateParseProgress(message) {
  if (els.fileMeta) els.fileMeta.textContent = message;
}

function guessDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean).slice(0, 12);
  const delimiters = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of delimiters) {
    const counts = lines.map(line => splitSimpleDelimitedLine(line, delimiter).length).filter(n => n > 1);
    if (!counts.length) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, n) => sum + Math.abs(n - avg), 0) / counts.length;
    const score = avg * 2 - variance;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
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

function parseRows(rows) {
  const normalizedRows = normalizeRows(rows);
  if (!normalizedRows.length) throw new Error('文件为空');
  const pairedProfile = detectPairedValueProfile(normalizedRows);
  if (pairedProfile) return buildSeriesFromPairedProfile(normalizedRows, pairedProfile);
  const profile = detectTableProfile(normalizedRows);
  return buildSeriesFromProfile(normalizedRows, profile);
}

function detectPairedValueProfile(rows) {
  const stats = rows.map(rowStats);
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

function buildSeriesFromPairedProfile(rows, profile) {
  const dataRows = rows.slice(profile.dataStartIdx).filter(row => rowStats(row).numeric >= 1);
  const series = [];
  const labels = dataRows.map((_, i) => `#${i + 1}`);
  const nameRow = rows[profile.nameRowIdx] || [];
  const unitRow = profile.unitRowIdx >= 0 ? rows[profile.unitRowIdx] || [] : [];

  for (let c = 0; c < nameRow.length; c++) {
    const name = cleanName(nameRow[c]);
    if (!name || isSkippedDataColumn(name) || isUnitLike(name)) continue;
    const nextLabel = compactText(nameRow[c + 1]).toLowerCase();
    const prevLabel = compactText(nameRow[c - 1]).toLowerCase();
    const likelyValueColumn = prevLabel === '记录值' || prevLabel === 'value'
      || nextLabel === '记录值' || nextLabel === 'value'
      || unitRow[c];
    if (!likelyValueColumn) continue;
    const values = dataRows.map(row => toNumber(row[c]));
    const count = values.filter(v => v !== null).length;
    if (count < Math.max(2, Math.ceil(dataRows.length * 0.08))) continue;
    const unit = compactText(unitRow[c] || '');
    series.push(makeMeasure({
      name,
      unit: isUnitLike(unit) ? unit : '',
      values,
      color: palette[series.length % palette.length]
    }));
  }

  if (!series.length) throw new Error('没有找到可绘图的数值列');
  return { measures: series, sampleLabels: labels };
}

function rowStats(row) {
  const cells = row || [];
  let nonBlank = 0;
  let numeric = 0;
  let unitLike = 0;
  let textLike = 0;
  for (const cell of cells) {
    if (isBlank(cell)) continue;
    nonBlank++;
    if (looksNumeric(cell)) numeric++;
    else {
      textLike++;
      if (isUnitLike(cell)) unitLike++;
    }
  }
  return { nonBlank, numeric, textLike, unitLike, numericRatio: nonBlank ? numeric / nonBlank : 0 };
}

function detectTableProfile(rows) {
  const stats = rows.map(rowStats);
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
    bestIdx = rows.findIndex((_, i) => stats.slice(i + 1, i + 6).filter(s => s.numeric >= 2).length >= 2);
  }
  if (bestIdx < 0) throw new Error('未找到可用的数据表头');

  const unitRowIdx = stats[bestIdx + 1]?.unitLike >= 1 && stats[bestIdx + 2]?.numericRatio >= 0.45 ? bestIdx + 1 : -1;
  const dataStartIdx = unitRowIdx >= 0 ? unitRowIdx + 1 : bestIdx + 1;
  const headerRows = [];
  if (bestIdx > 0 && stats[bestIdx - 1].textLike >= 2 && stats[bestIdx - 1].numericRatio < 0.35) headerRows.push(bestIdx - 1);
  headerRows.push(bestIdx);

  return { headerRows, unitRowIdx, dataStartIdx };
}

function buildSeriesFromProfile(rows, profile) {
  const dataRows = rows.slice(profile.dataStartIdx).filter(row => rowStats(row).numeric >= 1);
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
    const unit = profile.unitRowIdx >= 0 ? compactText(rows[profile.unitRowIdx]?.[c]) : '';
    const values = dataRows.map(row => toNumber(row[c]));
    const count = values.filter(v => v !== null).length;
    if (count < Math.max(2, Math.ceil(dataRows.length * 0.08))) continue;

    const name = rawName || inferNameFromColumn(rows, c) || `Column ${c + 1}`;
    if (isSkippedDataColumn(name)) continue;
    series.push(makeMeasure({
      name,
      unit: isUnitLike(unit) ? unit : '',
      values,
      color: palette[series.length % palette.length]
    }));
  }

  if (!series.length) throw new Error('没有找到可绘图的数值列');
  return { measures: series, sampleLabels: labels };
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
    normalized: buildAdaptiveWaveValues(values, nums, min, max)
  };
}

function buildAdaptiveWaveValues(values, nums, min, max) {
  const range = max - min;
  if (!range) return values.map(v => v === null ? null : 50);

  const center = median(nums);
  const medianAbs = median(nums.map(v => Math.abs(v)));
  const magnitude = Math.max(Math.abs(center), medianAbs, range * 0.35, 1e-9);
  const relativeWindow = 0.12;
  const compressionBase = Math.log1p(1 / relativeWindow);

  return values.map(v => {
    if (v === null || !Number.isFinite(v)) return null;
    const relativeDelta = (v - center) / magnitude;
    const signedCompressed = Math.sign(relativeDelta)
      * (Math.log1p(Math.abs(relativeDelta) / relativeWindow) / compressionBase);
    return clamp(50 + signedCompressed * 45, 2, 98);
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
  measures = newMeasures;
  sampleLabels = labels;
  syncToggleAllButton();
  els.emptyState.style.display = 'none';
  hideCoordinateTooltip(true);
  renderMeasureControls();
  renderChart();
  renderStats();
  renderDataTable();
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
      hideCoordinateTooltip(true);
      renderMeasureControls(); renderChart(); renderStats(); renderDataTable();
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
        hideCoordinateTooltip(true);
        renderMeasureControls(); renderChart(); renderStats(); renderDataTable();
      });
      wrap.appendChild(item);
    }
    els.measureGroups.appendChild(wrap);
  }
}

function groupMeasures(items) {
  const byGroup = new Map();
  for (const m of items) {
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }
  return byGroup;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

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

function renderChart() {
  const visible = measures.filter(m => m.visible);
  hideCoordinateTooltip(true);
  const colors = themeColors();
  const datasets = visible.map(m => ({
    label: `${m.name}${m.unit ? ` (${m.unit})` : ''}`,
    data: m.normalized,
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
      datasets.push(markerDataset(m, 'MAX', m.maxIndex, m.normalized[m.maxIndex], m.max));
      datasets.push(markerDataset(m, 'MIN', m.minIndex, m.normalized[m.minIndex], m.min));
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
    chart = new Chart(els.canvas, { type: 'line', data: { labels: sampleLabels, datasets }, options });
  } else {
    chart.data.labels = sampleLabels;
    chart.data.datasets = datasets;
    chart.options = options;
    chart.update();
  }
  els.chartTitle.textContent = sourceName || 'Data Stream';
}

function markerDataset(m, type, index, y, rawValue) {
  return {
    label: `${m.name} ${type} ${fmt(rawValue)}`,
    data: sampleLabels.map((_, i) => i === index ? y : null),
    borderColor: 'transparent',
    backgroundColor: m.color,
    pointRadius: 4,
    pointHoverRadius: 7,
    showLine: false,
    metaMeasure: m
  };
}

function renderCoordinateTooltip(context) {
  const tooltip = context.tooltip;
  const panel = els.coordinateTooltip;
  if (!panel) return;

  if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    hideCoordinateTooltip();
    return;
  }

  const dataIndex = tooltip.dataPoints[0].dataIndex;
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

  // Keep the Measures tooltip vertically stable while following the sampled X position.
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
  for (const groupName of knownGroups.map(g => g.name)) {
    const items = byGroup.get(groupName) || [];
    if (items.length) groups.push({ name: groupName, items });
  }
  const flat = groups.flatMap(g => g.items);
  const headerGroups = groups.map(g => `<th class="dt-group" colspan="${g.items.length}">${escapeHtml(g.name)}</th>`).join('');
  const headerMeasures = flat.map(m => `
    <th class="dt-measure" style="color:${m.color}">
      <span>${escapeHtml(m.name)}</span>
      <small>[ ${escapeHtml(m.unit || '-')} ]</small>
    </th>
  `).join('');
  const bodyRows = sampleLabels.map((label, rowIndex) => `
    <tr>
      ${flat.map(m => `<td>${fmt(m.values[rowIndex])}</td>`).join('')}
    </tr>
  `).join('');

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

function isDrawerOpen() {
  return els.controlDrawer.classList.contains('open');
}

function openDrawer() {
  document.body.classList.add('drawer-open');
  els.controlDrawer.classList.add('open');
  els.drawerToggle.classList.add('open');
  els.controlDrawer.setAttribute('aria-hidden', 'false');
  setTimeout(() => chart?.resize(), 240);
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
  els.controlDrawer.classList.remove('open');
  els.drawerToggle.classList.remove('open');
  els.controlDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => chart?.resize(), 240);
}

function toggleDrawer() {
  isDrawerOpen() ? closeDrawer() : openDrawer();
}


function exportVisibleCsv() {
  const visible = measures.filter(m => m.visible);
  if (!visible.length) return;
  const headers = visible.map(m => `${m.name}${m.unit ? ` [${m.unit}]` : ''}`);
  const lines = [headers.map(csvEscape).join(',')];
  for (let i = 0; i < sampleLabels.length; i++) {
    lines.push(visible.map(m => csvEscape(m.values[i] ?? '')).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(sourceName || 'datalog').replace(/\.[^.]+$/, '')}-visible.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  hideCoordinateTooltip(true);
  renderMeasureControls(); renderChart(); renderStats(); renderDataTable();
});
els.dataTableToggle.addEventListener('click', toggleDataTable);
els.exportCsvBtn.addEventListener('click', exportVisibleCsv);
els.showExtrema.addEventListener('change', renderChart);
els.showPoints.addEventListener('change', renderChart);
els.themeToggle?.addEventListener('click', toggleTheme);
els.drawerToggle.addEventListener('click', toggleDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
window.addEventListener('resize', () => { hideCoordinateTooltip(true); chart?.resize(); });
