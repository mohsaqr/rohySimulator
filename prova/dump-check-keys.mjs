// A Playwright reporter that writes the check keys this suite WOULD report to
// Prova, without contacting Prova at all.
//
//   npx playwright test --list --reporter=./prova/dump-check-keys.mjs
//
// writes prova/check-keys.txt, which prova/check-coverage-links.mjs then matches
// against the `covers:` patterns in rohy-cases.yaml. That pairing is what proves
// a coverage pattern points at a test that actually exists — Prova validates a
// pattern's SYNTAX on import but cannot know whether anything matches it, so a
// typo silently covers nothing and the case looks automated when it is not.
import path from 'node:path';
import fs from 'node:fs';
export default class Dump {
  onBegin(config, suite) {
    const out = [];
    for (const t of suite.allTests()) {
      const titles = [];
      for (let s = t.parent; s && s.type === 'describe'; s = s.parent) if (s.title) titles.unshift(s.title);
      let project = 'e2e';
      for (let s = t.parent; s; s = s.parent) if (s.type === 'project') project = s.project().name;
      const file = path.relative(config.rootDir, t.location.file).split(path.sep).join('/');
      out.push(`rohy:${project}::${[file, ...titles, t.title].join(' › ')}`);
    }
    fs.writeFileSync('prova/check-keys.txt', [...new Set(out)].join('\n') + '\n');
    console.log(`wrote prova/check-keys.txt — ${new Set(out).size} check keys`);
  }
}
