export const esc = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export const clock = (seconds = 0) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const logo =
  '<img class="bloom-logo" src="../assets/bloom-mark.svg" alt="">';
export const button = (command, label, args = '', disabled = false) =>
  /* HTML */ `<button
    class="btn"
    data-command="${command}"
    ${args}
    ${disabled ? 'disabled' : ''}
  >
    ${label}
  </button>`;
export const problems = (s) =>
  `${s.problem ? /* HTML */ `<div class="note" role="alert">${esc(s.problem.message)}</div>` : ''}${s.notice ? /* HTML */ `<div class="note" role="status">${esc(s.notice)}</div>` : ''}${s.prefError ? /* HTML */ `<div class="note" role="alert">${esc(s.prefError)}</div>` : ''}`;
