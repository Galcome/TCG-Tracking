import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const WORKFLOWS = ['ci.yml', 'expo-checks.yml'];
const RUN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending']);
const RUN_CONCLUSIONS = new Set([
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out',
  'action_required', 'stale', 'startup_failure',
]);
const FAILURE_MESSAGE = 'Exact remote-main release validation failed.';

/** @typedef {(command: string, args: string[]) => string} CommandRunner */

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

/**
 * Run one fixed executable with an argument array. Subprocess output is returned only to
 * the validator; stderr is captured and never printed so a CLI error cannot disclose it.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
export function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') fail();
  return result.stdout;
}

/**
 * Parse a command that must return exactly one commit SHA, optionally followed by the
 * platform line ending emitted by git.
 *
 * @param {unknown} output
 * @returns {string}
 */
function parseSha(output) {
  if (typeof output !== 'string') fail();
  const match = /^([0-9a-f]{40})(?:\r?\n)?$/i.exec(output);
  if (!match) fail();
  return match[1].toLowerCase();
}

/**
 * Parse the single ref returned by `git ls-remote`.
 *
 * @param {unknown} output
 * @returns {string}
 */
function parseRemoteMain(output) {
  if (typeof output !== 'string') fail();
  const match = /^([0-9a-f]{40})\trefs\/heads\/main(?:\r?\n)?$/i.exec(output);
  if (!match) fail();
  return match[1].toLowerCase();
}

/**
 * Validate the restricted fields requested from one `gh run list` response and require
 * the newest matching run to be completed successfully. GitHub returns newest first;
 * preserving that order is what prevents an older green run from masking a newer failure.
 *
 * @param {unknown} output
 * @param {string} sha
 */
function assertWorkflowSuccess(output, sha) {
  if (typeof output !== 'string') fail();
  let runs;
  try {
    runs = JSON.parse(output);
  } catch {
    fail();
  }
  if (!Array.isArray(runs)) fail();

  for (const run of runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run)
      || typeof run.headSha !== 'string' || !SHA_PATTERN.test(run.headSha)
      || typeof run.status !== 'string' || !RUN_STATUSES.has(run.status)
      || !(run.conclusion === null
        || (typeof run.conclusion === 'string' && RUN_CONCLUSIONS.has(run.conclusion)))) {
      fail();
    }
  }

  const newestMatching = runs.find((run) => run.headSha.toLowerCase() === sha);
  if (!newestMatching || newestMatching.status !== 'completed' || newestMatching.conclusion !== 'success') {
    fail();
  }
}

/**
 * Require the checked-out commit to be exactly the commit currently published at
 * origin/main, then require the newest matching run for every release workflow to be green.
 * The injected runner is synchronous so unit tests can exercise every fail-closed branch
 * without contacting GitHub or Firebase.
 *
 * @param {CommandRunner} [run]
 * @returns {{ ok: true, sha: string }}
 */
export function assertMainRelease(run = runCommand) {
  try {
    const sha = parseSha(run('git', ['rev-parse', 'HEAD']));
    const remoteSha = parseRemoteMain(run('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']));
    if (remoteSha !== sha) fail();
    if (run('git', ['status', '--porcelain', '--untracked-files=all', '--', '.']) !== '') fail();

    for (const workflow of WORKFLOWS) {
      const output = run('gh', [
        'run', 'list', '--workflow', workflow, '--commit', sha, '--branch', 'main',
        '--limit', '5', '--json', 'headSha,status,conclusion',
      ]);
      assertWorkflowSuccess(output, sha);
    }
    return { ok: true, sha };
  } catch {
    // Do not forward parser, runner, stdout or stderr details to the release caller.
    throw new Error(FAILURE_MESSAGE);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { sha } = assertMainRelease();
    process.stdout.write(`Exact remote-main release checks passed for ${sha}.\n`);
  } catch {
    process.stderr.write(`${FAILURE_MESSAGE}\n`);
    process.exitCode = 1;
  }
}
