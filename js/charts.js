// กราฟวาดด้วย inline SVG ล้วน ๆ ไม่มี dependency ภายนอก จึงใช้งานออฟไลน์ได้
// ทุกข้อความใส่ผ่าน textContent (svgEl) จึงไม่มีทางแทรก HTML ได้
//
// กราฟแท่งและกราฟเส้นวาดตามความกว้างจริงของจอ (1 หน่วย SVG = 1 px)
// เดิมใช้ viewBox กว้าง 720 แล้วย่อลงจอ ทำให้ตัวหนังสือบนแกนเหลือแค่ 6px บน iPhone

import { svgEl, el, replace } from './dom.js';
import { formatMoney, formatNumber } from './format.js';
import { UNCATEGORISED } from './model.js';

/**
 * จานสีสำหรับแยกประเภท — ลำดับนี้ผ่านการตรวจด้วย validate_palette ครบทุกขนาดวง
 * (2–7 ชิ้น รวมคู่ที่วนจากชิ้นสุดท้ายกลับมาชิ้นแรก) ทั้งความต่างของสีสำหรับคนตาบอดสี
 * และสายตาปกติ ห้ามสลับลำดับหรือเติมสีเองโดยไม่ตรวจซ้ำ
 * ค่าจริงอยู่ใน styles.css (--series-1 ถึง --series-7) เพื่อให้สลับโหมดมืดได้ในที่เดียว
 */
export const SERIES_COUNT = 7;
const seriesVar = (slot) => `var(--series-${slot + 1})`;

const AXIS_FONT_PX = 12;
const AXIS_FONT_MIN_PX = 11;

function emptyChart(message) {
  return el('div', { class: 'chart-empty' }, message);
}

function percent(fraction) {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}

// ───────────────────────────────────────────────────────── เครื่องมือร่วม

/** วาดใหม่ทุกครั้งที่ความกว้างของกล่องเปลี่ยน */
function responsive(container, draw) {
  let lastWidth = 0;
  const render = (width) => {
    const w = Math.floor(width);
    if (w <= 0 || w === lastWidth) return;
    lastWidth = w;
    replace(container, draw(w));
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver((entries) => {
      // กล่องถูกถอดออกจากหน้าแล้ว (เปลี่ยนหน้า) — เลิกติดตาม
      if (!container.isConnected) {
        observer.disconnect();
        return;
      }
      render(entries[0].contentRect.width);
    });
    observer.observe(container);
  } else {
    requestAnimationFrame(() => render(container.clientWidth || 320));
  }
}

let measureCtx = null;
/** วัดความกว้างตัวหนังสือจริง เพื่อวางป้ายโดยไม่ทับกัน */
function textWidth(text, sizePx) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return String(text).length * sizePx * 0.6;
  const family = getComputedStyle(document.body).fontFamily || 'system-ui';
  measureCtx.font = `${sizePx}px ${family}`;
  return measureCtx.measureText(String(text)).width;
}

const COMPACT = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });
/** ป้ายแกน: ตั้งแต่ 1,000 ขึ้นไปย่อเป็น 1K 2.5K 20K */
function tickLabel(value) {
  return Math.abs(value) >= 1000 ? COMPACT.format(value) : formatNumber(value);
}

/** ช่วงแกนตัวเลขกลม ๆ (1 / 2 / 2.5 / 5 × 10ⁿ) ประมาณ `count` ช่อง */
function niceScale(min, max, count = 3) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

/** แท่งมุมมนเฉพาะปลาย ฐานติดเส้นศูนย์เป็นมุมฉาก */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

/** ขนาดตัวหนังสือแกน x ที่ใส่ลงช่องได้ และควรแสดงทุกป้ายหรือเว้นป้าย */
function fitLabels(labels, slotWidth) {
  for (const size of [AXIS_FONT_PX, AXIS_FONT_MIN_PX]) {
    const widest = Math.max(...labels.map((l) => textWidth(l, size)));
    if (widest <= slotWidth - 2) return { size, every: 1 };
  }
  const widest = Math.max(...labels.map((l) => textWidth(l, AXIS_FONT_MIN_PX)));
  return { size: AXIS_FONT_MIN_PX, every: Math.ceil((widest + 4) / slotWidth) };
}

function legendChip(label, swatch) {
  return el('span', { class: 'legend-item' },
    el('span', { class: 'legend-dot', style: { background: swatch } }),
    el('span', { class: 'legend-name' }, label),
  );
}

// ─────────────────────────────────────────────────────────── กราฟโดนัท

let patternId = 0;

