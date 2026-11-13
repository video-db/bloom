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
  '<img class="connected-logo" src="../assets/bloom-mark.svg" alt="">';
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
export function accountForm(s) {
  if (s.account.status === 'signed-in')
    return '<p class="soft">Connected to VideoDB.</p>';
  return /* HTML */ `<form data-form="sign-in" class="connected-form">
      <label
        >VideoDB API key<input
          type="password"
          class="field"
          name="key"
          placeholder="Paste your API key"
          autocomplete="off"
          spellcheck="false"
          maxlength="4096"
          required
          aria-label="VideoDB API key"
          ${s.account.status === 'checking' ? 'disabled' : ''}
      /></label>
      <button
        class="btn pri"
        ${s.account.status === 'checking' ? 'disabled' : ''}
      >
        ${
          s.account.status === 'checking' ? 'Connecting…' : 'Connect to VideoDB'
        }
      </button>
      <p class="soft">
        Your key is encrypted using this Mac’s secure storage. Selected screen
        and audio stream to VideoDB while recording; the final video is saved
        locally, then uploaded.
      </p>
    </form>
    <button
      type="button"
      class="btn account-create"
      data-ui="get-api-key"
      aria-label="Create a VideoDB account (opens browser)"
    >
      Create a VideoDB account
    </button>
    ${
      s.account.status === 'offline'
        ? button('checkConnection', 'Retry saved connection')
        : ''
    }`;
}
