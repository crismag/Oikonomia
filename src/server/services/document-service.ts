import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { windowFor } from "../api/pagination";
import { newId } from "../db/records";
import { PAGE_SIZE } from "@/domain/pagination";
import {
  associateDocument,
  createBinderDocument,
  registerDocument,
  resourceQuery,
  saveContent,
  updateDocument,
} from "@/domain/registry-contract";
import {
  opensElsewhere,
  originForUrl,
  originLabel,
  sectionForEntity,
  type BinderContent,
  type DocumentAssociation,
  type DocumentEntityType,
  type RegisteredDocument,
} from "@/domain/registry";
import { sectionLabel } from "@/domain/resources";
import { driveFileIdFromUrl } from "@/domain/drive";
import { dayLabel, venueName } from "@/domain/lifegroup";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { LeadershipReportRepository } from "../repositories/leadership-report-repository";
import type { WorkRepository } from "../repositories/work-repository";
import type { FormsRepository } from "../repositories/forms-repository";
import { resolveAccess } from "@/domain/access";
import { canContribute, canManage, relationshipTo } from "@/domain/ministry";
import {
  mayChangeDocument,
  mayUnfile,
  type DocumentPlace,
  type DocumentRecord,
} from "@/domain/document-record";
import { emptyBlock } from "@/domain/meeting";
import { canDiscover } from "@/domain/leadership-report";
import type { BinderContentRepository } from "../repositories/binder-content-repository";
import type { DocumentRepository } from "../repositories/document-repository";
import type { PageMeta } from "@/lib/api-envelope";
import type {
  BinderSection,
  MeetingBlock,
  ResourceAssociation,
  ResourceSearchResult,
} from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * The document registry.
 *
 * `DOCUMENT-REGISTRY.md` is the contract. What matters most about this module
 * is what it refuses to be:
 *
 * ## It is a registry, not storage
 *
 * A record says what the application knows about a resource. Nothing here
 * fetches, downloads, crawls, indexes, copies or synchronizes anything, and
 * search runs over registered metadata only (Invariant 6). A resource can be
 * found here and still be refused when someone tries to open it — that is
 * Boundary 2, and it belongs to whoever owns the resource.
 *
 * ## Withholding happens in the query
 *
 * Boundary 1 protects counts and suggestions as much as titles, so the
 * repository takes the viewer and a withheld row never reaches this file.
 * Ranking, facets and paging below are therefore all computed over resources
 * the viewer may already know about, and none of them can leak a number.
 *
 * ## Boundary 1 is enforced in two places, and that is deliberate
 *
 * | Rule                                    | Where      | Why |
 * | --------------------------------------- | ---------- | --- |
 * | A private meeting note                  | SQL        | The record is persisted, and the same predicate already filters the paged notes list. |
 * | A leadership report's discoverability    | Service    | `canDiscover` needs the persona, and reports are still fixtures. |
 * | A work item's or event's audience policy | Service    | `resolveAccess` needs the persona, and both are still fixtures. |
 * | A form's audience policy                 | Service    | Same. |
 *
 * Both halves run before anything is counted, ranked or paged, so a withheld
 * resource never reaches a total, a facet count or a response. What the split
 * costs is that a withheld row briefly exists in this process; what it buys is
 * that the rules stay expressed where the records actually live. As each of
 * those modules persists, its rule moves down into the repository's subquery —
 * never up into a component.
 *
 * Ministry, LifeGroup and Reach-Out material carries no rule at all. That is
 * shared leadership work, and saying so is better than inventing gates nobody
 * agreed to (§35).
 */

/**
 * What the registry has to look things up in.
 *
 * A document is registered *somewhere* — in a ministry, on a report, against a
 * gathering — and naming that place, and deciding whether this viewer may know
 * it exists, means reading the record itself. These used to be fixtures, which
 * is why a document could be attached to a ministry that existed only in the
 * source code.
 */
/** The Drive file behind a document: recorded, or read from its pasted Drive address. */
const driveIdOf = (document: RegisteredDocument) =>
  document.origin === "drive"
    ? (document.driveFileId ?? driveFileIdFromUrl(document.url))
    : undefined;