/**
 * กราฟโดนัทแบ่งตามประเภท พร้อมคำอธิบายด้านข้าง
 * "ไม่ระบุประเภท" เป็นสีเทาลายเส้นทแยง และ "อื่น ๆ" เป็นสีเทาเรียบ
 * ทั้งสองไม่กินช่องสีของประเภทจริง
 * @param {Array<{name:string, value:number}>} data
 */
export function donutChart(data, { title = '', onSlice = null, centerLabel = '', maxSlices = 8 } = {}) {
  const all = data.filter((d) => d.value > 0);
  if (all.length === 0) return emptyChart('ยังไม่มีข้อมูลสำหรับเดือนนี้');

  // ชิ้นเล็ก ๆ จำนวนมากทำให้อ่านยาก ยุบส่วนที่เหลือเป็น "อื่น ๆ" ชิ้นเดียว
  const rows = all.length > maxSlices
    ? [
        ...all.slice(0, maxSlices - 1),
        {
          name: `อื่น ๆ (${all.length - maxSlices + 1} ประเภท)`,
          value: all.slice(maxSlices - 1).reduce((sum, d) => sum + d.value, 0),
          rollup: all.slice(maxSlices - 1),
        },
      ]
    : all;

  // ช่องสีแจกตามลำดับให้เฉพาะประเภทจริง เทาไม่นับเป็นช่อง
  let slot = 0;
  const hatchId = `donut-none-${++patternId}`;
  for (const row of rows) {
    if (row.name === UNCATEGORISED) row.swatch = { fill: `url(#${hatchId})`, css: 'none' };
    else if (row.rollup) row.swatch = { fill: 'var(--chart-other)', css: 'other' };
    else {
      row.swatch = { fill: seriesVar(slot), css: seriesVar(slot) };
      slot = Math.min(slot + 1, SERIES_COUNT - 1);
    }
  }

  const total = rows.reduce((sum, d) => sum + d.value, 0);
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 96;
  const inner = 58;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, width: '100%', height: '100%',
    preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': title || 'สัดส่วนตามประเภท',
  });

  // ลายเส้นทแยงสำหรับ "ไม่ระบุประเภท" — สื่อว่ายังทำไม่เสร็จ และแยกจาก "อื่น ๆ" ได้โดยไม่ต้องพึ่งสี
  svg.appendChild(svgEl('defs', {},
    svgEl('pattern', { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svgEl('rect', { width: 6, height: 6, class: 'hatch-base' }),
      svgEl('rect', { width: 2.5, height: 6, class: 'hatch-line' }),
    ),
  ));

  let angle = -Math.PI / 2;
  for (const row of rows) {
    const fraction = row.value / total;
    const sweep = fraction * Math.PI * 2;

    // วงกลมเต็มวงวาดด้วย path ไม่ได้ ต้องใช้ ring สองวง
    const node = fraction > 0.9999
      ? svgEl('circle', {
          cx, cy, r: (outer + inner) / 2, fill: 'none',
          style: `stroke: ${row.swatch.fill}; stroke-width: ${outer - inner}px`,
        })
      : svgEl('path', {
          d: donutSlicePath(cx, cy, inner, outer, angle, angle + sweep),
          class: 'donut-slice',
          style: `fill: ${row.swatch.fill}`,
        });

    const detail = row.rollup
      ? row.rollup.map((d) => `${d.name} ${formatMoney(d.value)}`).join('\n')
      : null;
    node.appendChild(svgEl('title', {
      text: `${row.name} ${formatMoney(row.value)} (${percent(fraction)})${detail ? `\n${detail}` : ''}`,
    }));
    if (onSlice && !row.rollup) {
      node.classList.add('slice-tappable');
      node.addEventListener('click', () => onSlice(row));
    }
    svg.appendChild(node);
    angle += sweep;
  }

  svg.appendChild(svgEl('text', {
    x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'donut-total', text: formatNumber(total),
  }));
  svg.appendChild(svgEl('text', {
    x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'donut-caption', text: centerLabel || 'บาท',
  }));

  const legend = el('ul', { class: 'legend' },
    rows.map((row) => el('li', { class: 'legend-item' },
      el('span', {
        class: `legend-dot ${row.swatch.css === 'none' ? 'legend-dot-none' : ''} ${row.swatch.css === 'other' ? 'legend-dot-other' : ''}`,
        style: row.swatch.css.startsWith('var(') ? { background: row.swatch.css } : null,
      }),
      el('span', { class: 'legend-name' }, row.name),
      el('span', { class: 'legend-value' }, `${formatNumber(row.value)} (${percent(row.value / total)})`),
    )));

  return el('div', { class: 'chart chart-donut' },
    el('div', { class: 'chart-canvas donut-canvas' }, svg),
    legend,
  );
}

