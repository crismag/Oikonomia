#!/usr/bin/env -S npx tsx
/**
 * Read the Data Play authoring corpus and populate an Oikonomia baseline
 * builder database with it, through the same repositories the application
 * itself writes through.
 *
 *   npx tsx scripts/demo-content/import-data-play.mts \
 *     --source /path/to/Oikonomia_demo_content_build \
 *     --to /path/to/builder.db
 *
 * `--to` must already exist and be empty (create it first with
 * `scripts/ops/create-demo-baseline-builder.mjs`). This script never marks it
 * `demo-baseline` — run `scripts/ops/mark-demo-baseline.mjs` afterward, once
 * the imported content has been reviewed.
 *
 * ## Why repositories, not raw SQL
 *
 * The same reason `scripts/ops/*.mjs` read migrations through `migrate.ts`
 * rather than re-declaring the schema: the column mapping for a report, a
 * gathering, a meeting note stays defined once, in the application. This
 * script imports the real repository modules under Node's TypeScript support
 * and calls them exactly as a request handler would — with one exception the
 * corpus's own `RECORD-FORMAT.md` names: repositories stamp `created_at`
 * with the current time, and imported history needs its own 2026 dates, so a
 * handful of timestamp columns are corrected with a direct `UPDATE`
 * immediately after each insert, never by writing a row's other columns by
 * hand.
 *
 * ## What this does not do
 *
 * It does not invent content, resolve an unrecognised name by guessing, or
 * continue past a corpus structure it does not understand. A record it
 * cannot parse or a name it cannot resolve is skipped and reported, not
 * silently dropped or silently guessed at. See the summary printed at the
 * end, and `--dry-run` to see it without writing anything.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = (path: string) => join(REPO_ROOT, "src", path);

const { createOrganizationRepository } = await import(
  repo("server/repositories/organization-repository.ts")
);
const { createAccountRepository } = await import(repo("server/repositories/account-repository.ts"));
const { createOnboardingRepository } = await import(
  repo("server/repositories/onboarding-repository.ts")
);
const { createDemoIdentityRepository } = await import(
  repo("server/repositories/demo-identity-repository.ts")
);
const { createLeadershipReportRepository } = await import(
  repo("server/repositories/leadership-report-repository.ts")
);
const { createLifegroupRepository } = await import(
  repo("server/repositories/lifegroup-repository.ts")
);
const { createMeetingRepository } = await import(repo("server/repositories/meeting-repository.ts"));
const { createGoalsRepository } = await import(repo("server/repositories/goals-repository.ts"));
const { createEscalationRepository } = await import(
  repo("server/repositories/escalation-repository.ts")
);
const { createReachOutRepository } = await import(
  repo("server/repositories/reach-out-repository.ts")
);
const { createCalendarRepository } = await import(
  repo("server/repositories/calendar-repository.ts")
);
const { onboardingSteps, ONBOARDING_VERSION } = await import(repo("domain/onboarding.ts"));
const { inlineHtmlIsSafe } = await import(repo("domain/meeting.ts"));
const { loadMigrations, migrate } = await import(repo("server/db/migrate.ts"));

/* ------------------------------------------------------------------ CLI */

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const flag = (name: string) => args.includes(`--${name}`);

const sourceRoot = option("source");
const targetPath = option("to");
const dryRun = flag("dry-run");
/* How many of the roster are offered in the demo chooser. The corpus's own
   "Demo persona: No" is always honoured as an exclusion; everyone else is
   ranked by how much they were actually given to explore and only the top
   `maxDesignated` are selected — plus whoever `--always-designate` names,
   which is not subject to the ranking or the cap. */
const maxDesignated = Number(option("max-designated") ?? 30);
const alwaysDesignate = (option("always-designate") ?? "Cris")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!sourceRoot || (!dryRun && !targetPath)) {
  fail(
    "usage: npx tsx scripts/demo-content/import-data-play.mts --source <corpus dir> (--to <builder.db> | --dry-run)",
  );
}
if (!existsSync(sourceRoot)) fail(`no such source directory: ${sourceRoot}`);
if (!dryRun && !existsSync(targetPath!)) {
  fail(`no database at ${targetPath}. Create it first with create-demo-baseline-builder.mjs.`);
}

function fail(message: string): never {
  console.error(`import-data-play: ${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------- warnings */

const warnings: string[] = [];
const warn = (message: string) => warnings.push(message);

/* ------------------------------------------------------------ markdown */

interface ParsedRecord {
  heading: string;
  headingDate: string | undefined;
  fields: Map<string, string[]>;
  closing: Map<string, string[]>;
  comments: { name: string; body: string }[];
  bodyBlocks: BodyBlock[];
  /** The body before block conversion, for readers that need to re-split it by `###` section. */
  rawBodyLines: string[];
  sourceFile: string;
}

interface ParsedFile {
  title: string;
  fileFields: Map<string, string[]>;
  records: ParsedRecord[];
}

const FIELD_LINE = /^\*\*([A-Za-z][A-Za-z /]*):\*\*\s?(.*?)\s*$/;
const CLOSING_KEYS = new Set([
  "Attention",
  "Attention to",
  "Action requested",
  "Approval requested",
  "Related goal",
  "Biblical account",
  "Reflection theme",
]);

function parseFieldLines(
  lines: string[],
  start: number,
): { fields: Map<string, string[]>; next: number } {
  const fields = new Map<string, string[]>();
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const match = FIELD_LINE.exec(line);
    if (!match) break;
    const [, key, value] = match as unknown as [string, string, string];
    const list = fields.get(key) ?? [];
    list.push(value.trim());
    fields.set(key, list);
    i++;
  }
  return { fields, next: i };
}

/** Trailing closing lines (§6), working backward from the end of a body. */
function extractClosingLines(bodyLines: string[]): {
  body: string[];
  closing: Map<string, string[]>;
} {
  let end = bodyLines.length;
  while (end > 0 && bodyLines[end - 1]!.trim() === "") end--;
  const closingLines: { key: string; value: string }[] = [];
  while (end > 0) {
    const match = FIELD_LINE.exec(bodyLines[end - 1]!);
    if (!match || !CLOSING_KEYS.has(match[1]!)) break;
    closingLines.unshift({ key: match[1]!, value: match[2]!.trim() });
    end--;
  }
  const closing = new Map<string, string[]>();
  for (const { key, value } of closingLines) {
    const list = closing.get(key) ?? [];
    list.push(value);
    closing.set(key, list);
  }
  return { body: bodyLines.slice(0, end), closing };
}

