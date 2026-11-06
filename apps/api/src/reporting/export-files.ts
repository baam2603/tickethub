import { resolve, basename, join, isAbsolute } from "node:path";
export function reportDirectory() {
  const configured = process.env.REPORT_EXPORT_DIR;
  if (
    process.env.NODE_ENV === "production" &&
    (!configured || !isAbsolute(configured))
  )
    throw new Error("REPORT_EXPORT_DIR_MUST_BE_ABSOLUTE");
  return resolve(configured ?? "tmp/report-exports");
}
export function exportFilePath(name: string) {
  if (name !== basename(name) || !/^[a-f\d-]{73}\.(csv|xlsx)$/.test(name))
    throw new Error("INVALID_EXPORT_FILE");
  return join(reportDirectory(), name);
}
