import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inlineAssets } from "./assets.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("a path is inlined and remembered, inline content is left alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirra-assets-"));
  await writeFile(join(dir, "icon.svg"), "<svg/>");
  await writeFile(join(dir, "hero.png"), PNG);

  const tree = await inlineAssets({
    type: "frame",
    children: [
      { type: "svg", src: join(dir, "icon.svg") },
      { type: "image", src: join(dir, "hero.png") },
      { type: "svg", src: "<svg><rect/></svg>" },
    ],
  });

  const [icon, hero, inline] = (tree as { children: Record<string, string>[] }).children;
  expect(icon).toMatchObject({ src: "<svg/>", srcRef: join(dir, "icon.svg") });
  expect(hero?.src).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  expect(hero?.srcRef).toBe(join(dir, "hero.png"));
  expect(inline).toEqual({ type: "svg", src: "<svg><rect/></svg>" });
});

test("an unsupported image type is refused by extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirra-assets-"));
  await writeFile(join(dir, "hero.bmp"), PNG);

  await expect(inlineAssets({ type: "image", src: join(dir, "hero.bmp") })).rejects.toThrow(
    /Unsupported image type/,
  );
});
