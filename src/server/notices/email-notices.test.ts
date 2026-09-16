import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as Db } from "better-sqlite3";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createEscalationRepository } from "../repositories/escalation-repository";
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createNoticeEmailRepository } from "../repositories/notice-email-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createEscalationService } from "../services/escalation-service";
import { createMeetingService } from "../services/meeting-service";
import { createNoticeEmailService } from "../services/notice-email-service";
import { createNoticeMailer, type NoticeMailer } from "./notice-mailer";
import { viewerOf } from "@/domain/viewer";
import type { DeliveryAdapter } from "../auth/delivery";

/**
 * Notices by email.
 *
 * The claims: nobody is emailed who did not ask to be; nobody is emailed about
 * their own action; the email points at the record (whose own access checks
 * still stand); and a failure to send never becomes a failure to save.
 */

let dir: string;
let db: Db;
let org: ReturnType<typeof createOrganizationRepository>;
let preferences: ReturnType<typeof createNoticeEmailRepository>;
let sent: { to: string; subject: string; body: string }[];
let adapter: DeliveryAdapter;
let mailer: NoticeMailer;

let joel: ReturnType<typeof viewerOf>;
let maria: ReturnType<typeof viewerOf>;
let ruth: ReturnType<typeof viewerOf>;

const BASE = "https://binder.stjohns.org";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-notice-email-"));
  db = openDatabase(join(dir, "test.db"));
  org = createOrganizationRepository(db);
  preferences = createNoticeEmailRepository(db);

  const campus = org.insertCampus({ name: "Scarborough" });
  const joelRecord = org.insertPerson({
    name: "Joel Tan",
    email: "joel@stjohns.org",
    campusId: campus.id,
  });
  const mariaRecord = org.insertPerson({
    name: "Maria Santos",
    email: "maria@stjohns.org",
    campusId: campus.id,
    reportsToId: joelRecord.id,
  });
  const ruthRecord = org.insertPerson({
    name: "Ruth Alvarez",
    email: "ruth@stjohns.org",
    campusId: campus.id,
  });
  joel = viewerOf(org.findPerson(joelRecord.id)!);
  maria = viewerOf(org.findPerson(mariaRecord.id)!);
  ruth = viewerOf(org.findPerson(ruthRecord.id)!);

  sent = [];
  adapter = {
    id: "test",
    reachesRecipients: true,
    send: vi.fn(async (message) => {
      sent.push(message);
    }),
  };
  mailer = createNoticeMailer({
    wants: preferences.wants,
    findPerson: (id) => org.findPerson(id),
    delivery: () => adapter,
    baseUrl: () => BASE,
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("preferences", () => {
  const service = () =>
    createNoticeEmailService(preferences, (personId) => org.findPerson(personId)?.email);

  it("start off for every kind", () => {
    expect(service().mine(maria)).toEqual({
      preferences: { ask: false, "meeting-task": false },
      address: "maria@stjohns.org",
    });
  });

  it("are the viewer's own to turn on and off", () => {
    expect(service().set(maria, { kind: "ask", enabled: true }).preferences.ask).toBe(true);
    expect(service().mine(joel).preferences.ask).toBe(false);
    expect(service().set(maria, { kind: "ask", enabled: true }).preferences.ask).toBe(true);
    expect(service().set(maria, { kind: "ask", enabled: false }).preferences.ask).toBe(false);
  });

  it("refuse a kind that does not exist", () => {
    expect(() => service().set(maria, { kind: "overdue", enabled: true })).toThrow(ApiError);
  });
});

describe("the mailer", () => {
  const notice = (recipientIds: string[], actorId = joel.person.id) => ({
    kind: "ask" as const,
    actorId,
    recipientIds,
    compose: () => ({ subject: "s", body: "b" }),
  });

  it("emails only people who turned that kind on", () => {
    preferences.set(maria.person.id, "ask", true);
    preferences.set(ruth.person.id, "meeting-task", true);
    mailer.notify(notice([maria.person.id, ruth.person.id]));
    expect(sent.map((m) => m.to)).toEqual(["maria@stjohns.org"]);
  });

  it("never emails the person who acted", () => {
    preferences.set(joel.person.id, "ask", true);
    mailer.notify(notice([joel.person.id]));
    expect(sent).toEqual([]);
  });

  it("skips people with no address and people who have left", () => {
    preferences.set(maria.person.id, "ask", true);
    preferences.set(ruth.person.id, "ask", true);
    org.updatePerson(maria.person.id, { email: undefined });
    org.updatePerson(ruth.person.id, { active: false });
    mailer.notify(notice([maria.person.id, ruth.person.id]));
    expect(sent).toEqual([]);
  });

  it("does not throw when delivery fails, or when composing fails", async () => {
    preferences.set(maria.person.id, "ask", true);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    adapter.send = () => Promise.reject(new Error("Google could not be reached"));
    expect(() => mailer.notify(notice([maria.person.id]))).not.toThrow();
    expect(() =>
      mailer.notify({
        ...notice([maria.person.id]),
        compose: () => {
          throw new Error("no");
        },
      }),
    ).not.toThrow();
    await Promise.resolve();
    expect(logged).toHaveBeenCalled();
  });
});

describe("an ask, by email", () => {
  const service = (with_: NoticeMailer | undefined = mailer) =>
    createEscalationService(createEscalationRepository(db), org, undefined, with_);

  const raise = (viewer: typeof maria, extra: Record<string, unknown>) =>
    service().raise(viewer, {
      type: "action",
      sourceType: "leadership-report",
      sourceId: "rep-1",
      request: "Please book the hall for the outreach night.",
      neededBy: "2026-09-22",
      ...extra,
    });

  it("reaches a named person who opted in, with what was asked and a link", () => {
    preferences.set(ruth.person.id, "ask", true);
    raise(maria, { requestedFromPersonId: ruth.person.id });

    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email!.to).toBe("ruth@stjohns.org");
    expect(email!.subject).toBe("Maria Santos: Action requested");
    expect(email!.body).toContain("Please book the hall for the outreach night.");
    expect(email!.body).toContain("Needed by Tuesday 22 September 2026.");
    expect(email!.body).toContain(`${BASE}/leadership-reports/rep-1`);
  });

  it("reaches nobody who did not opt in", () => {
    raise(maria, { requestedFromPersonId: ruth.person.id });
    expect(sent).toEqual([]);
  });

  it("reaches the person who holds the position for the one asking", () => {
    preferences.set(joel.person.id, "ask", true);
    preferences.set(ruth.person.id, "ask", true);
    raise(maria, { requestedFromRole: "reporting-leader" });
    expect(sent.map((m) => m.to)).toEqual(["joel@stjohns.org"]);
  });

  it("is not sent to yourself for your own ask", () => {
    preferences.set(maria.person.id, "ask", true);
    raise(maria, { requestedFromPersonId: maria.person.id });
    expect(sent).toEqual([]);
  });

  it("links a meeting note ask to the note", () => {
    preferences.set(ruth.person.id, "ask", true);
    raise(maria, {
      requestedFromPersonId: ruth.person.id,
      sourceType: "meeting-note",
      sourceId: "mn-9",
    });
    expect(sent[0]!.body).toContain(`${BASE}/meeting-notes?note=mn-9`);
  });

  it("is saved even when the mailer itself throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: NoticeMailer = {
      notify: () => {
        throw new Error("mail is down");
      },
    };
    const saved = service(broken).raise(maria, {
      type: "attention",
      sourceType: "leadership-report",
      sourceId: "rep-1",
      request: "Please look at this.",
      requestedFromPersonId: ruth.person.id,
    });
    expect(createEscalationRepository(db).find(saved.id)).toBeDefined();
  });
});