function extractComments(bodyLines: string[]): {
  body: string[];
  comments: { name: string; body: string }[];
} {
  const at = bodyLines.findIndex((line) => line.trim() === "### Comments");
  if (at === -1) return { body: bodyLines, comments: [] };
  const rest = bodyLines
    .slice(at + 1)
    .join("\n")
    .trim();
  const comments: { name: string; body: string }[] = [];
  for (const chunk of rest.split(/\n{2,}/)) {
    const match = /^\*\*([^*]+):\*\*\s*([\s\S]*)$/.exec(chunk.trim());
    if (match) comments.push({ name: match[1]!.trim(), body: match[2]!.trim() });
  }
  return { body: bodyLines.slice(0, at), comments };
}

/* -------------------------------------------------------- inline → HTML */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The small allowlist `src/domain/meeting.ts` enforces: b/strong, i/em, u, br, a. */
function inlineHtml(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g,
    '<a href="$2">$1</a>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return html;
}

type BlockType =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "bullet"
  | "numbered"
  | "quote"
  | "divider"
  | "checklist";

interface BodyBlock {
  type: BlockType;
  html: string;
  checked?: boolean;
}

/** A small, deliberately literal markdown→blocks reading — see §9 of RECORD-FORMAT.md. */
function toBlocks(bodyLines: string[]): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let i = 0;
  const push = (type: BlockType, text: string, checked?: boolean) => {
    if (!text.trim()) return;
    blocks.push({
      type,
      html: inlineHtml(text.trim()),
      ...(checked !== undefined ? { checked } : {}),
    });
  };

  while (i < bodyLines.length) {
    const line = bodyLines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{3,4})\s+(.+)$/.exec(line);
    if (heading) {
      push(heading[1]!.length === 3 ? "heading-1" : "heading-2", heading[2]!);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ type: "divider", html: "" });
      i++;
      continue;
    }
    const checklist = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
    if (checklist) {
      push("checklist", checklist[2]!, checklist[1]!.toLowerCase() === "x");
      i++;
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      push("bullet", bullet[1]!);
      i++;
      continue;
    }
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (numbered) {
      push("numbered", numbered[1]!);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < bodyLines.length && /^>\s?/.test(bodyLines[i]!)) {
        quoted.push(bodyLines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      push("quote", quoted.join(" "));
      continue;
    }
    /* An ordinary paragraph: contiguous non-blank, non-special lines. */
    const paragraph: string[] = [];
    while (
      i < bodyLines.length &&
      bodyLines[i]!.trim() !== "" &&
      !/^(#{3,4})\s+/.test(bodyLines[i]!) &&
      !/^[-*]\s+/.test(bodyLines[i]!) &&
      !/^\d+\.\s+/.test(bodyLines[i]!) &&
      !/^>\s?/.test(bodyLines[i]!) &&
      !/^---+\s*$/.test(bodyLines[i]!)
    ) {
      paragraph.push(bodyLines[i]!.trim());
      i++;
    }
    push("paragraph", paragraph.join(" "));
  }
  return blocks;
}

function parseFile(path: string): ParsedFile {
  const text = readFileSync(path, "utf8");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const titleLine = lines.findIndex((line) => /^#\s+/.test(line));
  const title = titleLine === -1 ? path : lines[titleLine]!.replace(/^#\s+/, "").trim();
  const { fields: fileFields, next: afterFileFields } = parseFieldLines(lines, titleLine + 1);

  const headingIndexes: number[] = [];
  for (let i = Math.max(afterFileFields, titleLine + 1); i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) headingIndexes.push(i);
  }

  const records: ParsedRecord[] = [];
  for (let r = 0; r < headingIndexes.length; r++) {
    const start = headingIndexes[r]!;
    const end = r + 1 < headingIndexes.length ? headingIndexes[r + 1]! : lines.length;
    const headingText = lines[start]!.replace(/^##\s+/, "").trim();
    const dateInHeading = /^(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$/.exec(headingText);
    const heading = dateInHeading ? dateInHeading[2]!.trim() : headingText;
    const headingDate = dateInHeading?.[1];

    const { fields, next } = parseFieldLines(lines, start + 1);
    let recordBody = lines.slice(next, end);
    /* A trailing horizontal rule before the next heading is a separator, not
       content — and the blank line that normally follows it, before EOF or
       the next heading, must not stop the strip one line early and leave the
       "---" sitting in front of the closing lines it was meant to be behind. */
    while (
      recordBody.length > 0 &&
      (recordBody[recordBody.length - 1]!.trim() === "" ||
        /^---+$/.test(recordBody[recordBody.length - 1]!.trim()))
    ) {
      recordBody = recordBody.slice(0, -1);
    }
    const { body: withoutComments, comments } = extractComments(recordBody);
    const { body: mainBody, closing } = extractClosingLines(withoutComments);

    records.push({
      heading,
      headingDate,
      fields,
      closing,
      comments,
      bodyBlocks: toBlocks(mainBody),
      rawBodyLines: mainBody,
      sourceFile: path,
    });
  }

  return { title, fileFields, records };
}

function findFiles(dir: string, suffix = ".md"): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findFiles(full, suffix));
    else if (entry.endsWith(suffix)) out.push(full);
  }
  return out;
}

const field = (record: ParsedRecord | ParsedFile, key: string): string | undefined => {
  const source = "fields" in record ? record.fields : record.fileFields;
  return source.get(key)?.[0];
};

/* -------------------------------------------------------------- roster */

interface RosterMembership {
  ministryName: string;
  fn: "head" | "leader" | "coordinator" | "member" | "service-worker" | "sees-only";
}

interface RosterEntry {
  slug: string;
  name: string;
  title?: string;
  access: string;
  reportsToRaw?: string;
  ministries: RosterMembership[];
  groups: string[];
  leadsLifegroups: boolean;
  demoPersona: "Featured" | "Available" | "No";
  personId?: string;
  accountId?: string;
  profileFile: string;
}

