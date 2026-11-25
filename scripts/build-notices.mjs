#!/usr/bin/env node
// Generates public/licenses/THIRD_PARTY_NOTICES.txt from the production dependency tree
// (everything that ends up in the shipped site), including each package's license text.
// Also copies ASSET_LICENSES.md (sample credits) next to it.
// Run: node scripts/build-notices.mjs   (also run by `pnpm build`)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tree = JSON.parse(execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], { cwd: root, encoding: 'utf8' }));

const pkgs = new Map();
function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (info.path && !pkgs.has(`${name}@${info.version}`)) pkgs.set(`${name}@${info.version}`, { name, version: info.version, path: info.path });
    walk(info.dependencies);
  }
}
for (const proj of tree) walk(proj.dependencies);

const blocks = [...pkgs.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name, version, path }) => {
    const meta = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    const file = readdirSync(path).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    const text = file ? readFileSync(join(path, file), 'utf8').trim() : `License: ${meta.license ?? 'unknown'} (no license file in package)`;
    const url = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? meta.homepage ?? '';
    return `${'='.repeat(78)}\n${name} ${version} — ${meta.license ?? 'unknown'}\n${url}\n${'-'.repeat(78)}\n${text}\n`;
  });

const out = join(root, 'public', 'licenses');
if (!existsSync(out)) mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'THIRD_PARTY_NOTICES.txt'),
  `tko — third-party software notices\n\nThe following open-source packages are bundled into this web app (code and fonts).\nBundled sample credits are in ASSET_LICENSES.md.\n\n${blocks.join('\n')}`,
);
// Sample credits travel with the site too.
writeFileSync(join(out, 'ASSET_LICENSES.md'), readFileSync(join(root, 'ASSET_LICENSES.md'), 'utf8'));
console.log(`Wrote notices for ${blocks.length} packages: ${[...pkgs.keys()].join(', ')}`);
