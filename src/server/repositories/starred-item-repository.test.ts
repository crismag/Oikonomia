import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as Db } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { createStarredItemRepository } from "./starred-item-repository";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-starred-"));
  db = openDatabase(join(dir, "current.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("starred items", () => {
  it("has nothing starred until something is starred", () => {
    const repo = createStarredItemRepository(db);
    expect(repo.starredIds("per-1", "leadership-report")).toEqual(new Set());
  });

  it("stars and unstars an item", () => {
    const repo = createStarredItemRepository(db);
    repo.star("per-1", "leadership-report", "lr-1");
    expect(repo.starredIds("per-1", "leadership-report")).toEqual(new Set(["lr-1"]));

    repo.unstar("per-1", "leadership-report", "lr-1");
    expect(repo.starredIds("per-1", "leadership-report")).toEqual(new Set());
  });

  it("starring the same item twice does not error or duplicate", () => {
    const repo = createStarredItemRepository(db);
    repo.star("per-1", "leadership-report", "lr-1");
    repo.star("per-1", "leadership-report", "lr-1");
    expect(repo.starredIds("per-1", "leadership-report")).toEqual(new Set(["lr-1"]));
  });

  it("keeps different people's stars apart", () => {
    const repo = createStarredItemRepository(db);
    repo.star("per-1", "leadership-report", "lr-1");
    expect(repo.starredIds("per-2", "leadership-report")).toEqual(new Set());
  });

  it("keeps different item types apart even with the same id", () => {
    const repo = createStarredItemRepository(db);
    repo.star("per-1", "leadership-report", "shared-id");
    expect(repo.starredIds("per-1", "goal")).toEqual(new Set());
    expect(repo.starredIds("per-1", "leadership-report")).toEqual(new Set(["shared-id"]));
  });

  it("lists everything one person has starred, across item types", () => {
    const repo = createStarredItemRepository(db);
    repo.star("per-1", "leadership-report", "lr-1");
    repo.star("per-1", "goal", "goal-1");

    const all = repo.allStarred("per-1");
    expect(all).toHaveLength(2);
    expect(all.map((row) => `${row.itemType}:${row.itemId}`).sort()).toEqual([
      "goal:goal-1",
      "leadership-report:lr-1",
    ]);
  });
});
