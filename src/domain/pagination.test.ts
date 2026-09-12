import { describe, expect, it } from "vitest";

import { PAGE_SIZE, pageSummary, pageTokens, paginate } from "./pagination";

/**
 * Paging behaviour.
 *
 * The cases that matter are the ones where a reader would otherwise be stranded
 * or misinformed: a page that no longer exists, an off-by-one in the counted
 * range, and a control offered for a list that does not need one.
 */

const list = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("slicing a page", () => {
  it("returns the first page by default size", () => {
    const w = paginate(list(184), 1);
    expect(w.items).toHaveLength(PAGE_SIZE);
    expect(w.items[0]).toBe(1);
    expect(w.items.at(-1)).toBe(25);
  });

  it("counts the range the way a reader would, one-based and inclusive", () => {
    const w = paginate(list(184), 2);
    expect(w.from).toBe(26);
    expect(w.to).toBe(50);
    expect(w.total).toBe(184);
  });

  it("gives the last page only the records that remain", () => {
    const w = paginate(list(184), 8);
    expect(w.pageCount).toBe(8);
    expect(w.items).toHaveLength(9);
    expect(w.from).toBe(176);
    expect(w.to).toBe(184);
  });
});

describe("a page that no longer exists", () => {
  /**
   * The stranding case: the reader is on page 6, narrows a filter to 40
   * results, and must not be shown an empty list with no way back.
   */
  it("clamps forward to the last real page when the results shrink", () => {
    const w = paginate(list(40), 6);
    expect(w.page).toBe(2);
    expect(w.items).toHaveLength(15);
    expect(w.items).not.toHaveLength(0);
  });

  it("clamps backward when the page number is below one", () => {
    expect(paginate(list(40), 0).page).toBe(1);
    expect(paginate(list(40), -3).page).toBe(1);
  });

  it("survives a page number that is not a number at all", () => {
    expect(paginate(list(40), Number.NaN).page).toBe(1);
  });

  it("still reports page 1 of 1 for an empty result set", () => {
    const w = paginate([], 4);
    expect(w.page).toBe(1);
    expect(w.pageCount).toBe(1);
    expect(w.from).toBe(0);
    expect(w.to).toBe(0);
    expect(w.singlePage).toBe(true);
  });
});

describe("whether a control is warranted", () => {
  it("marks a list that already fits as a single page", () => {
    expect(paginate(list(25), 1).singlePage).toBe(true);
  });

  it("stops calling it a single page at one record over", () => {
    expect(paginate(list(26), 1).singlePage).toBe(false);
  });
});

describe("the sentence shown to the reader", () => {
  it("states the range only when there is more than one page", () => {
    expect(pageSummary(paginate(list(184), 2), "report")).toBe("Showing 26–50 of 184 reports");
  });

  it("states a plain count when everything is already on screen", () => {
    expect(pageSummary(paginate(list(9), 1), "report")).toBe("9 reports");
  });

  it("does not pluralize a single record", () => {
    expect(pageSummary(paginate(list(1), 1), "report")).toBe("1 report");
  });

  it("says nothing was found rather than showing a zero range", () => {
    expect(pageSummary(paginate([], 1), "report")).toBe("No reports");
  });

  it("uses an irregular plural when one is given", () => {
    expect(pageSummary(paginate(list(3), 1), "person", "people")).toBe("3 people");
  });
});

describe("which page numbers to print", () => {
  it("prints every number while they still fit", () => {
    expect(pageTokens(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("elides the middle around the current page", () => {
    expect(pageTokens(6, 20)).toEqual([1, "gap", 5, 6, 7, "gap", 20]);
  });

  it("keeps both ends reachable", () => {
    const tokens = pageTokens(10, 40);
    expect(tokens[0]).toBe(1);
    expect(tokens.at(-1)).toBe(40);
  });

  it("prints a lone missing number instead of hiding it behind a gap", () => {
    expect(pageTokens(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never prints two gaps in a row", () => {
    const tokens = pageTokens(9, 30);
    tokens.forEach((token, i) => {
      if (token === "gap") expect(tokens[i + 1]).not.toBe("gap");
    });
  });

  it("prints one number for a one-page list", () => {
    expect(pageTokens(1, 1)).toEqual([1]);
  });
});
