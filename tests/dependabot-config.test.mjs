import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DEPENDABOT_PATH = path.resolve('.github/dependabot.yml');

test('dependabot.yml defines grouping for npm and github-actions', () => {
  const content = fs.readFileSync(DEPENDABOT_PATH, 'utf8');

  // Verify npm groups
  assert.match(
    content,
    /groups:\s*\n\s*npm-dependencies:\s*\n\s*patterns:\s*\n\s*-\s*"\*"/m,
    'npm ecosystem must define npm-dependencies group with wildcard pattern'
  );

  // Verify github-actions groups
  assert.match(
    content,
    /groups:\s*\n\s*github-actions:\s*\n\s*patterns:\s*\n\s*-\s*"\*"/m,
    'github-actions ecosystem must define github-actions group with wildcard pattern'
  );
});
