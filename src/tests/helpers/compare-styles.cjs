// Compares two folders of style snapshots (see style-snapshot.js) and lists what differs.
// Usage: node src/tests/helpers/compare-styles.cjs <before-dir> <after-dir>
const fs = require('node:fs');
const path = require('node:path');

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error('Usage: compare-styles.cjs <before-dir> <after-dir>');
  process.exit(2);
}
const names = (dir) =>
  fs.readdirSync(dir).filter((name) => name.endsWith('.styles.json')).sort();
const load = (dir, name) => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, name)));
  return Array.isArray(data) ? { scale: null, elements: data } : data;
};

let differences = 0;
const report = (line) => {
  differences += 1;
  if (differences <= 60) console.log(line);
};

const shots = names(before);
for (const name of names(after))
  if (!shots.includes(name)) report(`${name}: only in ${after}`);
for (const name of shots) {
  if (!fs.existsSync(path.join(after, name))) {
    report(`${name}: only in ${before}`);
    continue;
  }
  const one = load(before, name);
  const two = load(after, name);
  if (one.scale !== two.scale) {
    report(
      `${name}: taken on displays of different pixel scale (${one.scale} and ${two.scale}); retake both on the same display`,
    );
    continue;
  }
  const a = one.elements;
  const b = two.elements;
  if (a.length !== b.length)
    report(`${name}: ${a.length} elements before, ${b.length} after`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].el !== b[i].el) {
      report(`${name} #${i}: ${a[i].el} became ${b[i].el}`);
      break; // the trees no longer line up; later lines would be noise
    }
    if (a[i].box.join() !== b[i].box.join())
      report(`${name} ${a[i].el}: box ${a[i].box} -> ${b[i].box}`);
    for (const part of ['style', '::before', '::after', '::placeholder']) {
      const x = a[i][part] || {};
      const y = b[i][part] || {};
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
        if (x[key] !== y[key])
          report(`${name} ${a[i].el} ${part} ${key}: ${x[key]} -> ${y[key]}`);
    }
  }
}
console.log(
  differences
    ? `${differences} differences across ${shots.length} screens.`
    : `No differences across ${shots.length} screens.`,
);
process.exit(differences ? 1 : 0);
