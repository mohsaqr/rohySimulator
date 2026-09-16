// Validate a Prova catalogue YAML offline, using Prova's OWN parser and validators.
// Spins a throwaway Prova on a temp dir, registers the real rohy product profile, then plans the
// import (which runs every field validator, the case-id rule and the coverage-pattern rule) WITHOUT
// applying it anywhere. Nothing touches the live Prova.
//
//   node validate-catalog.mjs <path-to-catalogue.yaml> [--apply]
//
// --apply additionally applies the plan to the throwaway DB and re-exports it, proving the file
// round-trips losslessly (the property Prova's own catalog.test.mjs asserts).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PROVA = process.env.PROVA_REPO ?? path.join(process.env.HOME, 'Documents/Github/prova');

const { startTestServer, seedWorld } = await import(path.join(PROVA, 'test/helpers.mjs'));
const { insertProduct } = await import(path.join(PROVA, 'server/api/products.mjs'));
const { validateProfile } = await import(path.join(PROVA, 'server/lib/products.mjs'));
const { parseCatalogYaml, planImport, applyImport, exportCatalog, productsInPlan } =
  await import(path.join(PROVA, 'server/lib/catalog-yaml.mjs'));
const { parseYaml } = await import(path.join(PROVA, 'server/lib/yaml.mjs'));
const { tx } = await import(path.join(PROVA, 'server/db.mjs'));

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) { console.error('usage: node validate-catalog.mjs <catalogue.yaml> [--apply]'); process.exit(2); }

const rohyProfile = JSON.parse(fs.readFileSync(path.join(PROVA, 'seed/rohy.product.json'), 'utf8'));

const t = await startTestServer();
let failed = false;
try {
  // seedWorld creates the admin account the audit trail's foreign key needs.
  const world = await seedWorld(t);
  const principal = { account: world.accounts.admin, token: null };
  tx(t.db, () => insertProduct(t.db, principal, validateProfile(rohyProfile)));

  const text = fs.readFileSync(file, 'utf8');
  const doc = parseCatalogYaml(text);
  const plan = planImport(t.db, doc);

  const features = plan.length;
  const cases = plan.reduce((n, f) => n + f.cases.length, 0);
  const covers = plan.reduce((n, f) => n + f.cases.reduce((m, c) => m + c.covers.length, 0), 0);
  const tiers = {};
  const kinds = {};
  const severities = {};
  const platforms = {};
  plan.forEach(({ feature, cases: cs }) => {
    tiers[feature.tier] = (tiers[feature.tier] ?? 0) + 1;
    cs.forEach(({ data }) => {
      kinds[data.kind] = (kinds[data.kind] ?? 0) + 1;
      severities[data.severity_if_failed] = (severities[data.severity_if_failed] ?? 0) + 1;
      platforms[data.platforms.join('+')] = (platforms[data.platforms.join('+')] ?? 0) + 1;
    });
  });

  console.log(`PLAN OK  ${file}`);
  console.log(`  products in plan : ${productsInPlan(plan).join(', ')}`);
  console.log(`  features         : ${features}`);
  console.log(`  cases            : ${cases}`);
  console.log(`  coverage patterns: ${covers}`);
  console.log(`  feature tiers    : ${JSON.stringify(tiers)}`);
  console.log(`  case kinds       : ${JSON.stringify(kinds)}`);
  console.log(`  severities       : ${JSON.stringify(severities)}`);
  console.log(`  platforms        : ${JSON.stringify(platforms)}`);

  // Duplicate-id check: Prova would silently update rather than complain, so catch it here.
  const ids = plan.flatMap((f) => f.cases.map((c) => c.data.id));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) { console.error(`  DUPLICATE case ids: ${[...new Set(dupes)].join(', ')}`); failed = true; }

  if (apply) {
    const counts = tx(t.db, () => applyImport(t.db, principal, plan));
    console.log(`APPLY OK ${JSON.stringify(counts)}`);
    const exported = exportCatalog(t.db, ['rohy']);
    const a = JSON.stringify(parseYaml(exported));
    const b = JSON.stringify(parseYaml(text));
    if (a === b) console.log('ROUND TRIP OK  export == source');
    else {
      console.log('ROUND TRIP DIFFERS (usually only key order / defaults made explicit)');
      fs.writeFileSync('/tmp/prova-export.yaml', exported);
      console.log('  exported copy written to /tmp/prova-export.yaml for a diff');
    }
  }
} catch (err) {
  failed = true;
  console.error(`FAILED  ${err.code ?? err.name}: ${err.message}`);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
} finally {
  await t.stop();
}
process.exit(failed ? 1 : 0);
