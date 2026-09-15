// ตัวช่วยสร้าง DOM อย่างปลอดภัย
// กฎของโปรเจกต์: ห้ามใส่ข้อมูลของผู้ใช้หรือข้อมูลที่นำเข้าลง innerHTML แบบดิบ ๆ

/** แปลงอักขระพิเศษของ HTML — ใช้เมื่อจำเป็นต้องต่อสตริงเป็น HTML จริง ๆ เท่านั้น */
export function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * สร้าง element
 * el('div', { class: 'card', onclick: fn }, 'ข้อความ')
 * ข้อความลูกทุกตัวถูกใส่ด้วย textContent เสมอ จึงปลอดภัยโดยปริยาย
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** ล้างลูกทั้งหมดแล้วใส่ชุดใหม่ */
export function replace(node, ...children) {
  node.textContent = '';
  append(node, children);
  return node;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

/** สร้าง element ใน namespace ของ SVG */
export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}
