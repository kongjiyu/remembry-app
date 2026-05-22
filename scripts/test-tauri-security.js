/**
 * Tauri Security Regression Check
 * Fails if dangerous settings are detected in tauri.conf.json or capabilities/default.json
 */

const fs = require('fs');
const path = require('path');

const TAURI_CONF = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const CAPABILITIES = path.join(__dirname, '..', 'src-tauri', 'capabilities', 'default.json');
const FRONTEND_DIST = '../out'; // Tauri serves Next.js static export (output: "export" in next.config.ts)
const DEV_URL = 'http://localhost:3010';

const DANGEROUS_PATTERNS = {
  'withGlobalTauri': [true, 'withGlobalTauri must be false'],
  'csp': [null, 'CSP must not be null'],
};

const DANGEROUS_CAPABILITY_PATTERNS = [
  { pattern: /^fs:allow-remove$/, msg: 'fs:allow-remove not allowed' },
  { pattern: /^fs:allow-rename$/, msg: 'fs:allow-rename not allowed' },
  { pattern: /^fs:allow-copy-file$/, msg: 'fs:allow-copy-file not allowed' },
  { pattern: /^shell:allow-open$/, msg: 'shell:allow-open not allowed' },
  { pattern: /^shell:allow-execute$/, msg: 'shell:allow-execute not allowed' },
  { pattern: /^dialog:allow-open$/, msg: 'dialog:allow-open not allowed' },
  { pattern: /^dialog:allow-save$/, msg: 'dialog:allow-save not allowed' },
  { pattern: /^os:default$/, msg: 'os:default not allowed' },
  { pattern: /^fs:scope-/, msg: 'Broad fs:scope not allowed (use specific paths)' },
];

function checkTauriConf() {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'));
  const errors = [];

  for (const [key, [forbidden, msg]] of Object.entries(DANGEROUS_PATTERNS)) {
    const keys = key.split('.');
    let val = conf;
    for (const k of keys) {
      val = val?.[k];
    }
    if (val === forbidden) {
      errors.push(`[${TAURI_CONF}] ${msg}`);
    }
  }

  // Tauri serves the Next.js static export from ../out (not .next)
  if (conf.build?.frontendDist !== FRONTEND_DIST) {
    errors.push(`[${TAURI_CONF}] frontendDist should be ${FRONTEND_DIST} (current: ${conf.build?.frontendDist})`);
  }

  // devUrl must point to the Next.js dev server for HMR (required to prevent stale UI from ../out fallback)
  if (conf.build?.devUrl !== DEV_URL) {
    errors.push(`[${TAURI_CONF}] devUrl should be ${DEV_URL} (current: ${conf.build?.devUrl})`);
  }

  return errors;
}

function checkCapabilities() {
  const cap = JSON.parse(fs.readFileSync(CAPABILITIES, 'utf8'));
  const errors = [];
  const permissions = cap.permissions || [];

  for (const perm of permissions) {
    for (const check of DANGEROUS_CAPABILITY_PATTERNS) {
      if (check.pattern.test(perm)) {
        errors.push(`[${CAPABILITIES}] ${check.msg}: ${perm}`);
      }
    }
  }

  if (permissions.includes('fs:default')) {
    errors.push(`[${CAPABILITIES}] fs:default is too broad, use specific fs permissions`);
  }

  return errors;
}

function main() {
  const confErrors = checkTauriConf();
  const capErrors = checkCapabilities();
  const allErrors = [...confErrors, ...capErrors];

  if (allErrors.length > 0) {
    console.error('Tauri security check FAILED:');
    for (const err of allErrors) {
      console.error('  -', err);
    }
    process.exit(1);
  }

  console.log('Tauri security check PASSED');
  process.exit(0);
}

main();