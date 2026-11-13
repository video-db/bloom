// The places in the sidebar, in order. Adding a place is one entry here and its view file;
// nothing else in the main window changes.
//   view(state, browse) -> markup     count(state) -> number shown beside the label
import { home } from './home.js';
import { recordings } from './recordings.js';

export const PLACES = [
  { id: 'home', label: 'Home', icon: 'home', view: home },
  {
    id: 'recordings',
    label: 'Recordings',
    icon: 'recordings',
    view: recordings,
    count: (s) => s.recordings.length,
  },
];
