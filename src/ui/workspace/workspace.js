// The main window: a title bar, the sidebar of places, and whichever page is showing.
// Each page is its own file; this one only chooses between them.
import { problems } from '../shared/dom.js';
import { settings } from '../settings/settings.js';
import { titleBar } from './titlebar.js';
import { sidebar } from './sidebar.js';
import { PLACES } from './places.js';
import { recording } from './recording.js';

// route: { place, id } — 'home', 'recordings', 'recording' with an id, or 'settings'.
// browse: { filter, order } — how Recordings is being looked at.
export function workspace(s, route, browse) {
  if (s.account.status !== 'signed-in')
    return '<main class="page-empty"><h1>Sign in to continue</h1><button class="btn" data-ui="open-onboarding">Open setup</button></main>';
  const page =
    route.place === 'settings'
      ? settings(s)
      : route.place === 'recording'
        ? recording(s, route.id)
        : (PLACES.find((p) => p.id === route.place) || PLACES[0]).view(
            s,
            browse,
          );
  // An open recording belongs to Recordings.
  const current = route.place === 'recording' ? 'recordings' : route.place;
  return /* HTML */ `<div class="app">
    ${titleBar(s)}
    <div class="body">
      ${sidebar(s, PLACES.some((p) => p.id === current) || current === 'settings' ? current : PLACES[0].id)}
      <main class="view">${problems(s)}${page}</main>
    </div>
  </div>`;
}