function parseMembershipList(raw: string | undefined): { name: string; fn: string }[] {
  if (!raw || /^none$/i.test(raw.trim())) return [];
  return raw
    .split(";")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const [name, fn] = piece.split("—").map((s) => s.trim());
      return { name: name ?? piece, fn: fn ?? "member" };
    });
}

function normalizeFn(raw: string): RosterMembership["fn"] {
  const lower = raw.toLowerCase();
  if (lower.includes("sees only")) return "sees-only";
  if (["head", "leader", "coordinator", "member", "service-worker"].includes(lower)) {
    return lower as RosterMembership["fn"];
  }
  return "member";
}

const roster: RosterEntry[] = [];
const rosterByName = new Map<string, RosterEntry>();

for (const profilePath of findFiles(join(sourceRoot, "characters")).filter((p) =>
  p.endsWith("profile.md"),
)) {
  const slug = relative(join(sourceRoot, "characters"), profilePath).split("/")[0]!;
  const parsed = parseFile(profilePath);
  const identityRecord = parsed.records.find((r) => /oikonomia identity/i.test(r.heading));
  const fields = identityRecord?.fields ?? parsed.fileFields;
  const name = fields.get("Name")?.[0];
  if (!name) {
    warn(`${profilePath}: no Oikonomia identity block with a Name field; skipped entirely`);
    continue;
  }
  const access = fields.get("Access")?.[0] ?? "Leader";
  const reportsToRaw = fields.get("Reports to")?.[0];
  const demoPersonaRaw = (fields.get("Demo persona")?.[0] ?? "No").trim();
  const demoPersona: RosterEntry["demoPersona"] =
    demoPersonaRaw === "Featured"
      ? "Featured"
      : demoPersonaRaw === "Available"
        ? "Available"
        : "No";

  const entry: RosterEntry = {
    slug,
    name,
    ...(fields.get("Title")?.[0] ? { title: fields.get("Title")![0]! } : {}),
    access,
    ...(reportsToRaw && !/^none$/i.test(reportsToRaw) ? { reportsToRaw } : {}),
    ministries: parseMembershipList(fields.get("Ministries")?.[0]).map((m) => ({
      ministryName: m.name,
      fn: normalizeFn(m.fn),
    })),
    groups: parseMembershipList(fields.get("Groups")?.[0]).map((g) => g.name),
    leadsLifegroups: /^yes$/i.test(fields.get("Leads Lifegroups")?.[0] ?? "no"),
    demoPersona,
    profileFile: profilePath,
  };
  roster.push(entry);
  rosterByName.set(name.toLowerCase(), entry);
}

/** Resolve a written name against the roster. `undefined` is a failure, reported by the caller. */
function resolvePersonId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/\.$/, "");
  if (!clean || /^(none|n\/a)$/i.test(clean)) return undefined;
  const direct = rosterByName.get(clean.toLowerCase())?.personId;
  if (direct) return direct;
  const leadMatch = /^(.+?)\s+lead$/i.exec(clean);
  if (leadMatch) {
    const ministry = ministryByName.get(leadMatch[1]!.trim().toLowerCase());
    if (ministry?.leadId) return ministry.leadId;
    warn(`no lead currently assigned for "${leadMatch[1]}" (referenced as "${clean}")`);
    return undefined;
  }
  return undefined;
}

function resolveNames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const RECIPIENT_ROLE: Record<string, string> = {
  "reporting leader": "reporting-leader",
  "ministry head": "ministry-head",
  "campus leadership": "campus-leadership",
  "church leadership": "church-leadership",
};

/* -------------------------------------------------------- report state */

interface MinistryEntry {
  name: string;
  id: string;
  leadId?: string;
}
const ministryByName = new Map<string, MinistryEntry>();
const groupByName = new Map<string, string>();
let mainCampusId: string | undefined;

const counts = {
  people: 0,
  ministries: 0,
  groups: 0,
  designated: 0,
  leadershipReports: 0,
  personalReflections: 0,
  comments: 0,
  escalations: 0,
  gatherings: 0,
  lifegroupEntries: 0,
  meetingNotes: 0,
  meetingTasks: 0,
  goals: 0,
  goalUpdates: 0,
  reachOut: 0,
  calendarEntries: 0,
  skippedRecords: 0,
};

/* -------------------------------------------------------------- write */

const db: Db = new Database(dryRun ? ":memory:" : targetPath!);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
if (dryRun) {
  migrate(db, loadMigrations(join(REPO_ROOT, "src", "server", "db", "migrations")));
}

const existingPeople = (db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number }).n;
if (existingPeople > 0) {
  fail(
    `${targetPath} already holds ${existingPeople} people. Only an empty builder is imported into.`,
  );
}

const organization = createOrganizationRepository(db);
const accounts = createAccountRepository(db);
const onboarding = createOnboardingRepository(db);
const demoIdentities = createDemoIdentityRepository(db);
const reports = createLeadershipReportRepository(db);
const lifegroup = createLifegroupRepository(db);
const meetings = createMeetingRepository(db);
const goals = createGoalsRepository(db);
const escalations = createEscalationRepository(db);
const reachOut = createReachOutRepository(db);
const calendar = createCalendarRepository(db);

const backdate = (table: string, id: string, isoDateTime: string, idColumn = "id") => {
  db.prepare(`UPDATE "${table}" SET created_at = ?, updated_at = ? WHERE "${idColumn}" = ?`).run(
    isoDateTime,
    isoDateTime,
    id,
  );
};
const backdateCreatedOnly = (table: string, id: string, isoDateTime: string, idColumn = "id") => {
  db.prepare(`UPDATE "${table}" SET created_at = ? WHERE "${idColumn}" = ?`).run(isoDateTime, id);
};

const atNoon = (date: string) => `${date}T12:00:00.000Z`;