function donutSlicePath(cx, cy, inner, outer, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(outer, start);
  const [x2, y2] = p(outer, end);
  const [x3, y3] = p(inner, end);
  const [x4, y4] = p(inner, start);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// ────────────────────────────────────────────────────────── กราฟแท่งคู่

/**
 * กราฟแท่งคู่ รายรับ vs รายจ่าย — ใช้ได้ทั้งรายเดือนและรายวัน
 * @param {Array<{key:string, label:string, income:number, expense:number}>} items
 * @param {object} options
 * @param {Function} options.onSelect  เรียกเมื่อแตะแท่งของรายการนั้น
 * @param {string} options.highlight   key ของรายการที่ต้องการเน้น
 * @param {number} options.height      ความสูงเป็น px
 */
export function groupedBarChart(items, { onSelect = null, highlight = null, height = 190 } = {}) {
  const canvas = el('div', { class: 'chart-canvas' });
  responsive(canvas, (width) => drawBars(width, height, items, { onSelect, highlight }));

  return el('div', { class: 'chart chart-bars' },
    canvas,
    el('div', { class: 'legend legend-inline' },
      legendChip('รายรับ', 'var(--income)'),
      legendChip('รายจ่าย', 'var(--expense)'),
    ),
  );
}

function drawBars(width, height, items, { onSelect, highlight }) {
  const max = Math.max(0, ...items.map((m) => Math.max(m.income, m.expense)));
  const { hi, ticks } = niceScale(0, max || 1, 3);
  const tickTexts = ticks.map(tickLabel);
  const padLeft = Math.ceil(Math.max(...tickTexts.map((t) => textWidth(t, AXIS_FONT_PX)))) + 10;
  const padRight = 4;
  const padTop = 8;
  const padBottom = 24;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;
  const slot = plotW / items.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(14, (slot - 8 - gap) / 2));
  const y = (v) => padTop + plotH * (1 - v / hi);

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': 'รายรับและรายจ่าย', class: 'chart-svg',
  });

  ticks.forEach((t, i) => {
    svg.appendChild(svgEl('line', { x1: padLeft, y1: y(t), x2: width - padRight, y2: y(t), class: 'grid-line' }));
    svg.appendChild(svgEl('text', {
      x: padLeft - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label', text: tickTexts[i],
    }));
  });

  const fit = fitLabels(items.map((m) => m.label), slot);

  items.forEach((m, index) => {
    const x0 = padLeft + slot * index;
    const cxSlot = x0 + slot / 2;
    const isHot = highlight !== null && highlight === m.key;

    if (isHot) {
      svg.appendChild(svgEl('rect', {
        x: x0 + 1, y: padTop, width: slot - 2, height: plotH, rx: 6, class: 'bar-highlight',
      }));
    }

    for (const [value, kind, dx] of [[m.income, 'income', -gap / 2 - barW], [m.expense, 'expense', gap / 2]]) {
      const h = (value / hi) * plotH;
      if (h <= 0) continue;
      const hh = Math.max(h, 1.5);
      svg.appendChild(svgEl('path', {
        d: barPath(cxSlot + dx, padTop + plotH - hh, barW, hh, 4),
        class: `bar bar-${kind}`, 'pointer-events': 'none',
      }));
    }

    if (index % fit.every === 0 || isHot) {
      svg.appendChild(svgEl('text', {
        x: cxSlot, y: height - 7, 'text-anchor': 'middle',
        class: isHot ? 'axis-label axis-label-strong' : 'axis-label',
        style: `font-size: ${fit.size}px`, text: m.label, 'pointer-events': 'none',
      }));
    }

    // พื้นที่แตะกว้างทั้งช่อง ใหญ่กว่าตัวแท่ง
    if (onSelect) {
      const hit = svgEl('rect', {
        x: x0, y: 0, width: slot, height, fill: 'transparent', class: 'bar-hit',
      });
      hit.appendChild(svgEl('title', {
        text: `${m.label} — รายรับ ${formatMoney(m.income)}, รายจ่าย ${formatMoney(m.expense)}`,
      }));
      hit.addEventListener('click', () => onSelect(m));
      svg.appendChild(hit);
    }
  });

  return svg;
}

// ──────────────────────────────────────────────────────────── กราฟเส้น

