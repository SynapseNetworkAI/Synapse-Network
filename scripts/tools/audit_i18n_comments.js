#!/usr/bin/env node
/**
 * audit_i18n_comments.js
 *
 * Audit frontend source files for hardcoded non-English/non-ASCII comments
 * inside CodeBlock code props that should be extracted to i18n resource files.
 *
 * Usage:
 *   node scripts/tools/audit_i18n_comments.js [src-dir]
 *
 * Default src-dir: services/user-front/src/app/docs
 *
 * Output:
 *   Lists files and line numbers where `// ` comments contain non-ASCII
 *   characters (CJK, etc.) in template strings used as CodeBlock props.
 *
 * A clean codebase produces:
 *   "No hardcoded non-ASCII comments found."
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(process.cwd(), process.argv[2] || 'services/user-front/src/app/docs');

// Regex: a // comment containing CJK (Chinese/Japanese/Korean) characters
// Only flags language-specific content — ignores em-dashes, box-drawing chars, arrows, etc.
const NON_ASCII_COMMENT = /\/\/[^\n]*[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af][^\n]*/;

let foundAny = false;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      checkFile(fullPath);
    }
  }
}

function checkFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (NON_ASCII_COMMENT.test(line)) {
      const rel = path.relative(process.cwd(), filePath);
      console.log(`  ${rel}:${i + 1}  →  ${line.trim()}`);
      foundAny = true;
    }
  });
}

console.log(`Auditing: ${SRC_DIR}\n`);
walk(SRC_DIR);

if (!foundAny) {
  console.log('No hardcoded non-ASCII comments found. All clear!');
} else {
  console.log('\nAction: extract these comments to i18n resource arrays and use ${cXxx[n]} interpolation.');
  process.exit(1);
}
