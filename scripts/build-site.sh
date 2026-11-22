#!/bin/sh
# Copies the site (and only the site) into dist/ for Cloudflare Pages: no tests, Worker, build scripts or node_modules.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp index.html style.css app.js engine.js particles.js merge.js sync.js sw.js manifest.webmanifest icon-512.png dist/
cp -R data dist/data
# every file sw.js caches up front must be in dist/
node -e "
const fs = require('fs');
const sw = fs.readFileSync('sw.js', 'utf8');
const lists = ['SHELL', 'DATA'].map(name => (sw.match(new RegExp('const ' + name + ' = \\\\[([\\\\s\\\\S]*?)\\\\];')) || [])[1] || '').join('\n');
const missing = [...lists.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './' && !fs.existsSync('dist/' + f));
if (missing.length) { console.error('missing from dist:', missing.join(', ')); process.exit(1); }
"
echo "dist/: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
