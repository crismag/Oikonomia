import type { Database as Db } from "better-sqlite3";

import { createDocumentRepository } from "@/server/repositories/document-repository";
import { documentTypeLabel } from "@/domain/documents";
import { originForUrl } from "@/domain/registry";
import { formDefinitions } from "@/test/form-fixtures";
import {
  artifacts,
  binderDocuments,
  events,
  leadershipReports,
  workContexts,
} from "@/test/fixtures";
import type { DocumentEntityType, DocumentRelationship } from "@/domain/registry";
import type { AssociationValues, DocumentValues } from "@/server/repositories/document-repository";

/**
 * Development seed for the document registry.
 *
 * This is where Gap 1 of `DOCUMENT-REGISTRY.md` closes. The prototype carried
 * **three** models of the same idea — `BinderDocument` for Ministry, Reach-Out
 * and Leadership Reports, `WorkingArtifact` for events and work contexts, and
 * form definitions standing on their own — so `/documents` could not show a
 * ministry document and search had to project over all three. All three are
 * registered here as registry records, keeping their existing ids so that the
 * pages still reading fixtures agree with the ones reading the database.
 *
 * Associations come from wherever the reference actually was: a document's
 * `owner`, a report's `primaryDocumentId` and `relatedDocumentIds`, a work
 * context's or event's `artifactIds`. That scattering is Gap 2; this is the
 * one place that reads it, and it reads it once.
 *
 * Written into an **empty** registry only.
 */
export function seedDocuments(db: Db): boolean {
  const repo = createDocumentRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    const file = (values: DocumentValues, id: string, associations: AssociationValues[]) => {
      repo.insert(values, id);
      for (const association of associations) repo.associate(association);
    };

    const relate = (
      documentId: string,
      entityType: DocumentEntityType,
      entityId: string,
      createdById: string,
      relationship: DocumentRelationship = "filed-in",
    ): AssociationValues => ({ documentId, entityType, entityId, relationship, createdById });

    /* ------------------------------------------------ binder documents */

    for (const document of binderDocuments) {
      const associations: AssociationValues[] = [];
      const owner = document.owner;

      if (owner.kind === "ministry")
        associations.push(relate(document.id, "ministry", owner.ministryId, document.preparedById));
      if (owner.kind === "lifegroup")
        associations.push(
          relate(document.id, "gathering", owner.gatheringId, document.preparedById),
        );
      /*
       * Reach-Out's working material belongs to Reach-Out as an area, not to
       * any one report — an empty entity id is how the registry says that.
       */
      if (owner.kind === "reach-out")
        associations.push(relate(document.id, "reach-out-report", "", document.preparedById));

      /*
       * Gap 3: the relationship used to be implied by which field an id sat
       * in. Here it is recorded, so search can say "Supporting" rather than
       * leaving the interface to infer it from a field name.
       */
      for (const report of leadershipReports) {
        if (report.primaryDocumentId === document.id) {
          associations.push(
            relate(
              document.id,
              "leadership-report",
              report.id,
              document.preparedById,
              "report-content",
            ),
          );
        } else if (report.relatedDocumentIds.includes(document.id)) {
          associations.push(
            relate(
              document.id,
              "leadership-report",
              report.id,
              document.preparedById,
              "supporting",
            ),
          );
        }
      }
      if (owner.kind === "leadership-report" && associations.length === 0) {
        associations.push(relate(document.id, "leadership-report", "", document.preparedById));
      }

      /* A resource carries the tags of the records it takes part in. */
      const tags = new Set<string>();
      for (const report of leadershipReports) {
        if (
          report.primaryDocumentId === document.id ||
          report.relatedDocumentIds.includes(document.id)
        )
          for (const tag of report.tags) tags.add(tag);
      }

      file(
        {
          title: document.title,
          kind: documentTypeLabel[document.type],
          /*
           * Read off the address rather than taken from the record. The older
           * model let a document claim `drive` while carrying a link to
           * somewhere else, and a row that says "Google Drive" beside a link
           * that is not one is a false statement about where the resource is.
           */
          origin: document.url ? originForUrl(document.url) : document.origin,
          registeredById: document.preparedById,
          tags: [...tags],
          ...(document.description ? { description: document.description } : {}),
          ...(document.url ? { url: document.url } : {}),
          ...(document.fileName ? { fileName: document.fileName } : {}),
        },
        document.id,
        associations,
      );
    }

    /* ----------------------------------------------- working artifacts */

    /*
     * `WorkingArtifact` keyed identity on the provider, which is Invariant 8
     * inverted: it cannot express a server-stored file or a plain link at all.
     * Registered here on the same footing as everything else, which is what
     * stops the provider being the organizing idea.
     */
    for (const artifact of artifacts) {
      const associations: AssociationValues[] = [];

      for (const work of workContexts) {
        if (work.artifactIds.includes(artifact.id)) {
          associations.push(relate(artifact.id, "work", work.id, artifact.updatedBy));
        }
      }
      for (const event of events) {
        if (event.artifactIds.includes(artifact.id)) {
          associations.push(relate(artifact.id, "event", event.id, artifact.updatedBy));
        }
      }

      file(
        {
          title: artifact.title,
          kind: artifact.provider === "google-sheets" ? "Spreadsheet" : "Document",
          origin: originForUrl(artifact.url),
          url: artifact.url,
          registeredById: artifact.updatedBy,
          tags: [],
          ...(artifact.sections.length > 0
            ? { description: `Sections: ${artifact.sections.join(", ")}.` }
            : {}),
        },
        artifact.id,
        associations,
      );
    }

    /* ----------------------------------------------------------- forms */

    /*
     * A form is a binder-native resource: it opens here rather than anywhere
     * else, which is what `openRoute` says. The definition itself still belongs
     * to Forms — the registry holds the metadata, never the form.
     */
    for (const definition of formDefinitions) {
      file(
        {
          title: definition.title,
          kind: "Form",
          origin: "binder",
          openRoute: `/forms/${definition.id}`,
          registeredById: definition.ownerId,
          tags: [],
          ...(definition.description ? { description: definition.description } : {}),
        },
        definition.id,
        [relate(definition.id, "form", definition.id, definition.ownerId)],
      );
    }
  });

  seed();
  return true;
}
