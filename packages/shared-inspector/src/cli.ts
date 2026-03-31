#!/usr/bin/env node
export * from './cli/index.js';
import { main } from './cli/index.js';

const moduleUrl = new URL(import.meta.url);
const scriptUrl = process.argv[1] ? new URL(process.argv[1], 'file://') : null;

if (scriptUrl && moduleUrl.href === scriptUrl.href) {
  main(process.argv.slice(2)).then(
    (code) => { if (code !== 0) process.exit(code); },
    (err: Error) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    },
  );
}