export interface RegistryContext {
  organization: OrganizationRepository;
  reports: LeadershipReportRepository;
  work: WorkRepository;
  forms: FormsRepository;
}

export function createDocumentService(
  repo: DocumentRepository,
  content: BinderContentRepository,
  context_: RegistryContext,
) {
  /* ------------------------------------------------------------ projection */

  /**
   * Context for the records a document takes part in.
   *
   * Persisted sections are resolved by the repository; Ministry, Leadership
   * Reports and Forms are still fixtures and are resolved here. Both are read
   * at request time rather than copied onto the association, so renaming a
   * ministry does not leave stale context in search.
   */
  function labelFor(
    entityType: DocumentEntityType,
    entityId: string,
    persisted: Map<string, { label: string; secondaryLabel?: string }>,
  ): { label?: string; secondaryLabel?: string } {
    if (entityId === "") return {};

    const fromDb = persisted.get(`${entityType}:${entityId}`);
    if (fromDb) return fromDb;

    /*
     * Everything else a document can be attached to is named by the repository
     * above, from the records themselves. An id that resolves to nothing is
     * left unnamed rather than given a plausible label: a document pointing at
     * something deleted should look like exactly that.
     */
    return {};
  }

  /**
   * Every label the registry needs, read once per request.
   *
   * Resolved at read time rather than copied onto the association, so renaming
   * a ministry does not leave stale context behind in search.
   */
  function context(): Map<string, { label: string; secondaryLabel?: string }> {
    const labels = repo.labels();
    /*
     * A LifeGroup resource is named by the place and the day it happened —
     * never by a standing group, which is the model LifeGroup was corrected
     * away from.
     */
    for (const gathering of repo.gatherings()) {
      labels.set(`gathering:${gathering.id}`, {
        label: venueName(context_.organization.venues(), gathering as never),
        secondaryLabel: dayLabel(gathering.date).split(" · ")[1] ?? gathering.date,
      });
    }
    return labels;
  }

  function associationsOf(
    document: RegisteredDocument,
    persisted: Map<string, { label: string; secondaryLabel?: string }>,
  ): ResourceAssociation[] {
    const out: ResourceAssociation[] = [];

    for (const association of document.associations) {
      const section = sectionForEntity[association.entityType];
      const resolved = labelFor(association.entityType, association.entityId, persisted);

      /*
       * One resource is never listed twice for the same place. A document
       * filed in a ministry and also cited by a report in it would otherwise
       * count twice behind one filter.
       */
      if (out.some((a) => a.section === section && a.label === resolved.label)) continue;
      out.push({
        section,
        ...(resolved.label ? { label: resolved.label } : {}),
        ...(resolved.secondaryLabel ? { secondaryLabel: resolved.secondaryLabel } : {}),
      });
    }

    /*
     * A named association says everything the bare one does and more, so
     * "Ministry" beside "Ministry › Music Ministry" on the same row is dropped.
     */
    return out.filter(
      (a) =>
        a.label !== undefined || !out.some((other) => other.section === a.section && other.label),
    );
  }

  function project(
    document: RegisteredDocument,
    persisted: Map<string, { label: string; secondaryLabel?: string }>,
  ): ResourceSearchResult {
    return {
      id: document.id,
      title: document.title,
      associations: associationsOf(document, persisted),
      tags: document.tags,
      kind: document.kind,
      provider: originLabel[document.origin],
      external: opensElsewhere(document),
      addedById: document.registeredById,
      updatedAt: document.updatedAt,
      ...(document.description ? { description: document.description } : {}),
      ...(document.url ? { openUrl: document.url } : {}),
      ...(document.openRoute ? { openRoute: document.openRoute } : {}),
      ...(driveIdOf(document) ? { driveFileId: driveIdOf(document) } : {}),
    } as ResourceSearchResult;
  }

  /**
   * What a query is allowed to match.
   *
   * **Metadata only** — Invariant 6. Title, description, kind, tags and the
   * places the resource takes part in. Nothing here opens, downloads, crawls or
   * indexes the resource itself, and no amount of searching will ever reach a
   * word that is inside it.
   *
   * Context is matched too, because "music ministry planning" is how a leader
   * asks for the thing when the exact title has gone. That is why this runs
   * here rather than in SQL: the context does not exist until the associated
   * records have been read.
   */
  function matches(resource: ResourceSearchResult, q: string): boolean {
    const bare = q.replace(/^#/, "");
    return (
      resource.title.toLowerCase().includes(q) ||
      (resource.description ?? "").toLowerCase().includes(q) ||
      resource.tags.some((tag) => tag.includes(bare)) ||
      (resource.kind ?? "").toLowerCase().includes(q) ||
      resource.associations.some(
        (a) =>
          sectionLabel[a.section].toLowerCase().includes(q) ||
          (a.label ?? "").toLowerCase().includes(q) ||
          (a.secondaryLabel ?? "").toLowerCase().includes(q),
      )
    );
  }

  /* --------------------------------------------------------------- ranking */

  /**
   * How well a resource answers the query.
   *
   * A title match is what the leader almost always meant; context and tags are
   * how they narrow it when the title escapes them. Deliberately simple — this
   * ranks metadata, and claiming more precision than metadata supports would
   * be dishonest.
   */
  function relevance(resource: ResourceSearchResult, q: string): number {
    const title = resource.title.toLowerCase();
    const bare = q.replace(/^#/, "");
    if (title === q) return 100;
    if (title.startsWith(q)) return 80;
    if (title.includes(q)) return 60;
    if (resource.tags.some((tag) => tag.includes(bare))) return 40;
    if ((resource.description ?? "").toLowerCase().includes(q)) return 30;
    return 10;
  }

  /**
   * The half of Boundary 1 that cannot be SQL yet.
   *
   * A document takes part in several places; it is discoverable when at least
   * one of them is. A resource reachable only through a report this viewer
   * cannot discover stays invisible — its title, its tags, and its
   * contribution to every count.
   */
  function discoverableThroughItsPlaces(viewer: Viewer, document: RegisteredDocument): boolean {
    const gated = document.associations.filter((a) =>
      ["leadership-report", "work", "event", "form"].includes(a.entityType),
    );
    if (gated.length === 0) return true;

    /* Ungated places count as reachable: a document filed in a ministry is
       discoverable there whatever a report says about it. */
    if (gated.length < document.associations.length) return true;

    return gated.some((association) => {
      if (association.entityType === "leadership-report") {
        const report = context_.reports.find(association.entityId);
        return report ? canDiscover(report, viewer.persona, viewer.person) : true;
      }
      if (association.entityType === "work") {
        const work = context_.work.find(association.entityId);
        return work
          ? resolveAccess(viewer.persona, viewer.person, work.policy).level !== "denied"
          : true;
      }
      if (association.entityType === "event") {
        /* Events are not stored, so there is no policy to read and nothing to
           gate on. Attaching a document to one does not hide it. */
        return true;
      }
      const definition = context_.forms.findDefinition(association.entityId);
      return definition?.policy
        ? resolveAccess(viewer.persona, viewer.person, definition.policy).level !== "denied"
        : true;
    });
  }

  /** The ministry a document belongs to, if it belongs to one. */
  function ministryOf(document: RegisteredDocument) {
    const association = document.associations.find((a) => a.entityType === "ministry");
    return association ? context_.organization.findMinistry(association.entityId) : undefined;
  }

  /**
   * Who may change a document.
   *
   * A ministry's material is written by the people who work in that ministry.
   * Being shared with a ministry is **not** membership, and a document filed
   * nowhere is its registrant's to change.
   */
  function mayWrite(viewer: Viewer, document: RegisteredDocument): boolean {
    /* Stated in the domain so the document page offers exactly this. */
    return mayChangeDocument(document, ministryOf(document), viewer.person.id);
  }

  /**
   * Whether this viewer may know about one of a document's places.
   *
   * A document is discoverable through any one of its places; that does not
   * make every other place it is filed in discoverable. A private note's
   * title must not appear on a document page because the document is also
   * filed in a ministry.
   */
  function placeVisible(viewer: Viewer, association: DocumentAssociation): boolean {
    if (association.entityId === "") return true;
    switch (association.entityType) {
      case "meeting-note":
        return repo.noteReadable(association.entityId, viewer.person.id);
      case "leadership-report": {
        const report = context_.reports.find(association.entityId);
        return !!report && canDiscover(report, viewer.persona, viewer.person);
      }
      case "work": {
        const work = context_.work.find(association.entityId);
        return (
          !!work && resolveAccess(viewer.persona, viewer.person, work.policy).level !== "denied"
        );
      }
      case "form": {
        const definition = context_.forms.findDefinition(association.entityId);
        if (!definition) return false;
        return definition.policy
          ? resolveAccess(viewer.persona, viewer.person, definition.policy).level !== "denied"
          : true;
      }
      default:
        return true;
    }
  }

  function requireWrite(viewer: Viewer, document: RegisteredDocument): void {
    if (!mayWrite(viewer, document)) {
      throw ApiError.forbidden(text("refusal.ministry.write"));
    }
  }

  /**
   * What a new document starts as.
   *
   * A checklist starts as a checklist because that is what was asked for; the
   * rest start as one empty line, so the leader is writing rather than
   * completing a template somebody else designed.
   */
  function startingBlocks(kind: string): MeetingBlock[] {
    return kind === "Checklist" ? [emptyBlock("checklist")] : [emptyBlock("paragraph")];
  }

  function permitted(viewer: Viewer, query: ReturnType<typeof parseQuery>) {
    const persisted = context();
    let out = repo
      .all({
        readableBy: viewer.person.id,
        ...(query.tag ? { tag: query.tag } : {}),
        ...(query.addedById ? { registeredById: query.addedById } : {}),
        ...(query.since ? { since: query.since } : {}),
      })
      .filter((document) => discoverableThroughItsPlaces(viewer, document))
      .map((document) => project(document, persisted));

    /*
     * Section and related-record are navigation, not privacy — the privacy
     * filter already ran in SQL. They match on resolved context, which only
     * exists once the records have been read.
     */
    if (query.section) {
      out = out.filter((r) => r.associations.some((a) => a.section === query.section));
    }
    if (query.relatedLabel) {
      out = out.filter((r) => r.associations.some((a) => a.label === query.relatedLabel));
    }

    const q = (query.search ?? "").toLowerCase();
    if (q) out = out.filter((r) => matches(r, q));
    return out;
  }

  const parseQuery = (input: unknown) => parse(resourceQuery, input);

  return {
    /**
     * Search the registry.
     *
     * Metadata only. Ordering falls back to recency when there is no query,
     * because "what have we been working on" is the other question this page
     * is asked.
     */
    search(viewer: Viewer, input: unknown): { resources: ResourceSearchResult[]; page: PageMeta } {
      const query = parseQuery(input);
      const q = (query.search ?? "").toLowerCase();
      const sort = query.sort ?? (q ? "relevance" : "updated");

      const ranked = [...permitted(viewer, query)].sort((a, b) => {
        if (sort === "relevance" && q) {
          const diff = relevance(b, q) - relevance(a, q);
          if (diff !== 0) return diff;
        }
        if (sort === "title") return a.title.localeCompare(b.title);
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      });

      const { limit, offset, meta } = windowFor(
        { page: query.page ?? 1, pageSize: query.pageSize ?? PAGE_SIZE },
        ranked.length,
      );
      return { resources: ranked.slice(offset, offset + limit), page: meta };
    },

    /**
     * Filter options, derived from what this viewer may already discover.
     *
     * Counting across everything would disclose the existence of resources the
     * viewer cannot see — `#leadership-assessment (4)` when all four are
     * withheld is a leak, not a convenience. The section and tag filters are
     * left out of the query so that choosing one does not remove the rest of
     * the choices.
     */
    filterOptions(viewer: Viewer, input: unknown) {
      const query = parseQuery(input);
      const visible = permitted(viewer, { ...query, section: undefined, tag: undefined });

      const sections = new Map<BinderSection, number>();
      const related = new Map<string, { section: BinderSection; label: string; count: number }>();
      const tags = new Map<string, number>();
      const people = new Map<string, number>();

      /*
       * Counts are of *resources*, not associations. A resource taking part
       * twice in one section is still one thing to find, and a count that says
       * otherwise misleads before it ever reveals anything.
       */
      for (const resource of visible) {
        for (const section of new Set(resource.associations.map((a) => a.section))) {
          sections.set(section, (sections.get(section) ?? 0) + 1);
        }
        for (const association of resource.associations) {
          if (!association.label) continue;
          const key = `${association.section}:${association.label}`;
          const entry = related.get(key);
          if (entry) entry.count += 1;
          else
            related.set(key, { section: association.section, label: association.label, count: 1 });
        }
        for (const tag of resource.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
        if (resource.addedById)
          people.set(resource.addedById, (people.get(resource.addedById) ?? 0) + 1);
      }

      return {
        sections: [...sections.entries()]
          .map(([section, count]) => ({ section, count }))
          .sort((a, b) => sectionLabel[a.section].localeCompare(sectionLabel[b.section])),
        related: [...related.values()].sort((a, b) => a.label.localeCompare(b.label)),
        tags: [...tags.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
        people: [...people.entries()]
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count),
      };
    },

    /**
     * The documents filed against one record.
     *
     * The same registry the search page reads — §5: a module's document list
     * and consolidated search are two views over the same records, never two
     * places to file the same thing.
     */
    /**
     * What is filed against one record.
     *
     * **The anchor is checked first.** Asking "what is attached to this
     * report?" is a question about the report, and a viewer who cannot
     * discover the report may not ask it — otherwise a report id, which
     * travels in a pasted URL, would reveal which documents hang off a
     * confidential record. It answers as if nothing were there, because
     * "nothing" and "not for you" must look the same.
     *
     * Documents themselves are still gated afterwards, as everywhere else.
     */
    filedAgainst(
      viewer: Viewer,
      entityType: DocumentEntityType,
      entityId: string,
    ): ResourceSearchResult[] {
      if (entityType === "leadership-report") {
        const report = context_.reports.find(entityId);
        if (report && !canDiscover(report, viewer.persona, viewer.person)) return [];
      }
      if (entityType === "work") {
        const work = context_.work.find(entityId);
        if (work && resolveAccess(viewer.persona, viewer.person, work.policy).level === "denied") {
          return [];
        }
      }

      const persisted = context();
      return repo
        .all({ readableBy: viewer.person.id, entityType, entityId })
        .filter((document) => discoverableThroughItsPlaces(viewer, document))
        .map((document) => project(document, persisted));
    },

    /** One record, withheld exactly as the list withholds it. */
    get(viewer: Viewer, id: string): RegisteredDocument {
      const document = repo.find(id, viewer.person.id);
      /* Withholding is a 404. A deep link must not reveal what search would
         not, and "you may not see this" still says that it exists. */
      if (!document || !discoverableThroughItsPlaces(viewer, document)) {
        throw ApiError.notFound("That document");
      }
      return document;
    },

    /**
     * Register a resource.
     *
     * The origin is read off the address and nothing more is claimed: a pasted
     * address is recorded as the leader gave it, and never pretends to have been
     * checked. Choosing a file through Drive is `drive-service.ts`, which asks
     * Drive first.
     */
    register(viewer: Viewer, input: unknown): RegisteredDocument {
      const parsed = parse(registerDocument, input);
      const document = repo.insert({
        title: parsed.title,
        kind: parsed.kind ?? "Document",
        origin: originForUrl(parsed.url),
        url: parsed.url,
        tags: parsed.tags ?? [],
        registeredById: viewer.person.id,
        ...(parsed.description ? { description: parsed.description } : {}),
      });

      for (const association of parsed.associations ?? []) {
        repo.associate({
          documentId: document.id,
          entityType: association.entityType as DocumentEntityType,
          entityId: association.entityId ?? "",
          relationship: association.relationship ?? "filed-in",
          createdById: viewer.person.id,
        });
      }
      return repo.findUnguarded(document.id)!;
    },

    /**
     * Change what the binder records about a resource.
     *
     * Metadata only. The resource itself belongs to whoever stores it, and
     * editing a title here has never changed a word of a Google document.
     */
    update(viewer: Viewer, id: string, input: unknown): RegisteredDocument {
      const current = this.get(viewer, id);
      requireWrite(viewer, current);
      const patch = parse(updateDocument, input);

      /*
       * A new address is a document that lives somewhere else. Where it lives
       * is read off the address again, and a Drive file recorded for the old
       * one is forgotten. A binder-native document has no address to change:
       * the binder is where it lives.
       */
      const moving = patch.url !== undefined && patch.url !== current.url;
      if (moving && current.origin === "binder") {
        throw ApiError.validation({
          url: "This document is kept in the binder, not at an address.",
        });
      }
      const saved = repo.update(
        id,
        patch,
        ...(moving && patch.url ? [{ origin: originForUrl(patch.url) }] : []),
      );
      if (!saved) throw ApiError.notFound("That document");
      return saved;
    },

    /**
     * One registered document as its own page shows it.
     *
     * Its places are named only where this viewer may know about them, and
     * each says whether this viewer may unfile it — so the page offers what
     * the server allows and nothing else.
     */
    record(viewer: Viewer, id: string): DocumentRecord {
      const document = this.get(viewer, id);
      const persisted = context();
      const mayEdit = mayWrite(viewer, document);
      const places: DocumentPlace[] = document.associations
        .filter((association) => placeVisible(viewer, association))
        .map((association) => {
          const resolved = labelFor(association.entityType, association.entityId, persisted);
          return {
            id: association.id,
            entityType: association.entityType,
            entityId: association.entityId,
            relationship: association.relationship,
            section: sectionForEntity[association.entityType],
            ...(resolved.label ? { label: resolved.label } : {}),
            ...(resolved.secondaryLabel ? { secondaryLabel: resolved.secondaryLabel } : {}),
            mayUnfile: mayUnfile(document, association, mayEdit),
          };
        });
      const driveFileId = driveIdOf(document);
      return { document, places, mayEdit, ...(driveFileId ? { driveFileId } : {}) };
    },

    /**
     * File a document somewhere else as well.
     *
     * §3: one resource, many associations. This never copies the record, which
     * is the whole reason associations are rows of their own.
     */
    associate(viewer: Viewer, input: unknown) {
      const parsed = parse(associateDocument, input);
      this.get(viewer, parsed.documentId);

      const association = repo.associate({
        documentId: parsed.documentId,
        entityType: parsed.entityType as DocumentEntityType,
        entityId: parsed.entityId ?? "",
        relationship: parsed.relationship ?? "filed-in",
        createdById: viewer.person.id,
      });
      if (!association)
        throw ApiError.validation({ entityType: text("refusal.document.notABinderRecord") });
      return association;
    },

    /**
     * Unfile it from one place. The resource, and its other places, remain.
     *
     * The same people who may change the record may unfile it — not everyone
     * who can find it. A place this viewer may not know about answers as if
     * the filing were not there.
     */
    removeAssociation(viewer: Viewer, id: string): void {
      const association = repo.findAssociation(id);
      if (!association) throw ApiError.notFound("That filing");
      const document = this.get(viewer, association.documentId);
      if (!placeVisible(viewer, association)) throw ApiError.notFound("That filing");
      requireWrite(viewer, document);
      if (!mayUnfile(document, association, true)) {
        throw ApiError.validation({
          id: "A document written in the binder lives in its ministry and cannot be unfiled from it.",
        });
      }
      repo.removeAssociation(id);
    },

    /* ------------------------------------------- binder-native documents */

    /**
     * Start a document the binder itself keeps.
     *
     * A Plan, a Report, an Announcement, a Checklist, an Update. Unlike
     * registering, this creates the resource as well as the record of it: two
     * rows, in two tables, because the registry is not storage.
     *
     * **Prepared by is not Belongs to.** The person is recorded as whoever
     * started it; the ministry owns it, and goes on owning it after they stop
     * leading.
     */
    createBinder(viewer: Viewer, input: unknown): RegisteredDocument {
      const parsed = parse(createBinderDocument, input);
      const ministry = context_.organization.findMinistry(parsed.ministryId);
      if (!ministry) throw ApiError.validation({ ministryId: text("refusal.ministry.unknown") });

      const relationship = relationshipTo(ministry, viewer.person.id);
      if (!canContribute(relationship)) {
        /* Being shared with a ministry is not membership, and a leader who can
           see its shelf is not thereby someone who writes on it. */
        throw ApiError.forbidden(text("refusal.ministry.write"));
      }

      /* The id is minted first because the document opens at its own address:
         `openRoute` is part of the record, not something derived later. */
      const id = newId("doc");
      const document = repo.insert(
        {
          title: parsed.title ?? "",
          kind: parsed.kind,
          origin: "binder",
          /* Opens in the binder, not anywhere else. */
          openRoute: `/documents/${id}`,
          registeredById: viewer.person.id,
          tags: [],
        },
        id,
      );
      repo.associate({
        documentId: document.id,
        entityType: "ministry",
        entityId: ministry.id,
        relationship: "filed-in",
        createdById: viewer.person.id,
      });

      content.create(document.id, startingBlocks(parsed.kind), viewer.person.id);
      return repo.findUnguarded(document.id)!;
    },

    /**
     * A binder-native document, with what it says.
     *
     * `mayWrite` comes back with it so the page does not have to work out the
     * ministry relationship for itself, and so that two places cannot disagree
     * about who may type.
     */
    binder(
      viewer: Viewer,
      id: string,
    ): { document: RegisteredDocument; content: BinderContent; mayWrite: boolean } {
      const document = this.get(viewer, id);
      const body = content.find(id);
      if (!body) throw ApiError.notFound("That document");
      return { document, content: body, mayWrite: mayWrite(viewer, document) };
    },

    /**
     * Save what it says.
     *
     * Two leaders writing one plan is ordinary in a ministry, so the version
     * the editor was working from is stated and a save against a version
     * somebody else has moved past is refused rather than applied.
     */
    saveBinder(viewer: Viewer, input: unknown): BinderContent {
      const parsed = parse(saveContent, input);
      const document = this.get(viewer, parsed.documentId);
      requireWrite(viewer, document);

      const current = content.find(parsed.documentId);
      if (!current) throw ApiError.notFound("That document");

      const saved = content.save(
        parsed.documentId,
        parsed.blocks as MeetingBlock[],
        viewer.person.id,
        parsed.expectedVersion ?? current.version,
      );
      if (saved === "stale") {
        throw ApiError.conflict(text("refusal.document.staleVersion"));
      }
      if (!saved) throw ApiError.notFound("That document");
      return saved;
    },

    /**
     * Remove a registry record.
     *
     * Only whoever registered it. Removing the record does not remove the
     * resource — the binder forgets it, and the document goes on existing
     * wherever it actually lives.
     */
    remove(viewer: Viewer, id: string): void {
      const document = this.get(viewer, id);

      /*
       * Whoever registered it, or whoever leads the ministry it belongs to.
       * The ministry owns its material — that is the point of "belongs to" —
       * so a plan does not become unremovable because the leader who started
       * it has moved on.
       */
      const ministry = ministryOf(document);
      const leads = !!ministry && canManage(relationshipTo(ministry, viewer.person.id));

      if (document.registeredById !== viewer.person.id && !leads) {
        throw ApiError.forbidden(
          ministry ? text("refusal.document.removeMinistry") : text("refusal.document.removeOwner"),
        );
      }
      repo.delete(id);
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
