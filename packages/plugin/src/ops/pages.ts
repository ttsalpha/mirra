import type { PagesParams, PagesResult } from "@mirra/schema";

export async function pages(params: PagesParams): Promise<PagesResult> {
  await figma.loadAllPagesAsync();

  if (params.select) {
    const wanted = figma.root.children.find(
      (page) => page.id === params.select || page.name === params.select,
    );
    if (!wanted) {
      const names = figma.root.children.map((page) => page.name).join(", ");
      throw new Error(`No page called "${params.select}". This file has: ${names}`);
    }
    await figma.setCurrentPageAsync(wanted);
  }

  return {
    pages: figma.root.children.map((page) => ({
      id: page.id,
      name: page.name,
      current: page.id === figma.currentPage.id,
    })),
  };
}
