import { afterEach, expect, test } from "vitest";
import { originAllowed } from "./transport.js";

afterEach(() => {
  delete process.env["MIRRA_ALLOW_ORIGIN"];
});

test("the plugin iframe is allowed, whether it sends null or nothing", () => {
  expect(originAllowed(undefined)).toBe(true);
  expect(originAllowed("null")).toBe(true);
  expect(originAllowed("https://www.figma.com")).toBe(true);
  expect(originAllowed("https://figma.com")).toBe(true);
});

test("a page in a browser is refused", () => {
  expect(originAllowed("https://evil.example")).toBe(false);
  expect(originAllowed("http://localhost:3000")).toBe(false);
  // A host that only ends with the right letters is not figma.com.
  expect(originAllowed("https://notfigma.com")).toBe(false);
  expect(originAllowed("https://figma.com.evil.example")).toBe(false);
});

test("one extra origin can be allowed by environment", () => {
  process.env["MIRRA_ALLOW_ORIGIN"] = "https://staging.example";
  expect(originAllowed("https://staging.example")).toBe(true);
  expect(originAllowed("https://other.example")).toBe(false);
});
