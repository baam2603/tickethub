# Pull Request Review Report (Internal - For Project Manager)

- **Pull Request:** #[PR_NUMBER] - [PR_TITLE]
- **Author:** @[AUTHOR]
- **Branch:** `[HEAD_BRANCH]` into `[BASE_BRANCH]`
- **Checked Commit SHA:** `[HEAD_COMMIT_SHA]`
- **Business Context:** [Use Cases UC01 to UC12 in docs/system-design/03-use-cases.md]
- **Verdict:** [APPROVE | REQUEST_CHANGES | REJECT (SECURITY_VIOLATION) | REJECT (TRASH_CODE)]

---

## 1. Summary & Verdict
[Provide 2-3 objective paragraphs covering the PR objective, what the contributor implemented, how well it fulfills architectural requirements, and the rationale for the verdict.]

---

## 2. Automated Pre-Flight Verification Matrix
[Populate from running bash .agents/skills/pr-reviewer/scripts/verify-pr.sh PR_NUMBER]

| Verification Dimension | Result | Notes |
| :--- | :--- | :--- |
| Media URLs Reachable (Section 6) | [PASSED / FAILED / N/A] | [HTTP status codes or image links verified] |
| Prettier Code Style | [PASSED / FAILED] | [Code style compliance] |
| ESLint (Zero Warnings Enforced) | [PASSED / FAILED] | [ESLint status] |
| TypeScript Strict Types | [PASSED / FAILED] | [tsc --noEmit status] |
| Doc Parity & Root Tests | [PASSED / FAILED] | [API/ERD contract parity] |
| Workspace Test Suites | [PASSED / FAILED] | [pnpm test status] |

---

## 3. Static Diff Scanner Findings
[Populate from running bash .agents/skills/pr-reviewer/scripts/scan-diff.sh PR_NUMBER]
- **Status:** [CLEAN | ATTENTION REQUIRED | MANUAL AUDIT REQUIRED]
- **Warnings Detected:** [List warnings: raw <img>, console.log, any casting, empty catch, etc.]
- **Contextual Leads:** [List leads: localStorage usage, setTimeout, hex colors]

---

## 4. Severity Breakdown of Findings

### Severity: Blocker (Must be resolved before merging)
[Infrastructure tampering, mock auth/data on client, race conditions in ticket booking, security leaks, broken database transactions, API/ERD contract violations, compiler/test failures]

- **Finding B1:** [Short finding title]
  - **Location:** `[FILE_PATH]:[LINE_NUMBER]` - [GitHub Permalink](https://github.com/[OWNER]/[REPO]/blob/[HEAD_COMMIT_SHA]/[FILE_PATH]#L[LINE_NUMBER])
  - **Current Behavior:** [Describe what the code currently does and why it is wrong]
  - **Expected Behavior:** [Specify how the system must behave according to specifications]
  - **Production Impact:** [Concrete consequences: race condition, data corruption, outage, security vulnerability]

### Severity: Major (Significant architectural or code debt defect)
[Missing resource ownership checks, unhandled promises, empty catch blocks, ESLint warnings, raw <img> tags, arbitrary Tailwind hex colors, responsive layout breakage]

- **Finding M1:** [Title]
  - **Location:** `[FILE_PATH]:[LINE_NUMBER]` - [GitHub Permalink](https://github.com/[OWNER]/[REPO]/blob/[HEAD_COMMIT_SHA]/[FILE_PATH]#L[LINE_NUMBER])
  - **Current Behavior:** [Description]
  - **Expected Behavior:** [Specification]
  - **Production Impact:** [Consequences]

### Severity: Minor (Code quality cleanup needed)
[Careless any type usage, dead code/unused imports, redundant console.log]

- **Finding N1:** [Description with file:line location]

### Severity: Nit (Optional polish, non-blocking)
[Naming improvements, comment clarifications, formatting consistency]

- **Suggestion:** [Description]

---

## 5. Ready-to-Run GitHub CLI Review Command
[Pre-formatted command for PM execution]

```bash
gh pr review [PR_NUMBER] --request-changes -b "$(cat <<'EOF'
[PASTE_CONTRIBUTOR_COMMENT_HERE]
EOF
)"
```

---

## 6. Could Not Verify / Honest Limitations
[Parts of the PR that cannot be verified 100% via local inspection and must be monitored in staging/production]
- [Example: Sandbox webhook callback reliability from VNPay payment provider]
- [Example: High-concurrency throughput under 1000 requests/s on clustered Redis]
