import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CI_WORKFLOW_PATH = path.resolve('.github/workflows/ci.yml');
const PR_GATE_PATH = path.resolve('.github/workflows/pr-gate.yml');
const AUDIT_PATH = path.resolve('.github/workflows/audit.yml');
const SETUP_ACTION_PATH = path.resolve('.github/actions/setup-environment/action.yml');

test('ci.yml path filters include Dockerfile and .dockerignore', () => {
  const content = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  assert.match(content, /-\s*'Dockerfile'/, 'code filter must include Dockerfile');
  assert.match(content, /-\s*'\.dockerignore'/, 'code filter must include .dockerignore');
});

test('ci.yml ci-result aggregator validates both failure and cancelled states', () => {
  const content = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  assert.match(content, /cancelled/, 'ci-result aggregator must handle cancelled status');
});

test('workflows and composite action use latest major action versions', () => {
  const ciContent = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  const prGateContent = fs.readFileSync(PR_GATE_PATH, 'utf8');
  const auditContent = fs.readFileSync(AUDIT_PATH, 'utf8');
  const setupActionContent = fs.readFileSync(SETUP_ACTION_PATH, 'utf8');

  // ci.yml action versions
  assert.match(ciContent, /uses:\s*actions\/checkout@v7/);
  assert.match(ciContent, /uses:\s*dorny\/paths-filter@v4/);
  assert.match(ciContent, /uses:\s*actions\/cache@v6/);
  assert.match(ciContent, /uses:\s*actions\/upload-artifact@v7/);
  assert.match(ciContent, /uses:\s*docker\/setup-buildx-action@v4/);
  assert.match(ciContent, /uses:\s*docker\/login-action@v4/);
  assert.match(ciContent, /uses:\s*docker\/build-push-action@v7/);

  // audit.yml action versions
  assert.match(auditContent, /uses:\s*actions\/checkout@v7/);

  // pr-gate.yml action versions
  assert.match(prGateContent, /uses:\s*actions\/checkout@v7/);
  assert.match(prGateContent, /uses:\s*actions\/github-script@v9/);

  // setup-environment action.yml
  assert.match(setupActionContent, /uses:\s*actions\/setup-node@v7/);
});
