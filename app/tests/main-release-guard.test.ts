import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMainRelease } from '../scripts/mobile/assert-main-release.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const FAILURE = 'Exact remote-main release validation failed.';
const successRun = (headSha = SHA) => ({ headSha, status: 'completed', conclusion: 'success' });

type Call = { command: string; args: string[] };
type RunnerOptions = {
  headOutput?: string;
  remoteOutput?: string;
  statusOutput?: string;
  workflowOutput?: Record<string, string>;
  failWhen?: (call: Call) => boolean;
};

function runner(options: RunnerOptions = {}) {
  const calls: Call[] = [];
  const run = (command: string, args: string[]): string => {
    const call = { command, args: [...args] };
    calls.push(call);
    if (options.failWhen?.(call)) throw new Error('private command output must stay private');
    if (command === 'git' && args[0] === 'rev-parse') return options.headOutput ?? `${SHA}\n`;
    if (command === 'git' && args[0] === 'ls-remote') {
      return options.remoteOutput ?? `${SHA}\trefs/heads/main\n`;
    }
    if (command === 'git' && args[0] === 'status') return options.statusOutput ?? '';
    if (command === 'gh') {
      const workflow = args[args.indexOf('--workflow') + 1];
      return options.workflowOutput?.[workflow] ?? JSON.stringify([successRun()]);
    }
    throw new Error('unexpected command');
  };
  return { run, calls };
}

function workflowOutput(
  ciRuns: unknown[] = [successRun()],
  expoRuns: unknown[] = [successRun()],
): Record<string, string> {
  return {
    'ci.yml': JSON.stringify(ciRuns),
    'expo-checks.yml': JSON.stringify(expoRuns),
  };
}

function expectFailure(run: (command: string, args: string[]) => string) {
  assert.throws(
    () => assertMainRelease(run),
    (error: unknown) => error instanceof Error && error.message === FAILURE,
  );
}

test('accepts a clean detached HEAD at origin/main and checks both workflows', () => {
  const command = runner({ workflowOutput: workflowOutput() });

  assert.deepEqual(assertMainRelease(command.run), { ok: true, sha: SHA });
  assert.deepEqual(command.calls, [
    { command: 'git', args: ['rev-parse', 'HEAD'] },
    { command: 'git', args: ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'] },
    { command: 'git', args: ['status', '--porcelain', '--untracked-files=all', '--', '.'] },
    { command: 'gh', args: [
      'run', 'list', '--workflow', 'ci.yml', '--commit', SHA, '--branch', 'main',
      '--limit', '5', '--json', 'headSha,status,conclusion',
    ] },
    { command: 'gh', args: [
      'run', 'list', '--workflow', 'expo-checks.yml', '--commit', SHA, '--branch', 'main',
      '--limit', '5', '--json', 'headSha,status,conclusion',
    ] },
  ]);
  assert.equal(command.calls.some(({ args }) => args.includes('--show-current')), false);
});

test('rejects a checked-out commit that is not the exact remote main commit', () => {
  const command = runner({ headOutput: `${OTHER_SHA}\n` });

  expectFailure(command.run);
  assert.deepEqual(command.calls, [
    { command: 'git', args: ['rev-parse', 'HEAD'] },
    { command: 'git', args: ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'] },
  ]);
});

test('rejects missing or malformed HEAD and remote ref output', () => {
  const cases = [
    { headOutput: '', remoteOutput: `${SHA}\trefs/heads/main\n` },
    { headOutput: `${'a'.repeat(39)}\n`, remoteOutput: `${SHA}\trefs/heads/main\n` },
    { headOutput: `${SHA}\n`, remoteOutput: '' },
    { headOutput: `${SHA}\n`, remoteOutput: 'not-a-ref\n' },
    { headOutput: `${SHA}\n`, remoteOutput: `${SHA}\trefs/heads/develop\n` },
    { headOutput: `${SHA}\n`, remoteOutput: `${SHA}\trefs/heads/main\nextra\n` },
  ];

  for (const output of cases) expectFailure(runner(output).run);
});

test('fails closed on command failures and never forwards command error text', () => {
  const command = runner({
    failWhen: ({ command }) => command === 'git',
  });

  let error: unknown;
  try {
    assertMainRelease(command.run);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error instanceof Error, true);
  assert.equal((error as Error).message, FAILURE);
  assert.doesNotMatch((error as Error).message, /private|command output/);
});

test('rejects a dirty or malformed worktree status before running workflow checks', () => {
  for (const statusOutput of [' M App.tsx\n', '?? new-source.ts\n', 'not porcelain']) {
    const command = runner({ statusOutput });
    expectFailure(command.run);
    assert.equal(command.calls.some(({ command: name }) => name === 'gh'), false);
  }
});

test('rejects malformed workflow JSON, missing checks, and wrong-head runs', () => {
  const malformed = runner({ workflowOutput: { 'ci.yml': 'not-json' } });
  expectFailure(malformed.run);

  const missing = runner({ workflowOutput: workflowOutput([], []) });
  expectFailure(missing.run);

  const wrongHead = runner({ workflowOutput: workflowOutput([successRun(OTHER_SHA)]) });
  expectFailure(wrongHead.run);
});

test('validates every workflow result field and fails malformed shapes closed', () => {
  const malformedRuns = [
    { headSha: 'not-a-sha', status: 'completed', conclusion: 'success' },
    { headSha: SHA, status: 'unknown', conclusion: 'success' },
    { headSha: SHA, status: 'completed', conclusion: 'unknown' },
    { headSha: SHA, status: 'completed' },
    { headSha: SHA, status: 'completed', conclusion: null },
    null,
  ];

  for (const malformedRun of malformedRuns) {
    const command = runner({ workflowOutput: workflowOutput([malformedRun]) });
    expectFailure(command.run);
  }
});

test('newer cancelled, pending, or failed matching runs cannot be masked by an older success', () => {
  const cases = [
    [{ headSha: SHA, status: 'completed', conclusion: 'cancelled' }, successRun()],
    [{ headSha: SHA, status: 'pending', conclusion: null }, successRun()],
    [{ headSha: SHA, status: 'completed', conclusion: 'failure' }, successRun()],
  ];

  for (const runs of cases) {
    const command = runner({ workflowOutput: workflowOutput(runs) });
    expectFailure(command.run);
  }
});

test('Expo must pass independently after backend CI succeeds', () => {
  for (const runs of [[], [successRun(OTHER_SHA)], [{ headSha: SHA, status: 'completed', conclusion: 'failure' }]]) {
    expectFailure(runner({ workflowOutput: workflowOutput([successRun()], runs) }).run);
  }
});

test('failures at every command boundary block release', () => {
  for (const failAt of [0, 1, 2, 3, 4]) {
    let index = 0;
    expectFailure(runner({ failWhen: () => index++ === failAt }).run);
  }
});
