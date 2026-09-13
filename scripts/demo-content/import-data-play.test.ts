import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-data-play-import-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content.trimStart());
}

function makeCorpus(contentFiles: Record<string, string> = {}): string {
  const source = join(dir, "corpus");
  write(
    join(source, "organization", "campus.md"),
    `# Campus

## Main campus

**City:** Toronto
`,
  );
  write(
    join(source, "organization", "ministries.md"),
    `# Ministries

## Care

**Lead:** Paul

Care for people.
`,
  );
  write(
    join(source, "organization", "groups.md"),
    `# Responsibility Groups

## Leadership Council

**Kind:** Leadership body  
**Campus:** Church-wide  
**Receives leadership reports:** Yes

Leaders who receive leadership reports.
`,
  );

  for (const [slug, name, persona] of [
    ["paul", "Paul", "Featured"],
    ["peter", "Peter", "Available"],
  ] as const) {
    write(
      join(source, "characters", slug, "profile.md"),
      `# ${name} — Profile

## Oikonomia identity

**Name:** ${name}  
**Title:** Leader  
**Access:** Leader  
**Reports to:** None  
**Ministries:** Care — ${name === "Paul" ? "leader" : "member"}  
**Groups:** Leadership Council — member  
**Leads Lifegroups:** Yes  
**Demo persona:** ${persona}
`,
    );
  }

  for (const [relativePath, content] of Object.entries(contentFiles)) {
    write(join(source, relativePath), content);
  }
  return source;
}

function buildDatabase(): string {
  const target = join(dir, "builder.db");
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "ops", "create-demo-baseline-builder.mjs"), "--to", target],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return target;
}

function runImport(args: string[]) {
  return spawnSync(
    join(process.cwd(), "node_modules", ".bin", "tsx"),
    [join(process.cwd(), "scripts", "demo-content", "import-data-play.mts"), ...args],
    { encoding: "utf8", timeout: 30_000 },
  );
}

describe("import-data-play.mts", () => {
  it("runs a complete dry run in memory without requiring a target database", () => {
    const source = makeCorpus({
      "characters/paul/content/reports.md": `# Paul — Reports

**Oikonomia section:** Leadership Report

## A useful report

**Record type:** Weekly Report  
**Date:** 2026-04-06  
**Visibility:** Leadership  
**Status:** Complete

The report body.
`,
    });

    const result = runImport(["--source", source, "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      people: 2,
      designated: 2,
      leadershipReports: 1,
      warnings: 0,
      integrity: "ok",
      foreignKeyProblems: 0,
      dryRun: true,
    });
  });

  it("keeps Lifegroup entry sections out of the report and preserves each entry audience", () => {
    const source = makeCorpus({
      "characters/paul/content/lifegroup/gathering.md": `# Paul — Lifegroup

**Oikonomia section:** Lifegroup Gathering

## 2026-04-09 — Grace in practice

**Led by:** Paul, Peter  
**Venue:** A home

The group shared a meal and read together.

### Discussion

We discussed patient leadership.

### Prayer

**Visibility:** This gathering's leaders

Pray for courage.

### Follow-up

**Visibility:** Named people  
**Shared with:** Peter

Peter will make the call.

**Biblical account:** Acts 2:42–47.
`,
    });
    const target = buildDatabase();

    const result = runImport(["--source", source, "--to", target]);

    expect(result.status, result.stderr).toBe(0);
    const db = new Database(target, { readonly: true });
    const report = db.prepare("SELECT report_summary FROM gathering").get() as {
      report_summary: string;
    };
    expect(report.report_summary).toBe("The group shared a meal and read together.");
    const peter = db.prepare("SELECT id FROM person WHERE name = 'Peter'").get() as { id: string };
    const entries = db
      .prepare("SELECT category, body, visibility, viewer_ids FROM lifegroup_entry ORDER BY rowid")
      .all();
    expect(entries).toEqual([
      {
        category: "general",
        body: "We discussed patient leadership.",
        visibility: "leaders",
        viewer_ids: null,
      },
      {
        category: "prayer",
        body: "Pray for courage.",
        visibility: "assigned-leaders",
        viewer_ids: null,
      },
      {
        category: "follow-up",
        body: "Peter will make the call.",
        visibility: "selected-viewers",
        viewer_ids: JSON.stringify([peter.id]),
      },
    ]);
    db.close();
  });

  it("imports the conversation attached to a Reach-Out report", () => {
    const source = makeCorpus({
      "characters/paul/content/reach-out/visit.md": `# Paul — Reach-Out

**Oikonomia section:** Reach-Out

## Household visit

**Date:** 2026-05-02

We visited and listened.

### Comments

**Peter:** I will follow up tomorrow.
`,
    });
    const target = buildDatabase();

    const result = runImport(["--source", source, "--to", target]);

    expect(result.status, result.stderr).toBe(0);
    const db = new Database(target, { readonly: true });
    const row = db
      .prepare(
        `SELECT p.name author, c.body
           FROM comment c
           JOIN person p ON p.id = c.author_id
          WHERE c.parent_type = 'reach-out-report'`,
      )
      .get();
    expect(row).toEqual({ author: "Peter", body: "I will follow up tomorrow." });
    db.close();
  });

  it("reports Personal Reflections separately from Leadership Reports", () => {
    const source = makeCorpus({
      "characters/paul/content/reflection.md": `# Paul — Reflection

**Oikonomia section:** Personal Reflection

## A private reflection

**Record type:** Reflection  
**Date:** 2026-06-01  
**Status:** Complete

I need to listen before answering.
`,
    });

    const result = runImport(["--source", source, "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      leadershipReports: 0,
      personalReflections: 1,
    });
  });
});
