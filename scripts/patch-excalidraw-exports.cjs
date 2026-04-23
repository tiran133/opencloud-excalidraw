/**
 * Patches @excalidraw/excalidraw dev bundle to export CommandPalette
 * and DEFAULT_CATEGORIES which are internal but needed for our app.
 *
 * Run automatically via postinstall hook in package.json.
 *
 * Targeted version: @excalidraw/excalidraw@0.18.0
 * If you upgrade Excalidraw, verify the patch still applies and update
 * EXPECTED_VERSION below.
 */
const fs = require('fs')
const path = require('path')

const EXPECTED_VERSION = '0.18.0'

const devIndex = path.join(
  __dirname,
  '..',
  'node_modules',
  '@excalidraw',
  'excalidraw',
  'dist',
  'dev',
  'index.js'
)

if (!fs.existsSync(devIndex)) {
  console.log('[patch-excalidraw] dev bundle not found, skipping')
  process.exit(0)
}

// Version check: warn if Excalidraw version has changed
const pkgPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@excalidraw',
  'excalidraw',
  'package.json'
)
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  if (pkg.version !== EXPECTED_VERSION) {
    console.warn(
      `[patch-excalidraw] ⚠️  Expected @excalidraw/excalidraw@${EXPECTED_VERSION}, found ${pkg.version} — patch may be incompatible!`
    )
  }
}

let content = fs.readFileSync(devIndex, 'utf-8')

if (content.includes('CommandPalette,')) {
  console.log('[patch-excalidraw] already patched, skipping')
  process.exit(0)
}

const target = 'zoomToFitBounds\n};'
if (!content.includes(target)) {
  console.error(
    '[patch-excalidraw] export block pattern not found — excalidraw version may have changed'
  )
  process.exit(1)
}

content = content.replace(target, 'zoomToFitBounds,\n  CommandPalette,\n  DEFAULT_CATEGORIES\n};')

fs.writeFileSync(devIndex, content, 'utf-8')
console.log('[patch-excalidraw] patched dev bundle exports (CommandPalette, DEFAULT_CATEGORIES)')