const run = db.transaction(() => {
  /* --------------------------------------------------------- organisation */
  const campusFile = parseFile(join(sourceRoot, "organization", "campus.md"));
  const campusRecord = campusFile.records[0];
  const campusName = campusRecord
    ? campusFile.title.replace(/^Campus\b\s*/i, "").trim() || "Main campus"
    : "Main campus";
  const campus = organization.insertCampus({
    name: campusRecord?.heading ?? campusName,
    ...(campusRecord ? { city: field(campusRecord, "City") } : {}),
  });
  mainCampusId = campus.id;

  const ministriesFile = parseFile(join(sourceRoot, "organization", "ministries.md"));
  for (const record of ministriesFile.records) {
    const purposeLines = record.bodyBlocks.filter((b) => b.type === "paragraph").map((b) => b.html);
    const ministry = organization.insertMinistry({
      name: record.heading,
      purpose: purposeLines.join(" ").replace(/<[^>]+>/g, ""),
      campusId: mainCampusId,
    });
    ministryByName.set(record.heading.toLowerCase(), { name: record.heading, id: ministry.id });
    counts.ministries++;
  }

  const groupsFile = parseFile(join(sourceRoot, "organization", "groups.md"));
  for (const record of groupsFile.records) {
    const group = organization.insertGroup({
      name: record.heading,
      description: record.bodyBlocks
        .filter((b) => b.type === "paragraph")
        .map((b) => b.html)
        .join(" ")
        .replace(/<[^>]+>/g, ""),
      campusId: /church-wide/i.test(field(record, "Campus") ?? "") ? undefined : mainCampusId,
      leadershipAudience: /^yes$/i.test(field(record, "Receives leadership reports") ?? "no"),
      groupType: (field(record, "Kind") ?? "team").toLowerCase().includes("leadership")
        ? "leadership-body"
        : "team",
    });
    groupByName.set(record.heading.toLowerCase(), group.id);
    counts.groups++;
  }

  /* -------------------------------------------------------------- people */
  for (const entry of roster) {
    const person = organization.insertPerson({
      name: entry.name,
      role: entry.title ?? "",
      accessRole: entry.access.toLowerCase().replace(/\s+/g, "-") as never,
      campusId: mainCampusId,
    });
    entry.personId = person.id;
    rosterByName.set(entry.name.toLowerCase(), entry);

    const account = accounts.create({ personId: person.id, status: "active" });
    entry.accountId = account.id;

    onboarding.save(person.id, {
      status: "complete",
      step: onboardingSteps[onboardingSteps.length - 1],
      version: ONBOARDING_VERSION,
    });

    counts.people++;
  }

  /* Ministry leads from organization/ministries.md, once every person exists. */
  for (const record of ministriesFile.records) {
    const leadName = field(record, "Lead");
    if (!leadName || /not yet assigned/i.test(leadName)) continue;
    const leadId = resolvePersonId(leadName);
    if (!leadId) {
      warn(`ministries.md: "${record.heading}" names a lead I could not resolve: "${leadName}"`);
      continue;
    }
    const ministry = ministryByName.get(record.heading.toLowerCase())!;
    organization.updateMinistry(ministry.id, { leadId });
    ministry.leadId = leadId;
  }

  /* Reporting lines, ministry/group membership, from each profile. */
  for (const entry of roster) {
    if (entry.reportsToRaw) {
      const reportsToId = resolvePersonId(entry.reportsToRaw);
      if (reportsToId) organization.updatePerson(entry.personId!, { reportsToId });
      else
        warn(`${entry.name}: "Reports to: ${entry.reportsToRaw}" did not resolve to a roster name`);
    }

    for (const membership of entry.ministries) {
      const ministry = ministryByName.get(membership.ministryName.toLowerCase());
      if (!ministry) {
        warn(`${entry.name}: unknown ministry "${membership.ministryName}"`);
        continue;
      }
      organization.addMember(ministry.id, entry.personId!, membership.fn === "sees-only");
      if ((membership.fn === "head" || membership.fn === "leader") && !ministry.leadId) {
        organization.updateMinistry(ministry.id, { leadId: entry.personId });
        ministry.leadId = entry.personId!;
      }
    }

    for (const groupName of entry.groups) {
      const groupId = groupByName.get(groupName.toLowerCase());
      if (!groupId) {
        warn(`${entry.name}: unknown responsibility group "${groupName}"`);
        continue;
      }
      organization.setGroupMembership(groupId, entry.personId!, true);
    }

    /* Designated identities are chosen after all content is imported, by how
       much of it there turns out to be — see "who is selectable", below. */
  }

  /* ------------------------------------------------------------ content */

  function ownerOf(file: string): RosterEntry | undefined {
    const slug = relative(join(sourceRoot!, "characters"), file).split("/")[0]!;
    return roster.find((r) => r.slug === slug);
  }

  function visibilityOf(word: string | undefined): { visibility: string; needsAudience: boolean } {
    switch ((word ?? "").trim()) {
      case "Only me":
        return { visibility: "private", needsAudience: false };
      case "Named people":
        return { visibility: "restricted", needsAudience: true };
      case "Leadership":
        return { visibility: "leadership", needsAudience: false };
      case "Shared":
      case "":
        return { visibility: "shared", needsAudience: false };
      default:
        warn(`unrecognised report visibility "${word}"; treated as Shared`);
        return { visibility: "shared", needsAudience: false };
    }
  }

  function tagsOf(record: ParsedRecord): string[] {
    const raw = field(record, "Tags");
    if (!raw) return [];
    return raw
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/^#/, "").toLowerCase());
  }

  function closingParagraph(record: ParsedRecord): BodyBlock[] {
    const lines: string[] = [];
    for (const key of ["Related goal", "Biblical account", "Reflection theme"]) {
      for (const value of record.closing.get(key) ?? []) lines.push(`${key}: ${value}`);
    }
    return lines.length ? [{ type: "paragraph", html: escapeHtml(lines.join(" · ")) }] : [];
  }

  function relatedText(record: ParsedRecord): string | undefined {
    const account = record.closing.get("Biblical account")?.join("; ");
    return account;
  }

  /** Attention / Action requested / Approval requested → escalations on a report or reach-out entry. */
  function writeEscalations(
    record: ParsedRecord,
    sourceType: "leadership-report" | "reach-out-report",
    sourceId: string,
    requestedById: string,
    atIso: string,
  ) {
    const attentionTexts = (record.closing.get("Attention") ?? []).filter(
      (t) => !/^none\.?$/i.test(t.trim()),
    );
    for (const text of attentionTexts) {
      const to = record.closing.get("Attention to")?.[0] ?? "Reporting leader";
      const roleKey = RECIPIENT_ROLE[to.toLowerCase()];
      const personId = roleKey ? undefined : resolvePersonId(to);
      if (!roleKey && !personId)
        warn(`"Attention to: ${to}" did not resolve to a role or roster name`);
      escalations.insert({
        type: "attention",
        status: "raised",
        sourceType,
        sourceId,
        request: text,
        requestedById,
        ...(roleKey
          ? { requestedFromRole: roleKey as never }
          : personId
            ? { requestedFromPersonId: personId }
            : {}),
      });
      counts.escalations++;
    }

    for (const [key, type, status] of [
      ["Action requested", "action", "requested"],
      ["Approval requested", "approval", "requested"],
    ] as const) {
      for (const raw of record.closing.get(key) ?? []) {
        const match = /^(.*?)\s+—\s+from\s+([^,]+?)(?:,\s*by\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(raw);
        if (!match) {
          warn(`could not parse "${key}: ${raw}" (${record.sourceFile})`);
          continue;
        }
        const [, request, from, by] = match;
        const roleKey = RECIPIENT_ROLE[from!.trim().toLowerCase()];
        const personId = roleKey ? undefined : resolvePersonId(from!);
        if (!roleKey && !personId)
          warn(`"${key}: ${raw}" — "${from}" did not resolve to a role or roster name`);
        escalations.insert({
          type,
          status,
          sourceType,
          sourceId,
          request: request!.trim(),
          requestedById,
          ...(roleKey
            ? { requestedFromRole: roleKey as never }
            : personId
              ? { requestedFromPersonId: personId }
              : {}),
          ...(by ? { neededBy: by } : {}),
        });
        counts.escalations++;
      }
    }
    void atIso;
  }

  function importLeadershipReport(
    file: string,
    record: ParsedRecord,
    defaultVisibility?: string,
    personalReflection = false,
  ) {
    const owner = ownerOf(file);
    if (!owner?.personId) return void counts.skippedRecords++;
    const authorId = resolvePersonId(field(record, "Owner")) ?? owner.personId;
    const date = record.headingDate ?? field(record, "Date");
    if (!date) {
      warn(`"${record.heading}" (${file}) has no Date; skipped`);
      return void counts.skippedRecords++;
    }
    const { visibility, needsAudience } = visibilityOf(
      field(record, "Visibility") ?? defaultVisibility,
    );
    const sharedWith = resolveNames(field(record, "Shared with"))
      .map(resolvePersonId)
      .filter(Boolean) as string[];
    if (needsAudience && sharedWith.length === 0) {
      warn(`"${record.heading}" (${file}) is Named people with no resolvable "Shared with"`);
    }
    const status = /^draft$/i.test(field(record, "Status") ?? "") ? "draft" : "published";
    const html = record.bodyBlocks.length ? undefined : undefined;
    void html;

    const publishedAt = atNoon(date);
    const inserted = reports.insert({
      title: record.heading,
      reportType: field(record, "Record type") ?? "Report",
      authorId,
      reportingPeriod: `Week of ${date}`,
      category: "general",
      status: status as never,
      visibility: visibility as never,
      discussionPolicy: "viewers",
      contentSource: "native",
      audienceIds: sharedWith,
      relatedDocumentIds: [],
      links: [],
      tags: tagsOf(record),
      blocks: [...record.bodyBlocks, ...closingParagraph(record)] as never,
      ...(relatedText(record) ? { relatedText: relatedText(record) } : {}),
      ...(status === "published" ? { publishedAt } : {}),
    });
    backdate("leadership_report", inserted.id, publishedAt);
    if (personalReflection) counts.personalReflections++;
    else counts.leadershipReports++;

    let commentTime = new Date(publishedAt).getTime();
    for (const comment of record.comments) {
      const authorId2 = resolvePersonId(comment.name);
      if (!authorId2) {
        warn(`comment by unresolved name "${comment.name}" on "${record.heading}" (${file})`);
        continue;
      }
      commentTime += 60 * 60 * 1000;
      const c = reports.insertComment({
        reportId: inserted.id,
        authorId: authorId2,
        body: escapeHtml(comment.body),
      });
      backdateCreatedOnly("comment", c.id, new Date(commentTime).toISOString());
      counts.comments++;
    }

    writeEscalations(record, "leadership-report", inserted.id, authorId, publishedAt);
  }

  function importReachOut(file: string, record: ParsedRecord) {
    const owner = ownerOf(file);
    if (!owner?.personId) return void counts.skippedRecords++;
    const authorId = resolvePersonId(field(record, "Owner")) ?? owner.personId;
    const date = record.headingDate ?? field(record, "Date");
    if (!date) {
      warn(`Reach-Out "${record.heading}" (${file}) has no Date; skipped`);
      return void counts.skippedRecords++;
    }
    const at = atNoon(date);
    const contentHtml = [...record.bodyBlocks, ...closingParagraph(record)]
      .map((b) => b.html)
      .join("\n");
    const inserted = reachOut.insert({
      title: record.heading,
      reportDate: date,
      content: contentHtml,
      authorId,
    });
    backdate("reach_out_report", inserted.id, at);
    counts.reachOut++;

    let commentTime = new Date(at).getTime();
    for (const comment of record.comments) {
      const commentAuthorId = resolvePersonId(comment.name);
      if (!commentAuthorId) {
        warn(`comment by unresolved name "${comment.name}" on "${record.heading}" (${file})`);
        continue;
      }
      commentTime += 60 * 60 * 1000;
      const insertedComment = reachOut.insertComment({
        parentId: inserted.id,
        authorId: commentAuthorId,
        body: escapeHtml(comment.body),
      });
      backdateCreatedOnly("comment", insertedComment.id, new Date(commentTime).toISOString());
      counts.comments++;
    }
    writeEscalations(record, "reach-out-report", inserted.id, authorId, at);
  }

  const CALENDAR_CATEGORY: Record<string, string> = {
    "prayer & fasting": "prayer-fasting",
    chat: "chat",
    lifegroup: "lifegroup",
    potbless: "potbless",
    victuals: "victuals",
    seed: "seed",
    mentorship: "mentorship",
    "ministry meeting": "ministry-meeting",
    service: "service",
    celebration: "celebration",
    other: "other",
  };
  const WEEKDAY_INDEX: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  function importCalendarEntry(file: string, record: ParsedRecord) {
    const owner = ownerOf(file);
    if (!owner?.personId) return void counts.skippedRecords++;

    const categoryRaw = (field(record, "Category") ?? "Other").trim().toLowerCase();
    const category = CALENDAR_CATEGORY[categoryRaw];
    if (!category) {
      warn(`calendar "${record.heading}" (${file}): unrecognised category "${categoryRaw}"`);
      return void counts.skippedRecords++;
    }

    const ministryName = field(record, "Ministry");
    const ministry = ministryName ? ministryByName.get(ministryName.toLowerCase()) : undefined;
    if (ministryName && !ministry) {
      warn(`calendar "${record.heading}" (${file}): unknown ministry "${ministryName}"`);
    }
    const organizerId = ministry?.leadId ?? owner.personId;

    const repeatsRaw = field(record, "Repeats");
    let recurrence:
      { frequency: string; weekday?: number; from: string; until?: string } | undefined;
    if (repeatsRaw) {
      const from = field(record, "From");
      if (!from) {
        warn(`calendar "${record.heading}" (${file}): "Repeats" with no "From" date; skipped`);
        return void counts.skippedRecords++;
      }
      const until = field(record, "Until");
      const on = /^(daily|monthly|yearly)$/i.exec(repeatsRaw.trim());
      const weekly = /^(weekly|fortnightly)\s+on\s+(\w+)$/i.exec(repeatsRaw.trim());
      if (on) {
        recurrence = { frequency: on[1]!.toLowerCase(), from, ...(until ? { until } : {}) };
      } else if (weekly) {
        const weekday = WEEKDAY_INDEX[weekly[2]!.toLowerCase()];
        if (weekday === undefined) {
          warn(
            `calendar "${record.heading}" (${file}): unrecognised weekday in "Repeats: ${repeatsRaw}"`,
          );
          return void counts.skippedRecords++;
        }
        recurrence = {
          frequency: weekly[1]!.toLowerCase(),
          weekday,
          from,
          ...(until ? { until } : {}),
        };
      } else {
        warn(`calendar "${record.heading}" (${file}): unrecognised "Repeats: ${repeatsRaw}"`);
        return void counts.skippedRecords++;
      }
    }

    const date = recurrence ? undefined : (record.headingDate ?? field(record, "Date"));
    if (!recurrence && !date) {
      warn(`calendar "${record.heading}" (${file}) has neither "Repeats" nor "Date"; skipped`);
      return void counts.skippedRecords++;
    }

    const timeRaw = field(record, "Time");
    const [startTime, endTime] = timeRaw ? timeRaw.split(/[–-]/).map((t) => t.trim()) : [];
    const note = record.bodyBlocks.map((b) => b.html).join("\n");

    calendar.insertEntry({
      title: record.heading,
      ...(date ? { date } : {}),
      ...(recurrence ? { recurrence: recurrence as never } : {}),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      category: category as never,
      ...(ministry ? { ministryId: ministry.id } : {}),
      ...(field(record, "Location") ? { location: field(record, "Location") } : {}),
      ...(note.trim() ? { note } : {}),
      organizerId,
      createdBy: owner.personId,
      source: "church",
    });
    counts.calendarEntries++;
  }

  function lifegroupSections(record: ParsedRecord): {
    reportBlocks: BodyBlock[];
    entries: { label: string; fields: Map<string, string[]>; blocks: BodyBlock[] }[];
  } {
    const entryHeading = /^###\s+(Discussion|Prayer|Testimony|Follow-up|Attention)\s*$/i;
    const starts: { index: number; label: string }[] = [];
    for (let i = 0; i < record.rawBodyLines.length; i++) {
      const match = entryHeading.exec(record.rawBodyLines[i]!);
      if (match) starts.push({ index: i, label: match[1]! });
    }

    const reportEnd = starts[0]?.index ?? record.rawBodyLines.length;
    const entries = starts.map((start, index) => {
      const end = starts[index + 1]?.index ?? record.rawBodyLines.length;
      const { fields, next } = parseFieldLines(record.rawBodyLines.slice(0, end), start.index + 1);
      return {
        label: start.label,
        fields,
        blocks: toBlocks(record.rawBodyLines.slice(next, end)),
      };
    });
    return { reportBlocks: toBlocks(record.rawBodyLines.slice(0, reportEnd)), entries };
  }

  function lifegroupVisibility(word: string | undefined): string {
    switch ((word ?? "Lifegroup leaders").trim()) {
      case "Lifegroup leaders":
        return "leaders";
      case "This gathering's leaders":
        return "assigned-leaders";
      case "Named people":
        return "selected-viewers";
      case "Only me":
        return "private";
      default:
        warn(`unrecognised Lifegroup entry visibility "${word}"; treated as Only me`);
        return "private";
    }
  }

  function importLifegroupGathering(file: string, record: ParsedRecord) {
    const owner = ownerOf(file);
    if (!owner?.personId) return void counts.skippedRecords++;
    const date = record.headingDate ?? field(record, "Date");
    if (!date) {
      warn(`Lifegroup "${record.heading}" (${file}) has no date; skipped`);
      return void counts.skippedRecords++;
    }
    const ledBy = resolveNames(field(record, "Led by"));
    const leaderIds = [owner.personId, ...ledBy.map(resolvePersonId).filter(Boolean)] as string[];
    const uniqueLeaders = [...new Set(leaderIds)];

    const at = atNoon(date);
    const gathering = lifegroup.insertGathering({
      date,
      venueName: field(record, "Venue"),
      assignedLeaderIds: uniqueLeaders,
      primaryLeaderId: owner.personId,
      campusId: mainCampusId,
      status: "completed",
    } as never);
    backdate("gathering", gathering.id, at);
    counts.gatherings++;

    const scripture = record.closing.get("Biblical account")?.join("; ");
    lifegroup.setExhortation(gathering.id, {
      topic: record.heading,
      ...(scripture ? { scripture } : {}),
    });

    const parsedSections = lifegroupSections(record);
    const mainText = parsedSections.reportBlocks.map((b) => b.html).join("\n");
    lifegroup.setReport(gathering.id, {
      summary: mainText,
      completedAt: at,
      completedById: owner.personId,
    });

    const attendanceRaw = field(record, "Attendance");
    if (attendanceRaw) {
      for (const rawName of attendanceRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const firstTimeMatch = /^(.*?)\s*\(first-time visitor:\s*(.+)\)$/i.exec(rawName);
        const name = firstTimeMatch ? firstTimeMatch[1]!.trim() : rawName;
        const visitorName = firstTimeMatch?.[2];
        const personId = resolvePersonId(name);
        lifegroup.markAttendance({
          gatheringId: gathering.id,
          ...(personId ? { personId } : { name }),
          status: "present",
          firstTime: Boolean(visitorName),
        });
      }
    }

    /* §Discussion / §Prayer / §Testimony / §Follow-up / §Attention → entries. */
    for (const section of parsedSections.entries) {
      if (section.blocks.length === 0) continue;
      const visibility = lifegroupVisibility(section.fields.get("Visibility")?.[0]);
      const viewerIds = resolveNames(section.fields.get("Shared with")?.[0])
        .map(resolvePersonId)
        .filter(Boolean) as string[];
      if (visibility === "selected-viewers" && viewerIds.length === 0) {
        warn(`Lifegroup entry "${section.label}" (${file}) names no resolvable viewers`);
      }
      const entry = lifegroup.insertEntry({
        gatheringId: gathering.id,
        authorId: owner.personId,
        body: section.blocks.map((block) => block.html).join("\n"),
        category: {
          Discussion: "general",
          Prayer: "prayer",
          Testimony: "highlight",
          "Follow-up": "follow-up",
          Attention: "concern",
        }[section.label] as never,
        visibility: visibility as never,
        ...(viewerIds.length > 0 ? { viewerIds } : {}),
      });
      backdate("lifegroup_entry", entry.id, at);
      counts.lifegroupEntries++;
    }
  }

  function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "");
  }

  function importMeetingNote(file: string, record: ParsedRecord) {
    const owner = ownerOf(file);
    if (!owner?.personId) return void counts.skippedRecords++;
    const date = record.headingDate ?? field(record, "Date");
    if (!date) {
      warn(`Meeting note "${record.heading}" (${file}) has no date; skipped`);
      return void counts.skippedRecords++;
    }
    const noteType = /personal/i.test(field(record, "Kind") ?? "") ? "personal" : "minutes";
    const meetingTypeRaw = (field(record, "Meeting type") ?? "Other").toLowerCase();
    const meetingType = (
      ["leaders", "ministry", "lifegroup", "planning", "coaching", "campus"].includes(
        meetingTypeRaw,
      )
        ? meetingTypeRaw
        : "other"
    ) as never;
    const facilitatorId = resolvePersonId(field(record, "Facilitator")) ?? owner.personId;
    const noteTakerId = resolvePersonId(field(record, "Note taker"));
    const participantIds = [
      ...new Set([
        owner.personId,
        ...resolveNames(field(record, "Participants")).map(resolvePersonId).filter(Boolean),
      ] as string[]),
    ];
    const absenteeIds = resolveNames(field(record, "Absent"))
      .map(resolvePersonId)
      .filter(Boolean) as string[];

    const at = atNoon(date);
    const inserted = meetings.insertNote({
      title: record.heading,
      noteType: noteType as never,
      date,
      type: meetingType,
      facilitatorId,
      ...(noteTakerId ? { noteTakerId } : {}),
      participantIds,
      ...(absenteeIds.length ? { absenteeIds } : {}),
      blocks: [...record.bodyBlocks, ...closingParagraph(record)] as never,
      status: "complete" as never,
      tags: tagsOf(record) as never,
    } as never);
    backdate("meeting_note", inserted.id, at);
    counts.meetingNotes++;

    /* `- [ ] Task — Assignee, due YYYY-MM-DD` */
    for (const block of record.bodyBlocks) {
      if (block.type !== "checklist") continue;
      const text = stripHtml(block.html);
      const match = /^(.*?)\s+—\s+([^,]+?)(?:,\s*due\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(text);
      const title = match ? match[1]!.trim() : text;
      const assigneeName = match?.[2];
      const dueDate = match?.[3];
      const assigneeId = assigneeName ? resolvePersonId(assigneeName) : undefined;
      if (assigneeName && !assigneeId)
        warn(`meeting task "${text}" (${file}): assignee "${assigneeName}" not resolved`);
      const task = meetings.insertTask({
        meetingId: inserted.id,
        title,
        ...(assigneeId ? { assigneeId } : {}),
        ...(dueDate ? { dueDate } : {}),
        status: block.checked ? "done" : "open",
      });
      void task;
      counts.meetingTasks++;
    }
  }

  const GOAL_STATUS: Record<string, string> = {
    Active: "active",
    Completed: "completed",
    "On hold": "on-hold",
    "Carried forward": "carried-forward",
  };

  function importGoals(file: string) {
    const owner = ownerOf(file);
    if (!owner?.personId) return;
    const parsed = parseFile(file);
    for (const record of parsed.records) {
      const status = GOAL_STATUS[field(record, "Status") ?? "Active"] ?? "active";
      const ministryName = field(record, "Ministry");
      const ministryId = ministryName
        ? ministryByName.get(ministryName.toLowerCase())?.id
        : undefined;
      if (ministryName && !ministryId)
        warn(`goal "${record.heading}" (${file}): unknown ministry "${ministryName}"`);
      const targetRaw = field(record, "Target");
      const target = targetRaw
        ? /^\d{4}-\d{2}-\d{2}$/.test(targetRaw)
          ? { precision: "date" as const, value: targetRaw }
          : { precision: "month" as const, value: targetRaw }
        : undefined;

      const description = record.bodyBlocks
        .filter((b) => b.type !== "heading-1" && b.type !== "heading-2")
        .map((b) => stripHtml(b.html))
        .join("\n\n");

      const inserted = goals.insertGoal({
        year: 2026,
        title: record.heading,
        description,
        ...(ministryId ? { ministryId } : {}),
        ownerId: owner.personId,
        campusId: mainCampusId,
        ...(target ? { target } : {}),
        status: status as never,
      });
      counts.goals++;

      const progressHeadingIndex = record.bodyBlocks.findIndex(
        (b) =>
          (b.type === "heading-1" || b.type === "heading-2") &&
          /^progress\b/i.test(stripHtml(b.html)),
      );
      if (progressHeadingIndex !== -1) {
        for (let j = progressHeadingIndex + 1; j < record.bodyBlocks.length; j++) {
          const block = record.bodyBlocks[j]!;
          if (block.type === "heading-1" || block.type === "heading-2") break;
          if (block.type !== "bullet") continue;
          const match = /^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/.exec(stripHtml(block.html));
          if (!match) {
            warn(`goal update line without a leading date: "${stripHtml(block.html)}" (${file})`);
            continue;
          }
          goals.insertUpdate({
            goalId: inserted.id,
            date: match[1]!,
            text: match[2]!,
            kind: "note",
          });
          counts.goalUpdates++;
        }
      }
    }
  }

  for (const characterDir of readdirSync(join(sourceRoot, "characters"))) {
    const base = join(sourceRoot, "characters", characterDir);
    if (!statSync(base).isDirectory()) continue;

    const goalsPath = join(base, "2026-goals.md");
    if (existsSync(goalsPath)) importGoals(goalsPath);
    /* A ministry's own goals, filed under its head's folder rather than the
       personal 2026-goals.md — same record shape, same importer. */
    for (const file of findFiles(join(base, "content", "ministry-goals"))) importGoals(file);

    for (const file of findFiles(join(base, "content"))) {
      const parsed = parseFile(file);
      for (const record of parsed.records) {
        const section = field(record, "Oikonomia section") ?? field(parsed, "Oikonomia section");
        try {
          if (section === "Leadership Report") importLeadershipReport(file, record);
          else if (section === "Personal Reflection")
            importLeadershipReport(file, record, "Only me", true);
          else if (section === "Lifegroup Gathering") importLifegroupGathering(file, record);
          else if (section === "Meeting Notes") importMeetingNote(file, record);
          else if (section === "Reach-Out") importReachOut(file, record);
          else if (section === "Calendar") importCalendarEntry(file, record);
          else if (section === "Goals" || section === "Form") {
            /* Goals (personal and ministry) are read directly, above; Form has
               no authored content yet in this corpus. */
          } else {
            warn(`"${record.heading}" (${file}): unrecognised Oikonomia section "${section}"`);
            counts.skippedRecords++;
          }
        } catch (error) {
          warn(
            `"${record.heading}" (${file}) failed to import: ${error instanceof Error ? error.message : String(error)}`,
          );
          counts.skippedRecords++;
        }
      }
    }
  }

  /* --------------------------------------------------- 6. who is selectable */

  /*
   * With every report, reflection, gathering, meeting, goal and reach-out
   * now written, "substantial content" is something that can actually be
   * counted rather than guessed from a profile field. `Demo persona: No`
   * is still honoured as an exclusion — that is a curatorial decision the
   * corpus made on purpose — but Featured and Available no longer decide
   * the chooser by themselves: the ones with the most to explore do,
   * bounded at `maxDesignated`, plus whoever `alwaysDesignate` names
   * regardless of where they rank.
   */
  const richnessOf = (personId: string): number =>
    (
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM leadership_report WHERE author_id = ?) * 3 +
             (SELECT COUNT(*) FROM gathering WHERE primary_leader_id = ?) * 2 +
             (SELECT COUNT(*) FROM meeting_note WHERE facilitator_id = ?) +
             (SELECT COUNT(*) FROM goal WHERE owner_id = ?) +
             (SELECT COUNT(*) FROM reach_out_report WHERE author_id = ?) +
             (SELECT COUNT(*) FROM comment WHERE author_id = ?) AS n`,
        )
        .get(personId, personId, personId, personId, personId, personId) as { n: number }
    ).n;

  const eligible = roster
    .filter((entry) => entry.personId && entry.demoPersona !== "No")
    .map((entry) => ({ entry, richness: richnessOf(entry.personId!) }))
    .sort((a, b) => b.richness - a.richness);

  const forcedNames = new Set(alwaysDesignate.map((n) => n.toLowerCase()));
  const forced = eligible.filter(({ entry }) => forcedNames.has(entry.name.toLowerCase()));
  for (const name of alwaysDesignate) {
    if (!forced.some(({ entry }) => entry.name.toLowerCase() === name.toLowerCase())) {
      warn(`--always-designate names "${name}", which is not an eligible roster member`);
    }
  }
  const ranked = eligible.filter(({ entry }) => !forcedNames.has(entry.name.toLowerCase()));
  const selected = [...forced, ...ranked.slice(0, Math.max(0, maxDesignated))].sort((a, b) =>
    a.entry.name.localeCompare(b.entry.name),
  );

  selected.forEach(({ entry }, index) => {
    demoIdentities.insert({ personId: entry.personId!, kind: "designated", displayOrder: index });
    counts.designated++;
  });
});

try {
  run();
} catch (error) {
  console.error("Import failed; the transaction was rolled back. Nothing was written.");
  throw error;
}

/* -------------------------------------------------------------- report */

const unsafe: string[] = [];
for (const row of db
  .prepare("SELECT id, blocks FROM leadership_report WHERE blocks IS NOT NULL")
  .all() as {
  id: string;
  blocks: string;
}[]) {
  for (const block of JSON.parse(row.blocks) as { html: string }[]) {
    if (!inlineHtmlIsSafe(block.html)) unsafe.push(row.id);
  }
}

console.log(
  JSON.stringify(
    {
      ...counts,
      warnings: warnings.length,
      unsafeHtmlBlocks: unsafe.length,
      integrity: db.pragma("integrity_check", { simple: true }),
      foreignKeyProblems: (db.pragma("foreign_key_check") as unknown[]).length,
      dryRun,
    },
    null,
    1,
  ),
);
if (warnings.length > 0) {
  console.log(`\n--- ${warnings.length} warning(s) ---`);
  for (const w of warnings) console.log(`  ${w}`);
}
db.close();
if (!dryRun) {
  console.log(
    `\nImported into ${targetPath}. It is not yet a Demo baseline — run mark-demo-baseline.mjs next.`,
  );
}
