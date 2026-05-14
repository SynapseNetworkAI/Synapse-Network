#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function usage() {
  console.error(
    "Usage: node scripts/ci/frontend_scope_plan.mjs --scope <path> [--project user-front] [--json <path>] [--github-output <path>]"
  );
  process.exit(2);
}

const scopePath = argValue("--scope");
const project = (argValue("--project") || "user-front").trim();
const jsonOut = argValue("--json");
const githubOutputPath = argValue("--github-output");

if (!scopePath) usage();
if (project !== "user-front") {
  console.error(`unsupported frontend scope project: ${project}`);
  process.exit(2);
}

const scope = JSON.parse(readFileSync(scopePath, "utf8"));
const changedFiles = [...new Set(scope.changedFiles || [])].sort();

const projectPrefix = "services/user-front/";
const projectFiles = changedFiles.filter((file) =>
  file.startsWith(projectPrefix)
);
const contractIntegrationFiles = changedFiles.filter(
  (file) =>
    file.startsWith("contracts/") ||
    file.startsWith("scripts/chain/") ||
    /^hardhat\.config\./.test(file)
);

const pathMatchesAny = (file, patterns) =>
  patterns.some((pattern) => pattern.test(file));

const lintablePatterns = [/\.(ts|tsx|js|jsx)$/];
const relatedTestPatterns = [/\.(ts|tsx|js|jsx)$/];
const buildPatterns = [
  /^services\/user-front\/src\/.*\.(ts|tsx|js|jsx|css)$/,
  /^services\/user-front\/public\//,
  /^services\/user-front\/(next|postcss|tailwind)\.config\./,
  /^services\/user-front\/tsconfig.*\.json$/,
  /^services\/user-front\/package\.json$/,
];
const testOnlyPatterns = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /^services\/user-front\/src\/test\//,
];
const i18nPatterns = [
  /^services\/user-front\/src\/i18n\//,
  /^services\/user-front\/src\/test\/renderWithLanguage\.tsx$/,
];
const userErrorPatterns = [
  /^services\/user-front\/src\/components\/dashboard-workspace\/OwnerCreditsPage\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/DashboardAgentsPage\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/DashboardCredentialsPage\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/ManageSpendCapModal\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard\/agents\/QuickStartGuide\.tsx$/,
  /^services\/user-front\/src\/components\/PaidInvokePanel\.tsx$/,
  /^services\/user-front\/src\/components\/NotificationCenter\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderHealthPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServicesPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServiceDeployPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderWithdrawPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderSettlementsPage\.tsx$/,
  /^services\/user-front\/src\/utils\/providerWithdrawApi\.ts$/,
  /^services\/user-front\/src\/utils\/providerWithdrawWallet\.ts$/,
];
const errorDomPatterns = [
  /^services\/user-front\/src\/components\/dashboard-workspace\/OwnerCreditsPage(\.withdraw)?\.test\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/OwnerCreditsPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderWithdrawPage\.test\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderWithdrawPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServicesPage\.test\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServicesPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderHealthPage\.test\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderHealthPage\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServiceDeployPage\.test\.tsx$/,
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderServiceDeployPage\.tsx$/,
  /^services\/user-front\/src\/components\/PaidInvokePanel(\.test)?\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/ManageSpendCapModal(\.test)?\.tsx$/,
  /^services\/user-front\/src\/components\/dashboard-workspace\/DashboardCredentialsPage(\.test)?\.tsx$/,
  /^services\/user-front\/src\/components\/NotificationCenter(\.test)?\.tsx$/,
  /^services\/user-front\/src\/utils\/providerWithdrawApi(\.test)?\.ts$/,
  /^services\/user-front\/src\/utils\/providerWithdrawWallet(\.test)?\.ts$/,
];
const matureDomPatterns = [
  /^services\/user-front\/src\/components\/provider-workspace\/ProviderWithdrawPage(\.test)?\.tsx$/,
  /^services\/user-front\/src\/utils\/providerWithdrawApi(\.test)?\.ts$/,
  /^services\/user-front\/src\/utils\/providerWithdrawWallet(\.test)?\.ts$/,
];

const lintFiles = projectFiles
  .filter((file) => pathMatchesAny(file, lintablePatterns))
  .map((file) => file.slice(projectPrefix.length));
const relatedTestFiles = projectFiles
  .filter((file) => pathMatchesAny(file, relatedTestPatterns))
  .map((file) => file.slice(projectPrefix.length));

const hasProjectFiles = projectFiles.length > 0;
const hasContractIntegrationFiles = contractIntegrationFiles.length > 0;
const integrationOnly = !hasProjectFiles && hasContractIntegrationFiles;
const skip = !hasProjectFiles && !hasContractIntegrationFiles;

const buildRelevantProjectFiles = projectFiles.filter(
  (file) =>
    pathMatchesAny(file, buildPatterns) &&
    !pathMatchesAny(file, testOnlyPatterns)
);

const plan = {
  project,
  skip,
  reason: skip
    ? "no user-front or contract integration changes in scope"
    : integrationOnly
    ? "contract or chain change requires user-front integration build only"
    : "user-front changes detected",
  changedFiles,
  projectFiles,
  contractIntegrationFiles,
  integrationOnly,
  lintFiles,
  relatedTestFiles,
  runLint: lintFiles.length > 0,
  runRelatedTests: relatedTestFiles.length > 0 && !integrationOnly,
  runTypecheck: buildRelevantProjectFiles.length > 0 || integrationOnly,
  runBuild: buildRelevantProjectFiles.length > 0 || integrationOnly,
  runExternalLinks:
    !integrationOnly &&
    projectFiles.some((file) =>
      /^services\/user-front\/src\/.*\.(ts|tsx|js|jsx)$/.test(file)
    ),
  runI18nScan: projectFiles.some((file) => pathMatchesAny(file, i18nPatterns)),
  runUserErrorScan: projectFiles.some((file) =>
    pathMatchesAny(file, userErrorPatterns)
  ),
  runErrorDom: projectFiles.some((file) =>
    pathMatchesAny(file, errorDomPatterns)
  ),
  runProviderWithdrawMatureDom: projectFiles.some((file) =>
    pathMatchesAny(file, matureDomPatterns)
  ),
};

const body = `${JSON.stringify(plan, null, 2)}\n`;
if (jsonOut) {
  writeFileSync(jsonOut, body);
}
if (githubOutputPath) {
  const output = [
    `skip=${plan.skip ? "true" : "false"}`,
    `integration_only=${plan.integrationOnly ? "true" : "false"}`,
    `run_build=${plan.runBuild ? "true" : "false"}`,
    `run_related_tests=${plan.runRelatedTests ? "true" : "false"}`,
    `run_lint=${plan.runLint ? "true" : "false"}`,
  ].join("\n");
  writeFileSync(githubOutputPath, `${output}\n`, { flag: "a" });
}
process.stdout.write(body);
