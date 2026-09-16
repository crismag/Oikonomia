/**
 * The addresses in what an administrator pasted.
 *
 * Split on line breaks, commas, semicolons and spaces, so a column copied from
 * a spreadsheet and a line copied from an email's To: field both work. Kept as
 * typed apart from trimming and case: the server decides what is valid, and
 * says so per address, rather than this quietly dropping a mistake.
 */
export function addressesIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.replace(/^<|>$/g, "").trim();
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    out.push(address);
  }
  return out;
}
