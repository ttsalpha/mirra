import { expect, test } from "vitest";
import { fileNames } from "./export.js";

test("layers that share a name get distinct files", () => {
  expect(
    fileNames([
      { name: "Icon", extension: "png" },
      { name: "icon", extension: "png" },
      { name: "Icon!", extension: "svg" },
      { name: "Icon", extension: "png" },
      { name: "???", extension: "png" },
    ]),
  ).toEqual(["icon.png", "icon-2.png", "icon.svg", "icon-3.png", "asset.png"]);
});
