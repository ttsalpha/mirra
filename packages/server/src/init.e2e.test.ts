import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, test } from "vitest";

const SERVER_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const run = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mirra-init-"));
});

async function init(...flags: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, [SERVER_ENTRY, "init", "--no-reveal", ...flags], {
    // An empty PATH keeps the real `claude` CLI out of the run.
    env: { HOME: home, USERPROFILE: home, PATH: join(home, "nowhere") },
  });
  return stdout;
}

test("--yes configures the clients it finds and leaves the others alone", async () => {
  await mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(join(home, ".cursor/mcp.json"), "{}\n");

  const output = await init("--yes");

  expect(output).toMatch(/written\s+Cursor/);
  expect(output).not.toContain("VS Code");
  const config = JSON.parse(await readFile(join(home, ".cursor/mcp.json"), "utf8"));
  expect(config.mcpServers.Mirra).toBeDefined();
});

test("--yes on a machine with no client does not touch any configuration", async () => {
  const output = await init("--yes");

  expect(output).toContain("No clients selected");
  expect(output).not.toMatch(/^(written|skipped|failed)\s/m);
});

test("--no-config leaves every client configuration alone", async () => {
  await mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(join(home, ".cursor/mcp.json"), "{}\n");

  const output = await init("--no-config");

  expect(output).toContain("Left every client configuration alone");
  expect(await readFile(join(home, ".cursor/mcp.json"), "utf8")).toBe("{}\n");
});
