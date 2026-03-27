const esbuild = require('esbuild');

// IIFE bundle for CDN / <script> tag usage
const iife = esbuild.build({
  entryPoints: ['src/sticky-widget.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'StickyWidgetModule',
  outfile: 'dist/sticky-widget.min.js',
  target: ['es2020'],
  footer: {
    js: 'var StickyWidget=StickyWidgetModule.default;',
  },
});

// ESM bundle for bundler imports (webpack, Vite, Rollup, etc.)
const esm = esbuild.build({
  entryPoints: ['src/sticky-widget.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'dist/sticky-widget.esm.js',
  target: ['es2020'],
});

Promise.all([iife, esm]).then(() => {
  console.log('Built dist/sticky-widget.min.js (IIFE)');
  console.log('Built dist/sticky-widget.esm.js (ESM)');
}).catch(() => process.exit(1));
