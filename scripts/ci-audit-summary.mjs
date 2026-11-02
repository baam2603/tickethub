import fs from "node:fs";

export function processAuditResults({
  stdout = "",
  stderr = "",
  exitCode = 0,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
}) {
  let parsed = null;
  const trimmedStdout = stdout.trim();

  // Attempt JSON parsing of stdout only
  if (trimmedStdout) {
    try {
      parsed = JSON.parse(trimmedStdout);
    } catch {
      parsed = null;
    }
  }

  // 1. If stdout parses as valid JSON with metadata.vulnerabilities, trust it completely and ignore stderr.
  if (parsed && parsed.metadata && parsed.metadata.vulnerabilities) {
    const high = parsed.metadata.vulnerabilities.high ?? 0;
    const critical = parsed.metadata.vulnerabilities.critical ?? 0;
    const total = high + critical;

    if (total > 0) {
      console.log(
        `::warning::Security audit found ${total} high or critical advisories in production dependencies`,
      );
      if (summaryPath) {
        let md = `### Dependency Audit (Production)\n\nWarning: Found ${total} high or critical advisories in production dependencies.\n\n| Package | Severity | Title | Patched Version | Advisory |\n| --- | --- | --- | --- | --- |\n`;
        const advisories = parsed.advisories || {};
        for (const [key, val] of Object.entries(advisories)) {
          const sev = (val.severity || "").toLowerCase();
          if (sev !== "high" && sev !== "critical") {
            continue;
          }
          const pkg = val.module_name || key;
          const title = (val.title || "").replace(/\|/g, "-");
          const patched = (
            val.patched_versions ||
            val.recommendation ||
            "N/A"
          ).replace(/\|/g, "-");
          const advUrl = val.url
            ? `[Link](${val.url})`
            : val.github_advisory_id || "-";
          md += `| ${pkg} | ${val.severity} | ${title} | ${patched} | ${advUrl} |\n`;
        }
        fs.appendFileSync(summaryPath, md);
      }
      return { outcome: "advisories_found", count: total, exitCode: 0 };
    }

    // High and critical are zero -> Clean
    console.log(
      "No high or critical advisories found in production dependencies.",
    );
    if (summaryPath) {
      fs.appendFileSync(
        summaryPath,
        "### Dependency Audit (Production)\n\nNo high or critical advisories found in production dependencies.\n",
      );
    }
    return { outcome: "clean", count: 0, exitCode: 0 };
  }

  // 2. Only if stdout is not usable, classify as network or registry error from stderr and exit code
  const isNetworkOrRegistryError =
    exitCode === 124 ||
    stderr.includes("ECONNREFUSED") ||
    stderr.includes("ENOTFOUND") ||
    stderr.includes("ETIMEDOUT") ||
    stderr.includes("ERR_PNPM_FETCH") ||
    stderr.includes("fetch failed") ||
    stderr.includes("registry.npmjs.org") ||
    stderr.includes("Registry error") ||
    (exitCode !== 0 && stderr.trim().length > 0);

  if (isNetworkOrRegistryError) {
    console.log(
      "::warning::Security audit registry is unreachable or returned an error. Audit check skipped.",
    );
    if (summaryPath) {
      fs.appendFileSync(
        summaryPath,
        "### Dependency Audit (Production)\n\nWarning: Security audit registry is unreachable or returned a network error. Production dependency audit could not be completed.\n",
      );
    }
    return { outcome: "network_error", exitCode: 0 };
  }

  // 3. Otherwise unparseable (e.g. empty stdout with exit code 0, non-JSON garbage, missing metadata)
  console.log(
    "::warning::Security audit output could not be parsed. Audit status is UNKNOWN.",
  );
  if (summaryPath) {
    fs.appendFileSync(
      summaryPath,
      "### Dependency Audit (Production)\n\nWarning: Security audit output could not be parsed. Audit status is UNKNOWN.\n",
    );
  }
  return { outcome: "unparseable", exitCode: 0 };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("ci-audit-summary.mjs")) {
  const stdoutPath = process.argv[2];
  const stderrPath = process.argv[3];
  const rawExitCode =
    process.argv[4] !== undefined ? parseInt(process.argv[4], 10) : 0;

  const stdout =
    stdoutPath && fs.existsSync(stdoutPath)
      ? fs.readFileSync(stdoutPath, "utf8")
      : "";
  const stderr =
    stderrPath && fs.existsSync(stderrPath)
      ? fs.readFileSync(stderrPath, "utf8")
      : "";

  processAuditResults({
    stdout,
    stderr,
    exitCode: rawExitCode,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });

  process.exit(0);
}
