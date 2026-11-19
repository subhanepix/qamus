#!/bin/sh
# Copies the site (and only the site) into dist/ for Cloudflare Pages: no tests, Worker, build scripts or node_modules.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp index.html style.css app.js merge.js sync.js vocab.js study.js tour.js sw.js manifest.webmanifest icon-512.png dist/
cp -R data dist/data
# every file sw.js caches up front must be in dist/
node -e "
const fs = require('fs');
const shell = (fs.readFileSync('sw.js', 'utf8').match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
const missing = [...shell.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './' && !fs.existsSync('dist/' + f));
if (missing.length) { console.error('missing from dist:', missing.join(', ')); process.exit(1); }
"
echo "dist/: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
