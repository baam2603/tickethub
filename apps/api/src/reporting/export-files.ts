import { resolve, basename, join } from "node:path";
export const reportDirectory = () =>
  resolve(process.env.REPORT_EXPORT_DIR ?? "tmp/report-exports");
export function exportFilePath(name: string) {
  if (name !== basename(name) || !/^[a-f\d-]{73}\.(csv|xlsx)$/.test(name))
    throw new Error("INVALID_EXPORT_FILE");
  return join(reportDirectory(), name);
}
