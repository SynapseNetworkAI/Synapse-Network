import { spawnSync } from "node:child_process";

export class BlockedError extends Error {}

export function ensureCommand(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`missing required command: ${command}`);
  }
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, buildSpawnOptions(options));

  if (result.error) {
    throwCommandError(command, args, options, result.error);
  }

  if (shouldThrowForStatus(result.status, options.allowFailure)) {
    throw new Error(buildCommandFailureMessage(command, args, options, result));
  }

  return formatCommandResult(result);
}

function buildSpawnOptions(options) {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30000,
  };
}

function shouldThrowForStatus(status, allowFailure) {
  return status !== 0 && !allowFailure;
}

function formatCommandResult(result) {
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function throwCommandError(command, args, options, error) {
  if (error.code === "ETIMEDOUT") {
    throw new Error(
      `${commandLabel(command, args, options)} timed out after ${
        options.timeoutMs ?? 30000
      }ms`
    );
  }
  throw error;
}

function buildCommandFailureMessage(command, args, options, result) {
  const fallback = `${command} ${args.join(" ")} failed`;
  const stderr = (result.stderr || result.stdout || "").trim();
  return options.failMessage ?? stderr ?? fallback;
}

function commandLabel(command, args, options) {
  return options.label ?? `${command} ${args.join(" ")}`;
}

export function runJsonCommand(command, args, options = {}) {
  const result = runCommand(command, args, options);
  try {
    return JSON.parse(result.stdout || "[]");
  } catch {
    throw new Error(
      `${commandLabel(command, args, options)} returned invalid JSON`
    );
  }
}

export function readTrimmedStdout(command, args, options = {}) {
  return runCommand(command, args, options).stdout.trim();
}

export function sumBy(items, iteratee) {
  return items.reduce((total, item) => total + iteratee(item), 0);
}

export function roundCurrency(value) {
  return Number.parseFloat(value.toFixed(2));
}

export function roundPercent(value) {
  return Number.parseFloat(value.toFixed(2));
}

export function addUtcDays(date, deltaDays) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next;
}

export function startOfUtcDay(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

export function formatCompactUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

export function formatDateYYYYMMDD(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function sqlStringLiteral(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export function scoreExportTable(tableId) {
  let score = 0;
  if (/resource/i.test(tableId)) {
    score += 20;
  }
  if (/v1/i.test(tableId)) {
    score += 10;
  }
  if (/cloud/i.test(tableId)) {
    score += 5;
  }
  return score;
}
