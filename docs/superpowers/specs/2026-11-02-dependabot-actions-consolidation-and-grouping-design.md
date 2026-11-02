# Technical Design: Dependabot Actions Consolidation and Grouping

**Date:** 2026-11-02
**Author:** Antigravity / Pair Programming Agent
**Status:** PROPOSED

## 1. Intent and Why
GitHub Dependabot opened 9 individual pull requests (#32 to #40) to bump GitHub Actions versions across workflow and action files. Because `.github/workflows/**` is classified as protected infrastructure by TicketHub PR Gate, all 9 bot PRs failed the `PR Strict Gate` check. Merging 9 separate PRs that edit overlapping lines in `.github/workflows/ci.yml` would also trigger repeated merge conflicts. Consolidating these upgrades into one atomic maintainer update on `unstable` and configuring Dependabot grouping eliminates PR storms and cleanly updates all actions.

## 2. Goals, Non-Goals, and Anti-Goals
- **Goals:**
  - Consolidate all 9 GitHub Actions upgrades across `.github/workflows/*.yml` and `.github/actions/setup-environment/action.yml` into a single atomic commit.
  - Upgrade `.github/dependabot.yml` to define grouped updates for `github-actions` and `npm`, so future updates arrive as single consolidated PRs.
  - Verify all workflows with `/tmp/actionlint` and run full repository checks with `pnpm verify`.
  - Close the 9 redundant individual bot PRs (#32 to #40).
- **Non-Goals:**
  - Modify PR Gate rules to allow external or bot PRs to edit `.github/workflows/**` (infrastructure remains protected).
  - Update npm dependencies in this pass (npm dependencies are evaluated separately).
- **Anti-Goals:**
  - Merging 9 separate PRs sequentially through manual web UI rebases.
  - Weakening the PR Gate tamper-guard security boundary.

## 3. Constraints
- Strict adherence to conventional commit format.
- Zero emojis in commit messages, workflow files, or documentation.
- Zero en-dash (\u2013) or em-dash (\u2014) characters in any file.
- Actionlint must pass with exit code 0.
- All 33 root tests and `pnpm verify` must pass cleanly.

## 4. Approaches Considered
- **Approach 1: Consolidate all 9 bumps into one atomic commit and enable Dependabot grouping (Selected)**
  - *Trade-offs:* Keeps git history minimal and clean, preserves workflow security invariants, and configures Dependabot grouping to prevent future 9-PR floods.
  - *Why selected:* Best balance of security, clean git history, and long-term maintainability.
- **Approach 2: Relax PR Gate rules for Dependabot PRs (Rejected)**
  - *Trade-offs:* Allows bot PRs to modify protected workflows, requiring 8 sequential rebases and creating a potential bypass vector for infrastructure tamper-guard rules.

## 5. Implementation Specifications

### 5.1 Dependabot Configuration Upgrade (`.github/dependabot.yml`)
Add `groups` to bundle updates:
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

### 5.2 Actions Version Upgrades
Upgrade action references across `.github/workflows/ci.yml`, `audit.yml`, `pr-gate.yml`, and `.github/actions/setup-environment/action.yml`:
- `actions/checkout`: `@v4` -> `@v7`
- `actions/setup-node`: `@v4` -> `@v7`
- `actions/cache`: `@v4` -> `@v6`
- `actions/upload-artifact`: `@v4` -> `@v7`
- `actions/github-script`: `@v7` -> `@v9`
- `dorny/paths-filter`: `@v3` -> `@v4`
- `docker/setup-buildx-action`: `@v3` -> `@v4`
- `docker/login-action`: `@v3` -> `@v4`
- `docker/build-push-action`: `@v6` -> `@v7`

### 5.3 Verification and Closure
1. Run `/tmp/actionlint .github/workflows/*.yml`.
2. Run `node --test tests/*.test.mjs`.
3. Run `pnpm verify`.
4. Close open bot PRs:
   `gh pr close 32 33 34 35 36 37 38 39 40 --comment "Superseded by consolidated atomic upgrade and dependabot grouping on unstable."`
