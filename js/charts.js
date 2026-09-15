// กราฟวาดด้วย inline SVG ล้วน ๆ ไม่มี dependency ภายนอก จึงใช้งานออฟไลน์ได้
// ทุกข้อความใส่ผ่าน textContent (svgEl) จึงไม่มีทางแทรก HTML ได้

import { svgEl, el } from './dom.js';
import { formatMoney, formatNumber } from './format.js';

/** จานสีสงบตา ไล่โทนอุ่น-เย็นสลับกัน เพื่อให้ชิ้นติดกันต่างกันชัด */
export const PALETTE = [
  '#5b8c7e', '#c98a5b', '#7a8fbf', '#c26d6d', '#9b8bbd',
  '#589a9a', '#b8894f', '#6f9e6f', '#bf7fa3', '#8a8f6b',
  '#4f7fa8', '#a97b8c', '#75937d', '#c1996b', '#8092a8',
];

export function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

const NS = 'http://www.w3.org/2000/svg';

function makeSvg(width, height, extra = {}) {
  return svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    ...extra,
  });
}

function emptyChart(message) {
  return el('div', { class: 'chart-empty' }, message);
}

/**
 * กราฟโดนัท แบ่งตามประเภท พร้อมคำอธิบายด้านข้าง
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

  const total = rows.reduce((sum, d) => sum + d.value, 0);
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 96;
  const inner = 58;

  const svg = makeSvg(size, size, { 'aria-label': title || 'สัดส่วนตามประเภท' });
  let angle = -Math.PI / 2;

  rows.forEach((row, index) => {
    const fraction = row.value / total;
    const sweep = fraction * Math.PI * 2;
    const color = colorFor(index);

    // วงกลมเต็มวงวาดด้วย path ไม่ได้ ต้องใช้ ring สองวง
    const node = fraction > 0.9999
      ? svgEl('circle', {
          cx, cy, r: (outer + inner) / 2,
          fill: 'none',
          stroke: color,
          'stroke-width': outer - inner,
        })
      : svgEl('path', {
          d: donutSlicePath(cx, cy, inner, outer, angle, angle + sweep),
          fill: color,
        });

    const detail = row.rollup
      ? row.rollup.map((d) => `${d.name} ${formatMoney(d.value)}`).join('\n')
      : null;
    node.appendChild(svgEl('title', {
      text: `${row.name} ${formatMoney(row.value)} (${percent(fraction)})${detail ? `\n${detail}` : ''}`,
    }));
    if (onSlice && !row.rollup) {
      node.setAttribute('class', 'slice-tappable');
      node.addEventListener('click', () => onSlice(row));
    }
    svg.appendChild(node);
    angle += sweep;
  });

  svg.appendChild(svgEl('text', {
    x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'donut-total', text: formatNumber(total),
  }));
  svg.appendChild(svgEl('text', {
    x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'donut-caption', text: centerLabel || 'บาท',
  }));

  const legend = el('ul', { class: 'legend' },
    rows.map((row, index) => el('li', { class: 'legend-item' },
      el('span', { class: 'legend-dot', style: { background: colorFor(index) } }),
      el('span', { class: 'legend-name' }, row.name),
      el('span', { class: 'legend-value' }, `${formatNumber(row.value)} (${percent(row.value / total)})`),
    )));

  return el('div', { class: 'chart chart-donut' },
    el('div', { class: 'chart-canvas donut-canvas' }, svg),
    legend,
  );
}

function percent(fraction) {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
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

/**
 * กราฟแท่งคู่ รายรับ vs รายจ่าย — ใช้ได้ทั้งรายเดือนและรายวัน
 * @param {Array<{key:string, label:string, income:number, expense:number}>} items
 * @param {object} options
 * @param {Function} options.onSelect  เรียกเมื่อแตะแท่งของรายการนั้น
 * @param {string} options.highlight   key ของรายการที่ต้องการเน้น
 */
