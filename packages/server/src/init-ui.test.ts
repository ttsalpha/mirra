import { afterEach, expect, test, vi } from "vitest";
import { createUi } from "./init-ui.js";

afterEach(() => vi.restoreAllMocks());

function capture(): () => string {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    chunks.push(`${parts.join(" ")}\n`);
  });
  return () => chunks.join("");
}

test("every styled call renders without throwing", async () => {
  const output = capture();
  const ui = createUi(true);

  ui.intro("Setup");
  ui.info("info line");
  ui.success("success line");
  ui.warn("warn line");
  ui.client({ client: "Cursor", status: "written", detail: "/tmp/mcp.json" });
  ui.client({ client: "VS Code", status: "failed", detail: "boom" });
  ui.client({ client: "Claude Desktop", status: "skipped", detail: "not installed" });
  ui.note("Next", ["1. one", "2. two"]);
  await expect(ui.task("Working", "Worked", async () => 7)).resolves.toBe(7);
  ui.outro("Done");

  expect(output()).toContain("Cursor");
  expect(output()).toContain("Worked");
});

test("a failing task still propagates its error", async () => {
  capture();
  await expect(
    createUi(true).task("Working", "Worked", async () => {
      throw new Error("nope");
    }),
  ).rejects.toThrow("nope");
});

test("the plain mode prints lines and leaves the ornaments out", () => {
  const output = capture();
  const ui = createUi(false);

  ui.intro("Setup");
  ui.client({ client: "Cursor", status: "written", detail: "/tmp/mcp.json" });
  ui.outro("Done");

  expect(output()).toMatch(/^written\s+Cursor\s+\/tmp\/mcp\.json/m);
  expect(output()).not.toContain("Setup");
});
