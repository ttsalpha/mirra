/** `figma.fileKey` is gated on plugin permissions and throws when missing. */
export function readFileKey(): string | null {
  try {
    return figma.fileKey ?? null;
  } catch {
    return null;
  }
}
