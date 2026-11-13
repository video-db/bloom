// Elapsed seconds as mm:ss, shared by the tray title and notification text so they always agree.
const clock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

module.exports = { clock };
