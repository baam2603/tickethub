# TicketHub CI/CD Restructuring and End-to-End Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the full CI/CD transformation across all remaining phases: landing Stages 0 and 1 locally onto `unstable`, implementing Stage 2 with native Playwright orchestration and parallel CI caching, implementing Stage 3 with production Dockerfile and governance hardening, and verifying final linear landing.

**Architecture:** Staged sequential execution that strictly separates PR-safe application code from protected workflow infrastructure files (`.github/**`). Playwright orchestrates backend and frontend server lifecycles natively via `webServer` without shell backgrounding, and `ci.yml` is split into parallel caching jobs with unified error aggregation.

**Tech Stack:** GitHub Actions, Playwright v1.49+, Fastify NestJS, Next.js 16, pnpm v12, Docker multi-stage build, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-02-ci-pipeline-restructure-and-e2e-design.md`

## Global Constraints

- Zero emojis in any commit message, PR body, or documentation.
- Zero en-dash or em-dash characters in any output or file.
- Strictly no remote push operations (`git push` forbidden).
- Strict separation between PR branches and DIRECT commits based on the `PROTECTED_INFRASTRUCTURE_PATTERNS` regex in `scripts/pr-gate-check.mjs`.
- All checks must pass with zero warnings (`--max-warnings 0`, strict TypeScript).

## Review Focus

- Failure mode 1: Port conflict or hanging process during Playwright `webServer` launch in local dev when an existing API or Web instance is running (`reuseExistingServer: true` required).
- Failure mode 2: E2E test runner failure due to unseeded database in fresh CI virtual machine (isolated `e2e` job must run `pnpm db:migrate` and `pnpm db:seed` against its service container).
- Failure mode 3: Missing system shared libraries on Playwright browser cache hit (`playwright install-deps chromium` must execute even when cache hits).
- Failure mode 4: PR Gate rejection if `.github/workflows/**` edits are committed to a PR branch (must strictly quarantine to DIRECT branches).
- Failure mode 5: Container build failure or memory exhaustion if devDependencies or entire workspace is bundled into production image (`pnpm --filter @tickethub/api deploy --prod` required).

---

### Task 1: Local Landing of Stages 0 and 1 onto unstable

**Files:**
- Target Branch: `unstable`
- Source Branches: `fix/api-serialize-tests`, `fix/web-lint-warnings`, `ci/quick-wins`, `direct/ci-quick-wins`

**Interfaces:**
- Consumes: Approved commits `948d731`, `f140001`, `a61d5e6`, and `b89f8fd`.
- Produces: Updated local `unstable` branch containing all Stage 0 and Stage 1 improvements in a clean linear history.

- [ ] **Step 1: Checkout unstable and squash merge PR 1**
Run:
```bash
git checkout unstable
git merge --squash fix/api-serialize-tests
git commit -m "fix(api): serialize test runner to prevent integration test database collisions"
```
Expected: Clean commit on `unstable` modifying `apps/api/package.json`.

- [ ] **Step 2: Rebase and squash merge PR 2**
Run:
```bash
git checkout -B fix/web-lint-warnings origin/fix/web-lint-warnings
git rebase unstable
git checkout unstable
git merge --squash fix/web-lint-warnings
git commit -m "refactor(web): resolve lint warnings and convert img tags to next image"
```
Expected: Clean commit on `unstable` modifying 4 web files.

- [ ] **Step 3: Rebase and squash merge PR 3**
Run:
```bash
git checkout -B ci/quick-wins origin/ci/quick-wins
git rebase unstable
git checkout unstable
git merge --squash ci/quick-wins
git commit -m "chore(ci): enforce zero warnings and unify workspace lint scripts"
```
Expected: Clean commit on `unstable` modifying workspace package.json files and adding audit scripts.

- [ ] **Step 4: Cherry-pick DIRECT commit**
Run:
```bash
git cherry-pick b89f8fde4167dc53c10d41ca6788e2e7db5ab23e
```
Expected: Clean cherry-pick of `chore(ci): add concurrency group, early checks and audit summary`.

- [ ] **Step 5: Run pre-push checks on unstable**
Run:
```bash
/tmp/actionlint .github/workflows/ci.yml
node --test tests/ci-audit-summary.test.mjs
node --test tests/audit-doc-parity.test.mjs
node --test tests/pr-gate-check.test.mjs
git status
```
Expected: Actionlint passes with exit code 0, all 31 node tests pass, working tree is clean.

---

### Task 2: Playwright Native Dual-Mode WebServer Configuration (Stage 2 PR)

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `apps/api/dist/main.js` and Next.js start command.
- Produces: Native server lifecycle management in Playwright with `reuseExistingServer: true`.

- [ ] **Step 1: Create Stage 2 PR branch**
Run:
```bash
git checkout -b ci/e2e-playwright unstable
```
Expected: New branch `ci/e2e-playwright` branched from `unstable`.

- [ ] **Step 2: Update apps/web/playwright.config.ts**
Configure the `webServer` array to point to the production API build on port 4000 and Next.js on port 3000:
```typescript
  webServer: [
    {
      command: "node ../api/dist/main.js",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 30 * 1000,
    },
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60 * 1000,
    },
  ],
```

- [ ] **Step 3: Update apps/web/package.json test scripts**
Ensure test scripts in `apps/web/package.json` include `test:e2e` invoking `playwright test`.

- [ ] **Step 4: Verify local execution under dual-mode**
Run:
```bash
pnpm --filter @tickethub/shared build
pnpm --filter @tickethub/api build
pnpm --filter @tickethub/web build
pnpm --filter @tickethub/web test:e2e --project=chromium
```
Expected: Playwright automatically starts the servers (or reuses active ones), runs tests, and exits 0.

- [ ] **Step 5: Commit to ci/e2e-playwright**
Run:
```bash
git add apps/web/playwright.config.ts apps/web/package.json
git commit -m "chore(web): configure native dual-mode webServer for playwright e2e"
```
Expected: Clean commit on `ci/e2e-playwright` containing zero protected files.

---

### Task 3: Composite Environment Setup Action (Stage 2 DIRECT)

**Files:**
- Create: `.github/actions/setup-environment/action.yml`

**Interfaces:**
- Consumes: `pnpm-lock.yaml`, Node.js 22.
- Produces: Standardized Node environment, pnpm store cache, and frozen dependency installation across all jobs.

- [ ] **Step 1: Create Stage 2 DIRECT branch**
Run:
```bash
git checkout -b direct/ci-e2e-playwright ci/e2e-playwright
```
Expected: New branch `direct/ci-e2e-playwright` branched from `ci/e2e-playwright`.

- [ ] **Step 2: Implement .github/actions/setup-environment/action.yml**
Define composite action using `pnpm/action-setup@v4` and `actions/setup-node@v4` with `cache: 'pnpm'`:
```yaml
name: "Setup Environment"
description: "Setup Node.js, pnpm, and dependency cache"
inputs:
  node-version:
    description: "Node.js version"
    required: false
    default: "22"
runs:
  using: "composite"
  steps:
    - name: Install pnpm
      uses: pnpm/action-setup@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'pnpm'

    - name: Install dependencies
      shell: bash
      run: pnpm install --frozen-lockfile
```

- [ ] **Step 3: Validate composite action with actionlint**
Run:
```bash
/tmp/actionlint .github/actions/setup-environment/action.yml
```
Expected: Clean validation with exit code 0.

- [ ] **Step 4: Commit composite action**
Run:
```bash
git add .github/actions/setup-environment/action.yml
git commit -m "chore(ci): create reusable setup-environment composite action"
```
Expected: Clean commit on `direct/ci-e2e-playwright`.

---

### Task 4: Modular CI Workflow Restructuring (Stage 2 DIRECT)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `.github/actions/setup-environment`, `apps/web/playwright.config.ts`.
- Produces: Parallelized CI execution with `changes`, `static`, `db-drift`, `test`, `e2e`, `docker`, `ci-result`, and `publish`.

- [ ] **Step 1: Restructure .github/workflows/ci.yml**
Update `ci.yml` to define:
- `changes`: Path filtering using `dorny/paths-filter`.
- `static`: Uses `setup-environment`, runs `pnpm lint`, `pnpm format:check`, builds `@tickethub/shared`, runs typechecks, and executes `scripts/ci-audit-summary.mjs`.
- `db-drift`: Runs `drizzle-kit check`.
- `test`: Service containers for postgres and redis, runs migration/seed, executes serialized tests (`--test-concurrency=1`).
- `e2e`: Service containers for postgres and redis, builds shared, api, and web, caches Playwright browsers, installs system deps with `playwright install-deps chromium`, runs `playwright test`, and uploads `playwright-report` on failure.
- `docker`: Builds API Docker container without pushing on PRs.
- `ci-result`: Evaluates `if: always()` and verifies all required jobs succeeded.
- `publish`: Runs on `unstable` branch on push.

- [ ] **Step 2: Validate workflow with actionlint**
Run:
```bash
/tmp/actionlint .github/workflows/ci.yml
```
Expected: Clean validation with exit code 0.

- [ ] **Step 3: Commit workflow restructuring**
Run:
```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): split workflow into parallel caching jobs with native e2e"
```
Expected: Clean commit on `direct/ci-e2e-playwright`.

---

### Task 5: Stage 2 Verification and Local Landing onto unstable

**Files:**
- Target Branch: `unstable`
- Source Branches: `ci/e2e-playwright`, `direct/ci-e2e-playwright`

**Interfaces:**
- Consumes: Stage 2 commits.
- Produces: Updated `unstable` containing verified Stage 2 pipeline.

- [ ] **Step 1: Validate PR branch complies with gate rules**
Run a test script checking `git diff --name-only unstable..ci/e2e-playwright` against `PROTECTED_INFRASTRUCTURE_PATTERNS`.
Expected: Zero protected files in PR branch.

- [ ] **Step 2: Squash merge ci/e2e-playwright into unstable**
Run:
```bash
git checkout unstable
git merge --squash ci/e2e-playwright
git commit -m "chore(web): configure native dual-mode webServer for playwright e2e"
```
Expected: Clean commit on `unstable`.

- [ ] **Step 3: Cherry-pick DIRECT commits onto unstable**
Run:
```bash
git cherry-pick <direct-commit-sha-1> <direct-commit-sha-2>
```
Expected: Clean cherry-pick of composite action and `ci.yml` onto `unstable`.

- [ ] **Step 4: Run pre-push checks**
Run:
```bash
/tmp/actionlint .github/workflows/ci.yml
node --test tests/ci-audit-summary.test.mjs
node --test tests/audit-doc-parity.test.mjs
node --test tests/pr-gate-check.test.mjs
git status
```
Expected: Actionlint passes, all node tests pass, working tree is clean.

---

### Task 6: Scheduled Security Audit Workflow (Stage 3 DIRECT)

**Files:**
- Create: `.github/workflows/audit.yml`

**Interfaces:**
- Produces: Weekly security scan failing on high or critical advisories.

- [ ] **Step 1: Create Stage 3 DIRECT branch**
Run:
```bash
git checkout -b direct/ci-hardening unstable
```
Expected: New branch `direct/ci-hardening` from `unstable`.

- [ ] **Step 2: Create .github/workflows/audit.yml**
Define scheduled workflow:
```yaml
name: Security Audit

on:
  schedule:
    - cron: '0 0 * * 1'
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-environment
      - name: Run production security audit
        run: pnpm audit --prod --audit-level=high
```

- [ ] **Step 3: Validate audit.yml with actionlint**
Run:
```bash
/tmp/actionlint .github/workflows/audit.yml
```
Expected: Clean validation with exit code 0.

- [ ] **Step 4: Commit audit workflow**
Run:
```bash
git add .github/workflows/audit.yml
git commit -m "chore(ci): add scheduled weekly production security audit workflow"
```
Expected: Clean commit on `direct/ci-hardening`.

---

### Task 7: Production Multi-Stage Dockerfile for API (Stage 3 PR)

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`

**Interfaces:**
- Produces: Hardened production container for `@tickethub/api`.

- [ ] **Step 1: Create Stage 3 PR branch**
Run:
```bash
git checkout -b ci/hardening unstable
```
Expected: New branch `ci/hardening` from `unstable`.

- [ ] **Step 2: Update .dockerignore**
Ensure `node_modules`, `.git`, `.next`, `dist`, `playwright-report`, and `test-results` are ignored.

- [ ] **Step 3: Rewrite Dockerfile with multi-stage build**
Implement 4-stage build:
1. `base`: Alpine Node 22 + pnpm.
2. `dependencies`: Copy manifests and install frozen dependencies.
3. `builder`: Compile `@tickethub/shared` and `apps/api`, then prune with `pnpm --filter @tickethub/api deploy --prod /app/pruned`.
4. `runner`: Minimal Alpine, copy from `/app/pruned`, non-root user `USER node`, and `HEALTHCHECK` with Node.js native fetch.

- [ ] **Step 4: Build and test container locally**
Run:
```bash
docker build -t tickethub-api:test .
docker run --rm -d --name test-api -p 4001:4000 -e PORT=4000 -e NODE_ENV=production -e JWT_SECRET=tickethub-super-secret-development-jwt-key-2026-min-32-chars tickethub-api:test
docker inspect --format='{{json .State.Health}}' test-api || true
docker stop test-api
```
Expected: Container builds cleanly and runs as non-root user.

- [ ] **Step 5: Commit to ci/hardening**
Run:
```bash
git add Dockerfile .dockerignore
git commit -m "chore(docker): rewrite api dockerfile with multi-stage build and non-root user"
```
Expected: Clean commit on `ci/hardening`.

---

### Task 8: Sticky PR Gate Refactoring and Governance (Stage 3 PR & DIRECT)

**Files:**
- Modify: `.github/workflows/pr-gate.yml` (DIRECT)
- Create: `.github/dependabot.yml` (PR)
- Create: `.github/CODEOWNERS` (PR)
- Modify: `package.json` (PR)

**Interfaces:**
- Produces: Single sticky PR gate comment, minimal workflow permissions, dependabot config, and root `pnpm verify`.

- [ ] **Step 1: Update .github/dependabot.yml and .github/CODEOWNERS on ci/hardening**
Add dependabot configuration for weekly npm and github-actions updates, and add CODEOWNERS.

- [ ] **Step 2: Add pnpm verify script to root package.json on ci/hardening**
Update root `package.json` with `"verify": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm test"`.

- [ ] **Step 3: Commit PR files to ci/hardening**
Run:
```bash
git add .github/dependabot.yml .github/CODEOWNERS package.json
git commit -m "chore(repo): add dependabot, codeowners, and root verify script"
```
Expected: Clean commit on `ci/hardening`.

- [ ] **Step 4: Update .github/workflows/pr-gate.yml on direct/ci-hardening**
Switch to `direct/ci-hardening`. Update `pr-gate.yml`:
- Remove `actions: write` and workflow cancellation.
- Use `peter-evans/find-comment@v3` and `peter-evans/create-or-update-comment@v4` with comment marker `<!-- tickethub-pr-gate-marker -->`.

- [ ] **Step 5: Validate pr-gate.yml with actionlint**
Run:
```bash
/tmp/actionlint .github/workflows/pr-gate.yml
```
Expected: Clean validation with exit code 0.

- [ ] **Step 6: Commit PR gate updates on direct/ci-hardening**
Run:
```bash
git add .github/workflows/pr-gate.yml
git commit -m "chore(ci): refactor pr-gate to use sticky comments and minimal permissions"
```
Expected: Clean commit on `direct/ci-hardening`.

---

### Task 9: Stage 3 Verification and Final Landing onto unstable

**Files:**
- Target Branch: `unstable`
- Source Branches: `ci/hardening`, `direct/ci-hardening`

**Interfaces:**
- Produces: Complete, fully landed, production-ready CI/CD infrastructure on `unstable`.

- [ ] **Step 1: Validate ci/hardening complies with gate rules**
Run gate check on `ci/hardening` to ensure zero protected files exist in the PR branch.

- [ ] **Step 2: Squash merge ci/hardening into unstable**
Run:
```bash
git checkout unstable
git merge --squash ci/hardening
git commit -m "chore(repo): add multi-stage dockerfile, governance, and verify script"
```
Expected: Clean commit on `unstable`.

- [ ] **Step 3: Cherry-pick direct/ci-hardening commits onto unstable**
Run:
```bash
git cherry-pick <direct-audit-sha> <direct-pr-gate-sha>
```
Expected: Clean cherry-pick of `audit.yml` and `pr-gate.yml` onto `unstable`.

- [ ] **Step 4: Execute full pre-push test suite**
Run:
```bash
/tmp/actionlint .github/workflows/*.yml
node --test tests/ci-audit-summary.test.mjs
node --test tests/audit-doc-parity.test.mjs
node --test tests/pr-gate-check.test.mjs
pnpm verify
git status
```
Expected: All linters, format checks, typechecks, and tests pass with zero warnings; working tree is clean.

- [ ] **Step 5: Document maintainer landing log and rollback commands**
Produce final landing log showing git log graph and exact revert commands for rollback safety.
