#!/usr/bin/env node
// Rebuild load/reports/index.html from the existing *.summary.json files
// without running a new test. Useful after copying reports between machines.
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGallery } from './lib/gallery.mjs';

const reportDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'load/reports');
const n = buildGallery(reportDir);
console.log(`Indexed ${n} run(s) -> load/reports/index.html`);