/**
 * กราฟเส้นยอดคงเหลือรายวัน
 * @param {Array<{day:number, balance:number, hasActivity?:boolean}>} points
 */
export function lineChart(points, { label = 'ยอดคงเหลือรายวัน', height = 180 } = {}) {
  if (points.length === 0) return emptyChart('ยังไม่มีข้อมูลสำหรับเดือนนี้');
  const canvas = el('div', { class: 'chart-canvas' });
  responsive(canvas, (width) => drawLine(width, height, points, label));
  return el('div', { class: 'chart chart-line' }, canvas);
}

function drawLine(width, height, points, label) {
  const values = points.map((p) => p.balance);
  // ไม่บังคับให้แกนเริ่มที่ 0 — ยอดคงเหลือหลักหมื่นที่ขยับทีละร้อยจะเห็นเป็นเส้นแบนราบ
  // ถ้าทั้งเดือนไม่ขยับเลย ขยายช่วงออกเล็กน้อยเพื่อไม่ให้หารด้วยศูนย์
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  if (vMax - vMin < 1) {
    const pad = Math.max(100, Math.abs(vMax) * 0.05);
    vMin -= pad;
    vMax += pad;
  }
  const { lo, hi, ticks } = niceScale(vMin, vMax, 3);
  const tickTexts = ticks.map(tickLabel);
  const padLeft = Math.ceil(Math.max(...tickTexts.map((t) => textWidth(t, AXIS_FONT_PX)))) + 10;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 24;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;

  const first = points[0].day;
  const last = points[points.length - 1].day;
  const x = (day) => padLeft + (plotW * (day - first)) / Math.max(1, last - first);
  const y = (v) => padTop + plotH * (1 - (v - lo) / (hi - lo));

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, class: 'chart-svg',
  });

  ticks.forEach((t, i) => {
    svg.appendChild(svgEl('line', {
      x1: padLeft, y1: y(t), x2: width - padRight, y2: y(t), class: t === 0 && lo < 0 ? 'zero-line' : 'grid-line',
    }));
    svg.appendChild(svgEl('text', {
      x: padLeft - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label', text: tickTexts[i],
    }));
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.day).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  // พื้นใต้เส้นลงไปถึงขอบล่างของกราฟ (ไม่ใช่เส้น 0 ซึ่งอาจอยู่นอกกรอบ)
  const base = y(lo);
  svg.appendChild(svgEl('path', {
    d: `${path} L ${x(last).toFixed(1)} ${base.toFixed(1)} L ${x(first).toFixed(1)} ${base.toFixed(1)} Z`,
    class: 'line-area',
  }));
  svg.appendChild(svgEl('path', { d: path, class: 'line-stroke' }));

  // จุดเฉพาะวันที่มีรายการ เพื่อไม่ให้รก
  for (const p of points) {
    if (!p.hasActivity) continue;
    const dot = svgEl('circle', { cx: x(p.day), cy: y(p.balance), r: 4, class: 'line-dot' });
    dot.appendChild(svgEl('title', { text: `วันที่ ${p.day} — ${formatMoney(p.balance)}` }));
    svg.appendChild(dot);
  }

  // ป้ายวันที่: วันแรก วันสุดท้าย และทุก 5 วัน — ข้ามป้ายที่จะชนกัน
  const days = new Set([first, last]);
  for (let d = Math.ceil(first / 5) * 5; d < last; d += 5) days.add(d);
  let lastRight = -Infinity;
  for (const d of [...days].sort((a, b) => a - b)) {
    const w = textWidth(String(d), AXIS_FONT_PX);
    const cxLabel = x(d);
    if (cxLabel - w / 2 < lastRight + 6 && d !== last) continue;
    lastRight = cxLabel + w / 2;
    svg.appendChild(svgEl('text', {
      x: cxLabel, y: height - 7, 'text-anchor': 'middle', class: 'axis-label', text: String(d),
    }));
  }

  return svg;
}

// ───────────────────────────────────────────────────────── แถบความคืบหน้า

/** แถบความคืบหน้าของงบ — คุมค่าให้อยู่ใน 0..1 และเปลี่ยนสีเมื่อเกินงบ */
export function progressBar(actual, budget) {
  const ratio = budget > 0 ? actual / budget : 0;
  const over = budget > 0 && actual > budget;
  const width = Math.max(0, Math.min(1, ratio)) * 100;
  return el('div', {
    class: `progress ${over ? 'progress-over' : ''}`,
    role: 'progressbar',
    'aria-valuenow': String(Math.round(ratio * 100)),
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, el('div', { class: 'progress-fill', style: { width: `${width}%` } }));
}
