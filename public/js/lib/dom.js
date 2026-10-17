/* ============================================================
   Small DOM toolkit: element builder, icons, toasts, dialogs, formatting.
   Everything that renders user or Drive data goes through h() / text
   nodes, never innerHTML, so file names cannot inject markup.
   ============================================================ */
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'value') value = v;                    // set after children so <select> has its options
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

/** replaceChildren() that skips null/false, so optional children can be written inline. */
export function fill(el, ...children) {
  if (!el) return el;
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/* ---------- formatting ---------- */
export function fmtSize(b) {
  const n = +b;
  if (!n) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export function fmtDate(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
}

export function relTime(v) {
  const d = toDate(v);
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [lim, div, unit] of [[60, 1, 'second'], [3600, 60, 'minute'], [86400, 3600, 'hour'], [2592000, 86400, 'day'], [31536000, 2592000, 'month']]) {
    if (s < lim) return rtf.format(-Math.round(s / div), unit);
  }
  return rtf.format(-Math.round(s / 31536000), 'year');
}

export const fmtSession = (s) => (s && /^\d{4}(-\d{2})?$/.test(s) ? `${s.slice(0, 4)}–${s.length > 4 ? s.slice(5) : String(+s + 1).slice(2)}` : s || '');
export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
export const initials = (name) => (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ---------- toasts ---------- */
export function toast(message, kind = 'info', ms = 4200) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const ico = { info: 'info', ok: 'check', error: 'alert', warn: 'alert' }[kind] || 'info';
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(ico), h('span', { text: message }));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- dialogs ---------- */
export function modal({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const dlg = h('dialog', { class: `modal glass ${wide ? 'modal-wide' : ''} ${className}`.trim(), 'aria-label': title });
  const close = () => { if (dlg.open) dlg.close(); };
  const head = h('header', { class: 'modal-head' },
    h('h2', { text: title }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')));
  const foot = actions.length ? h('footer', { class: 'modal-foot' }, actions) : null;
  dlg.append(head, h('div', { class: 'modal-body' }, body), foot || '');
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

/** Resolves to the entered text (or true) when confirmed, null when cancelled. */
export function ask({ title, message, confirm = 'Confirm', danger = false, input = null, minLength = 0 }) {
  return new Promise((resolve) => {
    let done = false;
    const field = input ? h('textarea', { class: 'input', rows: 3, placeholder: input, maxlength: 1000 }) : null;
    const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', text: confirm });
    const m = modal({
      title,
      body: [h('p', { class: 'muted', text: message }), field],
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => m.close() }), ok],
      onClose: () => { if (!done) resolve(null); }
    });
    ok.onclick = () => {
      if (field && field.value.trim().length < minLength) { field.focus(); field.classList.add('shake'); setTimeout(() => field.classList.remove('shake'), 400); return; }
      done = true; resolve(field ? field.value.trim() : true); m.close();
    };
    (field || ok).focus();
  });
}

export function copyText(text, label = 'Link copied') {
  navigator.clipboard?.writeText(text).then(() => toast(label, 'ok'), () => toast('Could not copy', 'error'));
}

export function skeletonRows(n = 6, cols = 3) {
  return Array.from({ length: n }, () => h('div', { class: 'sk-row' }, Array.from({ length: cols }, (_, i) => h('span', { style: { width: i ? '14%' : '52%' } }))));
}

export function emptyState(ic, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon(ic)), h('h3', { text: title }), text ? h('p', { text }) : null, action || null);
}
