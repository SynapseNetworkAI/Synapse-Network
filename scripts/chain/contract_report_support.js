const fs = require("fs");
const path = require("path");
const { writeJson } = require("./contract_script_support");

function appendFailedSection(lines, failed) {
  if (failed.length === 0) {
    return;
  }
  lines.push("", "## Failed", "");
  for (const failure of failed) {
    lines.push(`- ${failure}`);
  }
}

function appendNotesSection(lines, notes) {
  lines.push("", "## Notes", "");
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
}

function renderReportMarkdown({ title, report, notes, summaryLines }) {
  const lines = [`# ${title}`, "", ...summaryLines];
  appendFailedSection(lines, report.failed);
  appendNotesSection(lines, notes);
  return `${lines.join("\n")}\n`;
}

function writeEvidenceBundle(evidenceDir, jsonFiles, markdown) {
  for (const [fileName, value] of Object.entries(jsonFiles)) {
    writeJson(path.join(evidenceDir, fileName), value);
  }
  fs.writeFileSync(path.join(evidenceDir, "report.md"), markdown);
}

module.exports = {
  renderReportMarkdown,
  writeEvidenceBundle,
};
