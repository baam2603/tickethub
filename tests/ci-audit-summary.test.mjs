import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { processAuditResults } from "../scripts/ci-audit-summary.mjs";

function withTempSummary(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-audit-test-"));
  const summaryPath = path.join(tmpDir, "step-summary.md");
  try {
    fn(summaryPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("ci-audit-summary: Outcome A (clean - zero high and critical)", () => {
  withTempSummary((summaryPath) => {
    const cleanJson = JSON.stringify({
      advisories: {},
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
        dependencies: 317,
        devDependencies: 0,
        optionalDependencies: 95,
        totalDependencies: 412,
      },
    });

    const res = processAuditResults({
      stdout: cleanJson,
      stderr: "",
      exitCode: 0,
      summaryPath,
    });

    assert.equal(res.outcome, "clean");
    assert.equal(res.count, 0);
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes(
        "No high or critical advisories found in production dependencies.",
      ),
    );
  });
});

test("ci-audit-summary: Outcome B (advisories found - filters table to high/critical only)", () => {
  withTempSummary((summaryPath) => {
    const advisoryJson = JSON.stringify({
      advisories: {
        1106913: {
          id: 1106913,
          module_name: "vulnerable-package",
          severity: "high",
          title: "Prototype Pollution in vulnerable-package",
          vulnerable_versions: "<2.0.0",
          patched_versions: ">=2.0.0",
          github_advisory_id: "GHSA-1234-5678",
          url: "https://github.com/advisories/GHSA-1234-5678",
        },
        1106920: {
          id: 1106920,
          module_name: "critical-package",
          severity: "critical",
          title: "Remote Code Execution in critical-package",
          vulnerable_versions: "<3.1.0",
          patched_versions: ">=3.1.0",
          github_advisory_id: "GHSA-9876-5432",
          url: "https://github.com/advisories/GHSA-9876-5432",
        },
        1106999: {
          id: 1106999,
          module_name: "moderate-package",
          severity: "moderate",
          title: "Moderate advisory that should be omitted from table",
          vulnerable_versions: "<1.0.0",
          patched_versions: ">=1.0.0",
          github_advisory_id: "GHSA-0000-0000",
          url: "https://github.com/advisories/GHSA-0000-0000",
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 1 },
        dependencies: 317,
        devDependencies: 0,
        optionalDependencies: 95,
        totalDependencies: 412,
      },
    });

    const res = processAuditResults({
      stdout: advisoryJson,
      stderr: "",
      exitCode: 1,
      summaryPath,
    });

    assert.equal(res.outcome, "advisories_found");
    assert.equal(res.count, 2);
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(summary.includes("Warning: Found 2 high or critical advisories"));
    assert.ok(summary.includes("vulnerable-package"));
    assert.ok(summary.includes("critical-package"));
    assert.ok(!summary.includes("moderate-package"));
  });
});

test("ci-audit-summary: Outcome C (registry/network error)", () => {
  withTempSummary((summaryPath) => {
    const res = processAuditResults({
      stdout: "",
      stderr:
        "ERR_PNPM_FETCH GET https://registry.npmjs.org/-/npm/v1/security/audits: request to registry failed: ETIMEDOUT",
      exitCode: 1,
      summaryPath,
    });

    assert.equal(res.outcome, "network_error");
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes("registry is unreachable or returned a network error"),
    );
  });
});

test("ci-audit-summary: Outcome D (unparseable output - garbage text)", () => {
  withTempSummary((summaryPath) => {
    const res = processAuditResults({
      stdout: "502 Bad Gateway HTML Response",
      stderr: "",
      exitCode: 0,
      summaryPath,
    });

    assert.equal(res.outcome, "unparseable");
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes("output could not be parsed. Audit status is UNKNOWN."),
    );
  });
});

test("ci-audit-summary: valid JSON with exit code 1 and stderr mentioning registry (ignores stderr and reports advisories)", () => {
  withTempSummary((summaryPath) => {
    const advisoryJson = JSON.stringify({
      advisories: {
        1106913: {
          id: 1106913,
          module_name: "lodash",
          severity: "high",
          title: "Prototype Pollution in lodash",
          vulnerable_versions: "<4.17.21",
          patched_versions: ">=4.17.21",
          github_advisory_id: "GHSA-35jh-r3h4-6jhm",
          url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        dependencies: 10,
        devDependencies: 0,
        optionalDependencies: 0,
        totalDependencies: 10,
      },
    });

    const res = processAuditResults({
      stdout: advisoryJson,
      stderr: "npm notice: registry.npmjs.org returned some notice",
      exitCode: 1,
      summaryPath,
    });

    assert.equal(res.outcome, "advisories_found");
    assert.equal(res.count, 1);
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(summary.includes("Warning: Found 1 high or critical advisories"));
    assert.ok(summary.includes("lodash"));
  });
});

test("ci-audit-summary: moderate-only advisories (clean)", () => {
  withTempSummary((summaryPath) => {
    const moderateOnlyJson = JSON.stringify({
      advisories: {
        999: {
          id: 999,
          module_name: "semver",
          severity: "moderate",
          title: "Regular Expression Denial of Service in semver",
          vulnerable_versions: "<7.5.2",
          patched_versions: ">=7.5.2",
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 3, high: 0, critical: 0 },
        dependencies: 15,
        devDependencies: 0,
        optionalDependencies: 0,
        totalDependencies: 15,
      },
    });

    const res = processAuditResults({
      stdout: moderateOnlyJson,
      stderr: "",
      exitCode: 0,
      summaryPath,
    });

    assert.equal(res.outcome, "clean");
    assert.equal(res.count, 0);
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes(
        "No high or critical advisories found in production dependencies.",
      ),
    );
  });
});

test("ci-audit-summary: valid JSON where metadata is missing (unparseable)", () => {
  withTempSummary((summaryPath) => {
    const invalidJson = JSON.stringify({
      advisories: {},
      status: "ok",
    });

    const res = processAuditResults({
      stdout: invalidJson,
      stderr: "",
      exitCode: 0,
      summaryPath,
    });

    assert.equal(res.outcome, "unparseable");
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes("output could not be parsed. Audit status is UNKNOWN."),
    );
  });
});

test("ci-audit-summary: empty stdout with exit code 0 and empty stderr (unparseable)", () => {
  withTempSummary((summaryPath) => {
    const res = processAuditResults({
      stdout: "",
      stderr: "",
      exitCode: 0,
      summaryPath,
    });

    assert.equal(res.outcome, "unparseable");
    assert.equal(res.exitCode, 0);

    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.ok(
      summary.includes("output could not be parsed. Audit status is UNKNOWN."),
    );
  });
});
