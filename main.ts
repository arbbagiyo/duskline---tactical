// DUSKLINE entry point (Node 22+, standard library only).
//
// The game itself is plain static files in game/ beside this file: the browser
// loads them as ES modules, three.js arriving through the import map in
// game/index.html. This program's only job is to hand those files in. It copies
// game/ and screenshots/ (when present) into the output directory and writes
// dossier.json there with the vendored make.fun library, so the dossier the
// judge reads is exactly the one the scorer rebuilds. It runs twice in the
// grader and both runs must produce identical bytes, so there is no clock,
// no randomness and no network use anywhere here.
//
// Local check: MAKEFUN_OUTPUT_DIR=/tmp/duskline-out node main.ts
// Play locally: node serve.ts, then open http://localhost:8080

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
const shots = join(here, 'screenshots');
if (existsSync(shots)) cpSync(shots, join(out, 'screenshots'), { recursive: true });

// Caps mirror the gate: the text cap shapes the dossier bytes, the rest refuse
// an entry the scorer would refuse (4 screenshots max, 256 KiB each; game/
// at most 993 entries and 48 MiB, sharing /output's 1000-entry cap).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
