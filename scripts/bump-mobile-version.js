#!/usr/bin/env node
/**
 * Bumps app/app.json version based on PR commit messages (conventional commits).
 * - Any "feat:" commit → bump minor, reset patch to 0
 * - Otherwise (only "fix:" or other) → bump patch
 *
 * Usage:
 *   BASE_VERSION=1.0.0 BASE_REF=origin/main node scripts/bump-mobile-version.js
 *
 * Reads commit messages from: git log ${BASE_REF}..HEAD --pretty=format:%s
 * Writes new version to app/app.json (expo.version).
 */

const fs = require('fs');
const { execSync } = require('child_process');

const APP_JSON_PATH = 'app/app.json';

const BASE_VERSION = process.env.BASE_VERSION;
const BASE_REF = process.env.BASE_REF || 'origin/main';

if (!BASE_VERSION) {
  console.error('Missing BASE_VERSION environment variable');
  process.exit(1);
}

const FEAT_RE = /^feat(\([^)]*\))?!?:/;

function parseSemver(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?(?:\+[\w.]+)?$/);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function toSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function getCommitSubjects(baseRef, headRef = 'HEAD') {
  const range = `${baseRef}..${headRef}`;
  try {
    const out = execSync(`git log ${range} --pretty=format:%s`, { encoding: 'utf8' });
    return out ? out.trim().split('\n').filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function computeBump(baseVersion, subjects) {
  const v = parseSemver(baseVersion);
  const hasFeat = subjects.some((s) => FEAT_RE.test(s));
  if (hasFeat) {
    return toSemver({ major: v.major, minor: v.minor + 1, patch: 0 });
  }
  return toSemver({ major: v.major, minor: v.minor, patch: v.patch + 1 });
}

function main() {
  const subjects = getCommitSubjects(BASE_REF);
  const newVersion = computeBump(BASE_VERSION, subjects);

  const data = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
  if (!data.expo) throw new Error('Missing expo key in app.json');
  const oldVersion = data.expo.version;
  data.expo.version = newVersion;
  fs.writeFileSync(APP_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log(`Bumped mobile version: ${oldVersion} -> ${newVersion}`);
  if (subjects.some((s) => FEAT_RE.test(s))) {
    console.log('(minor bump: PR includes feat: commits)');
  } else {
    console.log('(patch bump: fix: or other commits only)');
  }
}

main();
