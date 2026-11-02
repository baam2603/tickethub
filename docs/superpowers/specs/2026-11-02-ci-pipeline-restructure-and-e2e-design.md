# Technical Design: TicketHub CI/CD Restructuring and End-to-End Orchestration

## 1. Intent and Context

The TicketHub repository is a monorepo containing a NestJS/Fastify backend (`apps/api`), a Next.js frontend (`apps/web`), and a shared TypeScript library (`packages/shared`). 

Prior to this initiative, CI/CD execution suffered from:
- Fragile E2E testing in GitHub Actions using ad-hoc shell background processes (`nohup`, `sleep 5`), leading to intermittent timeouts, port collisions, and lack of artifact collection upon failure.
- Sequential monolithic execution in `ci.yml` that prolonged build times and lacked caching for pnpm stores, Playwright browser binaries, and Next.js compiler caches.
- Integration test suite race conditions on shared databases when concurrency was unconstrained.
- Security and audit checks that failed normal PRs on non-critical warnings or leaked privileged tokens.
- Container Dockerfiles that copied entire workspaces prior to dependency installation, bundled devDependencies, ran as root, and omitted health checks.

Stages 0 and 1 have successfully addressed web lint debt, test serialization (`--test-concurrency=1`), and automated PR audit reporting. This design specifies the remaining steps to bring the entire pipeline to completed status ("done").

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Land the verified Stage 0 and Stage 1 branches cleanly onto local `unstable` with a linear history and zero merge conflicts.
- Implement Stage 2 (`ci/e2e-playwright`):
  - Replace shell backgrounding with Playwright native `webServer` orchestration supporting dual-mode operation (existing local servers vs freshly spawned CI servers).
  - Split `ci.yml` into granular parallel jobs (`changes`, `static`, `db-drift`, `test`, `e2e`, `docker`, `ci-result`, `publish`).
  - Introduce a reusable composite action (`.github/actions/setup-environment`).
  - Implement caching across pnpm, Playwright browser binaries (with `install-deps`), and Next.js build caches.
  - Isolate PR-safe modifications (`apps/web/**`) from protected workflow modifications (`.github/**`).
- Implement Stage 3 (`ci/hardening`):
  - Create a dedicated scheduled weekly audit workflow (`.github/workflows/audit.yml`) where high/critical advisories fail the run.
  - Rewrite the production `Dockerfile` for `@tickethub/api` with multi-stage builds, non-root user, proper layer caching, and a container HEALTHCHECK using Node.js native fetch.
  - Refactor `pr-gate.yml` to eliminate auto-closing PRs and spamming duplicate comments, replacing it with a single sticky comment using minimal permissions.
  - Add repository governance configuration (`dependabot.yml`, `CODEOWNERS`, root `pnpm verify` script).
- Verify complete end-to-end landing and generate maintainer documentation.

### Non-Goals
- Pushing any branch, commit, or tag to the remote GitHub origin (local execution only).
- Refactoring application business logic or adding new application runtime features in `apps/api` or `apps/web`.
- Modifying test specifications in `apps/web/test` unless strictly necessary for deterministic execution under production builds.

### Anti-Goals
- Introducing any shell backgrounding (`&`, `nohup`, `wait-on`, `sleep`) to start servers in CI.
- Blending protected infrastructure edits (`.github/**`) into PR branches that must pass `scripts/pr-gate-check.mjs`.
- Allowing security audit warnings on PRs to block normal development; PR audits must inform via step summary, while scheduled workflows enforce failure.

## 3. Constraints

- Zero emojis in any commit message, PR body, or documentation.
- Zero en-dash or em-dash characters in any output or file.
- Strictly no remote push operations (`git push` forbidden).
- Strict separation between PR branches and DIRECT commits based on the `PROTECTED_INFRASTRUCTURE_PATTERNS` regex in `scripts/pr-gate-check.mjs`.
- All checks must pass with zero warnings (`--max-warnings 0`, strict TypeScript).

## 4. Approaches Considered

