// Drag-to-set price range. Bounds are % from the current price (lower below 0, upper above 0).
// The element persists between updates so a drag is never interrupted by a re-render.
import { h, usd } from './util.js';

const LOWER = [-95, -0.5], UPPER = [0.5, 500];
const clamp = (v, [a, b]) => Math.min(Math.max(v, a), b);
const round1 = (v) => Math.round(v * 10) / 10;
const shown = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`;

export function rangeEditor(onChange) {
  let lo = -8, hi = 8, price = 0, drag = null;
  const fill = h('div', { class: 're-fill' }), now = h('div', { class: 're-now' }), tag = h('div', { class: 're-price mono' });
  const handle = (label) => h('div', { class: 're-handle', role: 'slider', tabindex: 0, 'aria-label': label }, h('i'));
  const a = handle('Lower bound'), b = handle('Upper bound'), grip = h('div', { class: 're-grip', title: 'Drag to move the whole range' }, '⠿');
  const track = h('div', { class: 're-track' }, fill, now, tag, grip, a, b);
  const span = () => drag?.span ?? Math.max(Math.max(-lo, hi) * 1.35, 10);

  const set = (l, u) => { lo = l; hi = u; draw(); onChange(lo, hi); };
  function bound(title, limit, get, apply) {
    const price$ = h('b', { class: 'mono' });
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 're-input mono', 'aria-label': `${title} percent` });
    const commit = () => {
      if (input.value === shown(get())) return;                       // untouched: never change the range
      const v = parseFloat(input.value.replace('−', '-'));
      if (Number.isFinite(v)) apply(clamp(v, limit));
      input.value = shown(get());
    };
    input.addEventListener('change', commit);
    const step = (d) => h('button', { type: 'button', class: 're-step', 'aria-label': `${title} ${d > 0 ? 'up' : 'down'} 1%`, onclick: () => apply(clamp(get() + d, limit)) }, d > 0 ? '+' : '−');
    const el = h('div', { class: 'boundbox grow' }, h('div', { class: 'split small' }, h('span', { class: 'lbl' }, title), price$),
      h('div', { class: 're-field' }, step(-1), input, h('span', { class: 'lbl' }, '%'), step(1)));
    return { el, draw: () => { price$.textContent = usd(price * (1 + get() / 100)); if (document.activeElement !== input) input.value = shown(get()); } };
  }
  const low = bound('Lower bound', LOWER, () => lo, (v) => set(v, hi)), up = bound('Upper bound', UPPER, () => hi, (v) => set(lo, v));

  function draw() {
    const s = span(), x = (v) => `${((clamp(v, [-s, s]) + s) / (2 * s)) * 100}%`;
    a.style.left = x(lo); b.style.left = x(hi); fill.style.left = x(lo); fill.style.width = `calc(${x(hi)} - ${x(lo)})`;
    grip.style.left = x((lo + hi) / 2); tag.textContent = usd(price);
    low.draw(); up.draw();
  }
  // Pointer events cover mouse, touch and pen. The scale is frozen for the whole drag.
  function draggable(el, kind) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); drag = { kind, span: span(), x: e.clientX, lo, hi }; });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.kind !== kind) return;
      const r = track.getBoundingClientRect(), s = drag.span, at = ((e.clientX - r.left) / r.width) * 2 * s - s;
      if (kind === 'lo') set(clamp(round1(at), LOWER), hi);
      else if (kind === 'hi') set(lo, clamp(round1(at), UPPER));
      else {                                                            // move both: keep the width and today's price inside
        const d = clamp(((e.clientX - drag.x) / r.width) * 2 * s, [Math.max(UPPER[0] - drag.hi, LOWER[0] - drag.lo), LOWER[1] - drag.lo]);
        set(round1(drag.lo + d), round1(drag.hi + d));
      }
    });
    const end = () => { if (drag?.kind === kind) { drag = null; draw(); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? -0.5 : e.key === 'ArrowRight' ? 0.5 : 0; if (!d || kind === 'move') return;
      e.preventDefault(); if (kind === 'lo') set(clamp(lo + d, LOWER), hi); else set(lo, clamp(hi + d, UPPER));
    });
  }
  draggable(a, 'lo'); draggable(b, 'hi'); draggable(grip, 'move');

  const el = h('div', { class: 're' }, track, h('div', { class: 'row gap wrap' }, low.el, up.el));
  return { el, update(l, u, p) { lo = l; hi = u; price = p; draw(); } };
}
