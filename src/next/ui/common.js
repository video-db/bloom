// Small helpers shared by every window. No framework: each window renders from one state object.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const short = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Bloom's four-petal mark. kind: 'brand' (still), 'rec' (opening and closing), 'busy' (lighting in turn), '' (inherits colour).
const mark = (kind = '') => `<svg class="bl ${kind}" viewBox="0 0 100 100" aria-hidden="true">${window.BLOOM_PETALS.map((d, i) => `<path d="${d}" style="--i:${i}"/>`).join('')}</svg>`;
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">${window.BLOOM_ICONS[name] || ''}</svg>`;

// Clicks are declared in markup: <button data-cmd="stop"> sends a capture command,
// <button data-ui="open-main" data-view="editor"> asks the main process for a window action.
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-cmd],[data-ui]');
  if (!el || el.disabled) return;
  const { cmd, ui, ...args } = el.dataset;
  if (cmd) window.bloom.command(cmd, coerce(args));
  if (ui) window.bloom.ui(ui, coerce(args));
});
const coerce = (args) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v]));

function toast(text) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1600);
}

const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const syncMotion = () => window.bloom.ui('reduced-motion', { value: motionPreference.matches });
motionPreference.addEventListener('change', syncMotion); syncMotion();
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); window.bloom.ui('open-preferences'); } });
