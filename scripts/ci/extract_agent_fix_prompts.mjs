#!/usr/bin/env node

import fs from "node:fs";

const inputPath = process.argv[2];
const input = inputPath ? fs.readFileSync(inputPath, "utf8") : fs.readFileSync(0, "utf8");

const prompts = [];
for (const line of input.split(/\r?\n/)) {
  const match = line.match(/Agent fix:\s*(.+)$/);
  if (match) {
    prompts.push(match[1].trim());
  }
}

if (prompts.length === 0) {
  console.log("[agent-fix-prompts] no Agent fix prompts found");
  process.exit(0);
}

console.log("# Agent Repair Prompt");
console.log();
console.log("The guardrails failed. Apply these fixes without weakening the gates:");
for (const [index, prompt] of prompts.entries()) {
  console.log(`${index + 1}. ${prompt}`);
}