describe("a meeting task, by email", () => {
  const service = (with_: NoticeMailer | undefined = mailer) =>
    createMeetingService(createMeetingRepository(db), with_);

  const minutes = (participantIds: string[] = []) =>
    service().createNote(joel, {
      title: "Leaders Meeting",
      noteType: "minutes",
      date: "2026-09-08",
      participantIds,
    });

  it("reaches the assignee who opted in, naming a meeting they may read", () => {
    preferences.set(maria.person.id, "meeting-task", true);
    const note = minutes([maria.person.id]);
    service().createTask(joel, {
      meetingId: note.id,
      title: "Confirm the venue",
      assigneeId: maria.person.id,
      dueDate: "2026-09-15",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("maria@stjohns.org");
    expect(sent[0]!.subject).toBe("Joel Tan gave you a task: Confirm the venue");
    expect(sent[0]!.body).toContain('in "Leaders Meeting"');
    expect(sent[0]!.body).toContain(`${BASE}/meeting-notes?note=${note.id}`);
  });

  it("does not name or link a meeting the assignee may not read", () => {
    preferences.set(maria.person.id, "meeting-task", true);
    const note = service().createNote(joel, {
      title: "Private thoughts on staffing",
      noteType: "personal",
      date: "2026-09-08",
    });
    service().createTask(joel, {
      meetingId: note.id,
      title: "Confirm the venue",
      assigneeId: maria.person.id,
      dueDate: "2026-09-15",
    });

    expect(sent[0]!.body).not.toContain("Private thoughts");
    expect(sent[0]!.body).not.toContain(note.id);
    expect(sent[0]!.body).toContain(`${BASE}/weekly-agenda?date=2026-09-15`);
  });

  it("is not sent for a task you give yourself, or to anyone who did not opt in", () => {
    preferences.set(joel.person.id, "meeting-task", true);
    const note = minutes();
    service().createTask(joel, { meetingId: note.id, title: "Mine", assigneeId: joel.person.id });
    service().createTask(joel, { meetingId: note.id, title: "Ruth's", assigneeId: ruth.person.id });
    expect(sent).toEqual([]);
  });

  it("is sent when a task changes hands, and not when it is merely edited", () => {
    preferences.set(maria.person.id, "meeting-task", true);
    const note = minutes([maria.person.id]);
    const task = service().createTask(joel, { meetingId: note.id, title: "Confirm the venue" });
    expect(sent).toEqual([]);

    service().updateTask(joel, task.id, { assigneeId: maria.person.id });
    expect(sent).toHaveLength(1);

    service().updateTask(joel, task.id, { title: "Confirm the venue and the time" });
    expect(sent).toHaveLength(1);
  });

  it("is saved even when sending fails", async () => {
    preferences.set(maria.person.id, "meeting-task", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    adapter.send = () => Promise.reject(new Error("Google could not be reached"));
    const note = minutes([maria.person.id]);
    const task = service().createTask(joel, {
      meetingId: note.id,
      title: "Confirm the venue",
      assigneeId: maria.person.id,
    });
    await Promise.resolve();
    expect(createMeetingRepository(db).findTask(task.id)).toBeDefined();
  });
});
