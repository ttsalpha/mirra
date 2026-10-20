import { afterEach, expect, test } from "vitest";
import { resolveInRoot, rootDirectory } from "./paths.js";

afterEach(() => {
  delete process.env["MIRRA_ROOT"];
});

test("without a root, paths resolve from the working directory", () => {
  expect(rootDirectory()).toBe(process.cwd());
  expect(resolveInRoot("../anywhere.png")).toContain("anywhere.png");
});

test("with a root, a path inside it resolves", () => {
  process.env["MIRRA_ROOT"] = "/tmp/mirra-root";
  expect(resolveInRoot("assets/icon.svg")).toBe("/tmp/mirra-root/assets/icon.svg");
  expect(resolveInRoot(".")).toBe("/tmp/mirra-root");
});

test("with a root, climbing out of it is refused by name", () => {
  process.env["MIRRA_ROOT"] = "/tmp/mirra-root";

  expect(() => resolveInRoot("../secrets.env")).toThrow(/outside MIRRA_ROOT/);
  expect(() => resolveInRoot("/etc/passwd")).toThrow(/outside MIRRA_ROOT/);
  // A sibling that merely starts with the same characters is not inside it.
  expect(() => resolveInRoot("../mirra-root-evil/x")).toThrow(/outside MIRRA_ROOT/);
});
