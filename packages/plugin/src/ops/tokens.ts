import type { TokensResult } from "@mirra/schema";
import { readTokens } from "../figma/tokens";

export async function tokens(): Promise<TokensResult> {
  return readTokens();
}
