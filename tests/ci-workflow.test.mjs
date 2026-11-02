import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CI_WORKFLOW_PATH = path.resolve('.github/workflows/ci.yml');

test('ci.yml path filters include Dockerfile and .dockerignore', () => {
  const content = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  assert.match(content, /-\s*'Dockerfile'/, 'code filter must include Dockerfile');
  assert.match(content, /-\s*'\.dockerignore'/, 'code filter must include .dockerignore');
});

test('ci.yml ci-result aggregator validates both failure and cancelled states', () => {
  const content = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  assert.match(content, /cancelled/, 'ci-result aggregator must handle cancelled status');
});