### Approach 1: Sequential Stage Execution (Selected)
- **Description:** Execute each phase sequentially: land Stage 0/1 locally onto `unstable`, implement and verify Stage 2 (`ci/e2e-playwright`), implement and verify Stage 3 (`ci/hardening`), and finalize.
- **Tradeoffs:** Requires sequential branch management and individual verification gates, but ensures absolute defect isolation between runtime test orchestration (Playwright, Fastify, Next.js) and operational governance (Docker, Dependabot, PR gate permissions).
- **Decision:** Selected because it minimizes blast radius and prevents compounding errors across disparate CI domains.

### Approach 2: Monolithic Consolidation (Rejected)
- **Description:** Combine Stages 2 and 3 into a single massive overhaul modifying `ci.yml`, `playwright.config.ts`, `Dockerfile`, `pr-gate.yml`, and `audit.yml` concurrently.
- **Tradeoffs:** Avoids intermediate branch staging, but combines browser execution debugging with Docker multi-stage build debugging. A failure in CI would require diagnosing across multiple systems simultaneously, and creates an enormous DIRECT commit that is difficult to audit or rollback.
- **Decision:** Rejected due to high risk and poor maintainability.

## 5. Architectural and Implementation Specification

### Phase 1: Local Landing of Stage 0 and Stage 1
1. On local `unstable`, sequentially merge:
   - PR 1: `fix/api-serialize-tests` (commit `948d731`) via squash commit.
   - PR 2: `fix/web-lint-warnings` (commit `f140001`) via rebase and squash commit.
   - PR 3: `ci/quick-wins` (commit `a61d5e6`) via rebase and squash commit.
2. Apply DIRECT commit `b89f8fde4167dc53c10d41ca6788e2e7db5ab23e` onto `unstable` via `git cherry-pick`.
3. Verify git log is strictly linear and run pre-push validation (`actionlint`, Node test suites).

### Phase 2: Stage 2 Pipeline Restructure and Native E2E

#### 1. Playwright Dual-Mode WebServer Configuration (`apps/web/playwright.config.ts`)
- The webServer array in `apps/web/playwright.config.ts` must define both services:
  - API Service:
    - Command: `node ../api/dist/main.js` (requires `apps/api` build prior to test execution)
    - URL: `http://localhost:4000/health`
    - Timeout: 30000ms
    - `reuseExistingServer: true` (ensures that if an API is already running locally or in older CI environments on port 4000, Playwright reuses it instead of crashing)
  - Web Service:
    - Command: `pnpm --filter @tickethub/web start` (production serving)
    - URL: `http://localhost:3000`
    - Timeout: 60000ms
    - `reuseExistingServer: true`
- This dual-mode setup guarantees zero downtime or crashes during transition between CI configurations.

#### 2. Composite Environment Action (`.github/actions/setup-environment/action.yml`)
- Create an action that standardizes environment setup across all jobs:
  - Inputs: `node-version` (default 22), `enable-cache` (default true).
  - Uses `pnpm/action-setup@v4`.
  - Uses `actions/setup-node@v4` with `cache: 'pnpm'`.
  - Runs `pnpm install --frozen-lockfile`.

#### 3. Granular CI Workflow Restructuring (`.github/workflows/ci.yml`)
- Split the monolithic workflow into modular jobs:
  - `changes`: Detects modified paths using `dorny/paths-filter` to skip redundant downstream jobs on docs-only changes.
  - `static`: Runs `pnpm lint`, `pnpm format:check`, and `pnpm --filter @tickethub/shared build` followed by workspace typechecks in parallel. Also houses the non-blocking PR dependency audit via `node scripts/ci-audit-summary.mjs` writing to `$GITHUB_STEP_SUMMARY`.
  - `db-drift`: Runs database migration generation check (`pnpm --filter @tickethub/api exec drizzle-kit check`) to detect uncommitted schema changes.
  - `test`: Spawns PostgreSQL (5432) and Redis (6379) service containers, runs migrations and seeds via `DATABASE_URL: postgresql://postgres:postgres@localhost:5432/tickethub_dev`, executes API unit/integration tests with `--test-concurrency=1`, and records step summary.
  - `e2e`: Depends on `static` and `test`. Declares its own isolated PostgreSQL (5432) and Redis (6379) service containers. Sets up environment via composite action, builds `@tickethub/shared`, `apps/api`, and `apps/web`. Runs database migration and seeding for the e2e environment. Installs Playwright Chromium with `pnpm --filter @tickethub/web exec playwright install --with-deps chromium`. Executes Playwright tests. Uploads `playwright-report/` and failure screenshots as artifacts on failure.
  - `docker`: Builds Docker container without pushing, validating build cache on pull requests.
  - `ci-result`: Uses `if: always()` to aggregate statuses from all jobs, ensuring branch protection checks evaluate a single clean status.
  - `publish`: Runs only on `unstable` branch on push to build and push container images to GHCR.

