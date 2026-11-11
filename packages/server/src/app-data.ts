import { homedir } from "node:os";
import { join } from "node:path";

export function appDataDir(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? (process.env["APPDATA"] ?? join(homedir(), "AppData/Roaming"))
    : join(homedir(), "Library/Application Support");
}
