# Dependabot Actions Consolidation and Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 9 individual Dependabot GitHub Actions upgrades into atomic workflow updates, configure Dependabot grouping, verify CI with actionlint and pnpm verify, and close redundant bot PRs.

**Architecture:** Update `.github/dependabot.yml` with group definitions for `npm-dependencies` and `github-actions`. Upgrade action versions to current major versions across `.github/workflows/ci.yml`, `audit.yml`, `pr-gate.yml`, and `.github/actions/setup-environment/action.yml`. Validate with actionlint and unit tests before closing open bot PRs.

**Tech Stack:** GitHub Actions, Dependabot v2, Node.js 22, pnpm, actionlint.

**Spec:** `docs/superpowers/specs/2026-11-02-dependabot-actions-consolidation-and-grouping-design.md`

## Global Constraints
- Strict conventional commit formatting for all commits.
- Strictly zero emojis in any commit message, file, or generated output.
- Strictly zero en-dash (\u2013) or em-dash (\u2014) characters in any file.
- Actionlint must pass on all workflow files with exit code 0.
- All unit tests and `pnpm verify` must pass cleanly.

## Review Focus
- Actionlint workflow schema compatibility with newer action major versions.
- Dependabot configuration YAML syntax and valid group patterns.
- Composite action (`setup-environment`) caching inputs and steps compatibility with `actions/cache@v6` and `actions/setup-node@v7`.
- Verification that all 9 bot PRs are cleanly superseded and closed without breaking active pipelines.

---

### Task 1: Dependabot Grouping Configuration

**Files:**
- Modify: `.github/dependabot.yml`
- Create: `tests/dependabot-config.test.mjs`

**Interfaces:**
- Consumes: Dependabot v2 schema specifications.
- Produces: Grouped PR rules for `npm-dependencies` and `github-actions`.

- [ ] **Step 1: Write failing unit test for dependabot grouping**
Write `tests/dependabot-config.test.mjs` asserting that `.github/dependabot.yml` defines groups for `npm-dependencies` and `github-actions` with wildcard pattern `*`.

- [ ] **Step 2: Run test to verify RED state**
Run:
```bash
node --test tests/dependabot-config.test.mjs
```
Expected: Test fails because groups are not yet present.

- [ ] **Step 3: Update .github/dependabot.yml**
Update `.github/dependabot.yml` to include groups for `npm-dependencies` and `github-actions`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      npm-dependencies:
        patterns:
          - "*"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      github-actions:
        patterns:
          - "*"
```

- [ ] **Step 4: Run test to verify GREEN state**
Run:
```bash
node --test tests/dependabot-config.test.mjs
```
Expected: Passes with exit code 0.

- [ ] **Step 5: Commit changes**
Run:
```bash
git add .github/dependabot.yml tests/dependabot-config.test.mjs
git commit -m "chore(deps): configure dependabot grouping for npm and github-actions"
```

---

### Task 2: GitHub Actions Version Upgrades

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/audit.yml`
- Modify: `.github/workflows/pr-gate.yml`
- Modify: `.github/actions/setup-environment/action.yml`
- Modify: `tests/ci-workflow.test.mjs`

**Interfaces:**
- Consumes: Released action versions `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`, `actions/github-script@v9`, `dorny/paths-filter@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/build-push-action@v7`.
- Produces: Updated workflow definitions adhering to newest action major releases.

- [ ] **Step 1: Write failing test in tests/ci-workflow.test.mjs**
Add assertions checking that `.github/workflows/ci.yml` references `@v7` for checkout and upload-artifact, and `@v4` for paths-filter.

- [ ] **Step 2: Run test to verify RED state**
Run:
```bash
node --test tests/ci-workflow.test.mjs
```
Expected: Test fails matching older versions.

- [ ] **Step 3: Update action references in workflow files**
Update `.github/workflows/ci.yml`:
- `actions/checkout@v4` -> `actions/checkout@v7`
- `dorny/paths-filter@v3` -> `dorny/paths-filter@v4`
- `actions/cache@v4` -> `actions/cache@v6`
- `actions/upload-artifact@v4` -> `actions/upload-artifact@v7`
- `docker/setup-buildx-action@v3` -> `docker/setup-buildx-action@v4`
- `docker/login-action@v3` -> `docker/login-action@v4`
- `docker/build-push-action@v6` -> `docker/build-push-action@v7`

Update `.github/workflows/audit.yml`:
- `actions/checkout@v4` -> `actions/checkout@v7`

Update `.github/workflows/pr-gate.yml`:
- `actions/checkout@v4` -> `actions/checkout@v7`
- `actions/github-script@v7` -> `actions/github-script@v9`

Update `.github/actions/setup-environment/action.yml`:
- `actions/setup-node@v4` -> `actions/setup-node@v7`

- [ ] **Step 4: Validate with actionlint and tests**
Run:
```bash
/tmp/actionlint .github/workflows/*.yml
node --test tests/ci-workflow.test.mjs
```
Expected: Actionlint reports 0 errors, node test passes.

- [ ] **Step 5: Commit changes**
Run:
```bash
git add .github/workflows/*.yml .github/actions/setup-environment/action.yml tests/ci-workflow.test.mjs
git commit -m "chore(ci): upgrade github actions to latest major versions"
```

---

### Task 3: Full Suite Verification, Push to Origin, and Close Redundant Bot PRs

**Files:**
- Target Branch: `unstable`

**Interfaces:**
- Consumes: Updated workflows and Dependabot configuration.
- Produces: Synchronized remote `origin/unstable` and closed PRs #32 through #40.

- [ ] **Step 1: Run full node tests**
Run:
```bash
node --test tests/*.test.mjs
```
Expected: All node tests pass.

- [ ] **Step 2: Run pnpm verify**
Run:
```bash
DATABASE_URL=postgresql://tickethub:tickethub_secret@localhost:5433/tickethub_ipn_test pnpm verify
```
Expected: Lint (0 warnings), format check, typecheck, and unit/integration tests all pass.

- [ ] **Step 3: Push unstable to origin**
Run:
```bash
git push origin unstable
```
Expected: Push succeeds on `origin/unstable`.

- [ ] **Step 4: Close redundant bot PRs**
Run:
```bash
gh pr close 32 33 34 35 36 37 38 39 40 --comment "Superseded by consolidated atomic upgrade and dependabot grouping on unstable."
```
Expected: All 9 Dependabot PRs closed.
