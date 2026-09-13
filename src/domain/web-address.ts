import { z } from "zod";

/**
 * A link somebody stored for others to open.
 *
 * `z.string().url()` asks only whether a string parses as a URL, and
 * `javascript:alert(1)` and `data:text/html,…` both do. Stored, then rendered
 * as an `href` for everybody else who opens the record, either one is script
 * running in their session. The browser framework happens to refuse the first
 * today; the server must not rely on that.
 *
 * Only the schemes a stored web address actually needs: `https:` and `http:`.
 * Rich text has its own, separate allowlist in the sanitizer.
 */
export const WEB_ADDRESS_SCHEMES = ["https:", "http:"] as const;

export function isWebAddress(value: string): boolean {
  try {
    return (WEB_ADDRESS_SCHEMES as readonly string[]).includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const webAddress = (message: string) => z.string().trim().refine(isWebAddress, { message });
