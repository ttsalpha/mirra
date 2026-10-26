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

test("a patch set has no type, so an svg file is told by its extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirra-assets-"));
  await writeFile(join(dir, "icon.svg"), "<svg/>");
  await writeFile(join(dir, "hero.png"), PNG);

  const ops = (await inlineAssets({
    ops: [
      { op: "set", target: { key: "a" }, props: { src: join(dir, "icon.svg") } },
      { op: "set", target: { key: "b" }, props: { src: join(dir, "hero.png") } },
    ],
  })) as { ops: { props: Record<string, string> }[] };

  expect(ops.ops[0]?.props["src"]).toBe("<svg/>");
  expect(ops.ops[1]?.props["src"]).toContain("data:image/png;base64,");
});

test("a remote URL or a missing file is explained rather than left as ENOENT", async () => {
  await expect(
    inlineAssets({ type: "image", src: "https://example.com/hero.png" }),
  ).rejects.toThrow(/Remote URLs are not supported/);

  await expect(
    inlineAssets({ type: "svg", src: join(tmpdir(), "mirra-nope", "icon.svg") }),
  ).rejects.toThrow(/no such file. src is a file path, inline SVG markup or a data URI/);
});
