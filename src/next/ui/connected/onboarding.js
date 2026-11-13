import { logo, problems, accountForm } from './dom.js';
import { permissions, capture } from './panel.js';

export function onboarding(s, step) {
  const connected = s.account.status === 'signed-in';
  return /* HTML */ `<main class="ob connected-onboarding">
    <div class="onboarding-titlebar drag" aria-hidden="true"></div>
    <header class="onboarding-header drag">
      <div class="brandname">${logo} Bloom</div>
      <div class="onboarding-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="4" aria-valuenow="${step + 1}" aria-valuetext="Step ${step + 1} of 4: ${['Connect', 'Permissions', 'Try recording', 'Finish'][step]}">
        ${[0, 1, 2, 3].map((index) => `<span class="onboarding-segment ${index === step ? 'current' : index < step ? 'complete' : ''}" aria-hidden="true"></span>`).join('')}
      </div>
    </header>
    <section class="onboarding-content" aria-labelledby="onboarding-title">
    ${problems(s)}${step === 0
      ? /* HTML */ `<h1 id="onboarding-title">Your work, ready to share.</h1>
          <p>
            Connect VideoDB to save and share recordings.
          </p>
          ${accountForm(s, { onboarding: true })}`
      : step === 1
        ? /* HTML */ `<h1 id="onboarding-title">You’re in control.</h1>
            <p>
              Choose what to capture. Nothing records until you press Start.
            </p>
            ${permissions(s)}
            <aside class="onboarding-privacy">Selected screen and audio stream to VideoDB live. The video is saved locally, then uploaded.</aside>`
        : step === 2
          ? /* HTML */ `<h1 id="onboarding-title">Ready when you are.</h1>
              <p>
                Try recording your selected screen, or continue to the app.
              </p>
              ${capture(s)}`
          : /* HTML */ `<h1 id="onboarding-title">A click away.</h1>
              <p>
                Open the flower in your menu bar to record. Press ⇧⌘R anytime.
              </p>
              <button class="btn pri" data-ui="onboarding-done">Done</button>`}
    </section>
    <footer class="foot">
      ${step
        ? /* HTML */ `<button
            class="btn quiet"
            data-step="${step - 1}"
            ${!['idle', 'finished'].includes(s.phase) ? 'disabled' : ''}
          >
            Back
          </button>`
        : ''}${step < 3 && (step > 0 || connected)
        ? /* HTML */ `<button
            class="btn pri"
            data-step="${step + 1}"
            ${!connected ||
            (step > 0 && !s.permissions.screen) ||
            (step === 2 && s.sources.mic && !s.permissions.mic) ||
            !['idle', 'finished'].includes(s.phase)
              ? 'disabled'
              : ''}
          >
            ${step === 2 ? 'Continue' : 'Next'}
          </button>`
        : ''}
    </footer>
    <div class="onboarding-credit"><span>Powered by</span> <img class="videodb-wordmark" src="../assets/videodb-wordmark.png" alt="VideoDB" width="77" height="12"></div>
  </main>`;
}