export function groupedBarChart(items, { onSelect = null, highlight = null } = {}) {
  const max = Math.max(1, ...items.map((m) => Math.max(m.income, m.expense)));
  const width = 720;
  const height = 260;
  const padLeft = 54;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const slot = plotW / items.length;
  const barW = Math.min(16, slot / 2.8);
  const gap = 3;

  const svg = makeSvg(width, height, { 'aria-label': 'รายรับและรายจ่ายรายเดือน' });

  // เส้นแนวนอนและป้ายแกน — ข้ามป้ายที่ค่าซ้ำกับเส้นก่อนหน้า
  // (ถ้าไม่ข้าม เดือนที่ยังไม่มีข้อมูลจะโชว์ "1 1 1 0 0" เพราะปัดเลขชนกัน)
  let lastLabel = null;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = padTop + plotH * (1 - t);
    svg.appendChild(svgEl('line', {
      x1: padLeft, y1: y, x2: width - padRight, y2: y, class: 'grid-line',
    }));
    const label = formatNumber(Math.round(max * t));
    if (label !== lastLabel) {
      svg.appendChild(svgEl('text', {
        x: padLeft - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label', text: label,
      }));
      lastLabel = label;
    }
  }

  items.forEach((m, index) => {
    const x = padLeft + slot * index + slot / 2;
    const isHot = highlight !== null && highlight === m.key;

    if (onSelect) {
      const hit = svgEl('rect', {
        x: padLeft + slot * index, y: padTop, width: slot, height: plotH,
        fill: 'transparent', class: 'bar-hit',
      });
      hit.appendChild(svgEl('title', {
        text: `${m.label} — รายรับ ${formatMoney(m.income)}, รายจ่าย ${formatMoney(m.expense)}`,
      }));
      hit.addEventListener('click', () => onSelect(m));
      svg.appendChild(hit);
    }

    if (isHot) {
      svg.appendChild(svgEl('rect', {
        x: padLeft + slot * index + 1, y: padTop, width: slot - 2, height: plotH,
        class: 'bar-highlight', rx: 6,
      }));
    }

    const bars = [
      { value: m.income, color: 'var(--income)', offset: -(barW + gap) / 2 - barW / 2 + barW / 2 - gap / 2 },
      { value: m.expense, color: 'var(--expense)', offset: gap / 2 },
    ];
    bars[0].offset = -barW - gap / 2;

    for (const bar of bars) {
      const h = (bar.value / max) * plotH;
      if (h <= 0) continue;
      svg.appendChild(svgEl('rect', {
        x: x + bar.offset, y: padTop + plotH - h, width: barW, height: Math.max(h, 1.5),
        fill: bar.color, rx: 3, 'pointer-events': 'none',
      }));
    }

    svg.appendChild(svgEl('text', {
      x, y: height - padBottom + 18, 'text-anchor': 'middle',
      class: isHot ? 'axis-label axis-label-strong' : 'axis-label',
      text: m.label, 'pointer-events': 'none',
    }));
  });

  return el('div', { class: 'chart chart-bars' },
    el('div', { class: 'chart-canvas' }, svg),
    el('div', { class: 'legend legend-inline' },
      legendChip('รายรับ', 'var(--income)'),
      legendChip('รายจ่าย', 'var(--expense)'),
    ),
  );
}

function legendChip(label, color) {
  return el('span', { class: 'legend-item' },
    el('span', { class: 'legend-dot', style: { background: color } }),
    el('span', { class: 'legend-name' }, label),
  );
}

/**
 * กราฟเส้นยอดคงเหลือรายวัน
 * @param {Array<{day:number, balance:number}>} points
 */
export function lineChart(points, { label = 'ยอดคงเหลือรายวัน' } = {}) {
  if (points.length === 0) return emptyChart('ยังไม่มีข้อมูลสำหรับเดือนนี้');

  const width = 720;
  const height = 210;
  const padLeft = 58;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => p.balance);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const x = (day) => padLeft + (plotW * (day - points[0].day)) / Math.max(1, points[points.length - 1].day - points[0].day);
  const y = (value) => padTop + plotH * (1 - (value - min) / (max - min));

  const svg = makeSvg(width, height, { 'aria-label': label });

  for (const t of [0, 0.5, 1]) {
    const value = min + (max - min) * t;
    const yy = y(value);
    svg.appendChild(svgEl('line', { x1: padLeft, y1: yy, x2: width - padRight, y2: yy, class: 'grid-line' }));
    svg.appendChild(svgEl('text', {
      x: padLeft - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis-label', text: formatNumber(Math.round(value)),
    }));
  }

  // เส้นศูนย์ ถ้ายอดเคยติดลบ
  if (min < 0 && max > 0) {
    svg.appendChild(svgEl('line', {
      x1: padLeft, y1: y(0), x2: width - padRight, y2: y(0), class: 'zero-line',
    }));
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.day).toFixed(2)} ${y(p.balance).toFixed(2)}`).join(' ');
  const area = `${path} L ${x(points[points.length - 1].day).toFixed(2)} ${y(Math.max(min, 0)).toFixed(2)} L ${x(points[0].day).toFixed(2)} ${y(Math.max(min, 0)).toFixed(2)} Z`;

  svg.appendChild(svgEl('path', { d: area, class: 'line-area' }));
  svg.appendChild(svgEl('path', { d: path, class: 'line-stroke' }));

  // จุดบนเส้น เฉพาะวันที่มีรายการ เพื่อไม่ให้รก
  for (const p of points) {
    if (!p.hasActivity) continue;
    const dot = svgEl('circle', { cx: x(p.day), cy: y(p.balance), r: 3.5, class: 'line-dot' });
    dot.appendChild(svgEl('title', { text: `วันที่ ${p.day} — ${formatMoney(p.balance)}` }));
    svg.appendChild(dot);
  }

  for (const day of axisDays(points)) {
    svg.appendChild(svgEl('text', {
      x: x(day), y: height - 8, 'text-anchor': 'middle', class: 'axis-label', text: String(day),
    }));
  }

  return el('div', { class: 'chart chart-line' }, el('div', { class: 'chart-canvas' }, svg));
}

function axisDays(points) {
  const first = points[0].day;
  const last = points[points.length - 1].day;
  const days = new Set([first, last]);
  for (let d = Math.ceil(first / 5) * 5; d < last; d += 5) days.add(d);
  return [...days].sort((a, b) => a - b);
}

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