#### 4. Caching Configuration
- Caching `~/.cache/ms-playwright` keyed by Playwright version and OS runner. On cache hit, still execute `pnpm --filter @tickethub/web exec playwright install-deps chromium` to guarantee system shared libraries are present.
- Caching `apps/web/.next/cache` keyed by runner OS, lockfile, and web source hash.

#### 5. Commit Isolation
- Branch `ci/e2e-playwright`: Contains `apps/web/playwright.config.ts` and `apps/web/package.json`. No changes to `.github/**`.
- Branch `direct/ci-e2e-playwright`: Contains `.github/workflows/ci.yml` and `.github/actions/**`. Cherry-picked directly onto `unstable`.

### Phase 3: Stage 3 CI Hardening and Operational Governance

#### 1. Scheduled Security Workflow (`.github/workflows/audit.yml`)
- Runs on a cron schedule (weekly) and on manual `workflow_dispatch`.
- Executes `pnpm audit --prod --audit-level=high`.
- Exits with a failure code if high or critical vulnerabilities are detected, triggering maintenance alerts.

#### 2. Multi-Stage Production Container (`Dockerfile`)
- Target: `@tickethub/api` (frontend containerization is managed by `docker/Dockerfile.web`).
- Rewrite `Dockerfile` using multi-stage builds:
  - Stage 1 (`base`): Alpine base with Node.js 22 and pnpm.
  - Stage 2 (`dependencies`): Copy lockfile and package manifests, install with frozen lockfile.
  - Stage 3 (`builder`): Build shared package and compile API. Prune dev dependencies using `pnpm --filter @tickethub/api deploy --prod /prod/api`.
  - Stage 4 (`runner`): Alpine runtime, copy compiled output and production node_modules from `/prod/api`. Run as non-root user (`USER node`). Expose healthcheck directive using Node.js native fetch (no curl dependency required):
    `HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e 'fetch("http://localhost:4000/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'`

#### 3. PR Gate Refactoring (`.github/workflows/pr-gate.yml`)
- Remove automatic PR closure.
- Remove cancellation of other workflow runs (`actions: write` eliminated; least privilege `pull-requests: write`, `contents: read`).
- Replace iterative comment posting with a single sticky comment identified by an HTML comment marker (`<!-- tickethub-pr-gate-marker -->`), updating existing comments on new pushes.

#### 4. Repository Governance
- Add `.github/dependabot.yml` configured for monthly npm dependency updates and GitHub Actions updates.
- Add `.github/CODEOWNERS` defining ownership for infrastructure, backend, and frontend.
- Add root `pnpm verify` script running all linters, typechecks, tests, and formatting checks locally before PR submission.

#### 5. Commit Isolation for Stage 3
- Branch `ci/hardening`: Contains non-protected files (`Dockerfile`, `.dockerignore`, `package.json`, `.github/dependabot.yml`, `.github/CODEOWNERS`). These files do not match `PROTECTED_INFRASTRUCTURE_PATTERNS`.
- Branch `direct/ci-hardening`: Contains protected workflow files (`.github/workflows/audit.yml`, `.github/workflows/pr-gate.yml`). Cherry-picked directly onto `unstable`.

### Phase 4: Final Verification and Handoff
- Re-simulate landing of all stages on a fresh clone.
- Run full pre-push suites and verify zero warnings.
- Output maintainer instructions for landing onto origin `unstable`.

## 6. What Is Left to the Implementer

- Specific step names and concise formatting inside the composite GitHub action.
- Exact timeout limits per job in `ci.yml` (e.g. 10m for static, 15m for test, 20m for e2e).
- Test file naming and structure for any new unit tests covering composite scripts or sticky PR gate helpers.
