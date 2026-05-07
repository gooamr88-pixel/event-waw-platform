/**
 * ═══════════════════════════════════════════════════════════════
 * EVENT WAW — File Size Audit Script
 * ═══════════════════════════════════════════════════════════════
 *
 * Enforces the "No file over 300 lines" rule.
 * Run via: npm run audit:filesize
 *
 * Exit code 1 if ANY file exceeds the threshold (blocks CI).
 * Produces a clean report with suggested modular breakdowns.
 * ═══════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';

const MAX_LINES = 300;
const SCAN_DIRS = ['src/lib', 'js'];
const EXTENSIONS = ['.js', '.ts', '.mjs'];
const IGNORE_PATTERNS = ['node_modules', '.git', 'test-results', 'dist'];

const violations = [];
const warnings = [];

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    if (IGNORE_PATTERNS.some(p => fullPath.includes(p))) continue;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
      continue;
    }

    if (!EXTENSIONS.includes(extname(entry))) continue;

    const content = readFileSync(fullPath, 'utf-8');
    const lineCount = content.split('\n').length;
    const relPath = relative('.', fullPath);

    if (lineCount > MAX_LINES) {
      violations.push({ file: relPath, lines: lineCount, over: lineCount - MAX_LINES });
    } else if (lineCount > MAX_LINES * 0.8) {
      warnings.push({ file: relPath, lines: lineCount });
    }
  }
}

// ── Run scan ──
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  EVENT WAW — File Size Audit');
console.log(`  Max: ${MAX_LINES} lines | Dirs: ${SCAN_DIRS.join(', ')}`);
console.log('═══════════════════════════════════════════════');
console.log('');

for (const dir of SCAN_DIRS) {
  scanDir(dir);
}

// ── Report warnings ──
if (warnings.length > 0) {
  console.log(`⚠️  ${warnings.length} file(s) approaching limit (>80% of ${MAX_LINES}):`);
  for (const w of warnings.sort((a, b) => b.lines - a.lines)) {
    console.log(`   ⚡ ${w.file}  →  ${w.lines} lines (${MAX_LINES - w.lines} remaining)`);
  }
  console.log('');
}

// ── Report violations ──
if (violations.length > 0) {
  console.log(`❌ ${violations.length} file(s) EXCEED the ${MAX_LINES}-line limit:`);
  console.log('');
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.log(`   🔴 ${v.file}`);
    console.log(`      Lines: ${v.lines}  |  Over by: +${v.over}`);
    console.log(`      Action: Must be split into ≤${MAX_LINES}-line modules`);
    console.log('');
  }
  console.log('────────────────────────────────────────────────');
  console.log('  AUDIT FAILED — Fix violations before merging');
  console.log('────────────────────────────────────────────────');
  process.exit(1);
} else {
  console.log(`✅ All ${SCAN_DIRS.join(' + ')} files are within the ${MAX_LINES}-line limit.`);
  if (warnings.length > 0) {
    console.log(`   (${warnings.length} file(s) approaching — consider preemptive refactoring)`);
  }
  console.log('');
}
