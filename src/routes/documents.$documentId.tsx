import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/config/messages/handlers";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { MeetingDocument, MeetingToolbar } from "@/components/oikonomia/meeting-editor";
import { Page } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { useBinderDocument } from "@/components/oikonomia/binder-document-provider";
import { CalendarError, errorMessage } from "@/lib/calendar-client";
import { removeDocument } from "@/lib/documents-api";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { fromISO } from "@/domain/schedule";
import { format } from "date-fns";

export const Route = createFileRoute("/documents/$documentId")({
  head: () => ({ meta: [{ title: "Document — Oikonomia" }] }),
  component: BinderDocumentPage,
});

/**
 * A document the binder itself keeps.
 *
 * A ministry's Plan, Report, Announcement, Checklist or Update — written here
 * rather than kept somewhere else and linked to. The writing surface is the one
 * Meeting Notes uses, because it is the same act: structure in the block list,
 * inline marks inside a line, and no template to complete.
 *
 * Who may write is the ministry's own question — its lead and the people on its
 * team. Being shared with a ministry is not membership, so a leader who can
 * read this may not have a cursor in it, and is told so plainly rather than
 * shown controls that refuse.
 */
function BinderDocumentPage() {
  const { ministries } = useOrganization();
  const { documentId } = Route.useParams();
  const store = useBinderDocument(documentId);
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (store.status === "loading") {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (store.status === "error" || !store.document) {
    /*
     * Two different situations, and telling them apart matters.
     *
     * A **registered** document is a reference: the binder records what it is
     * and where it lives, and the document itself stays where it is. There is
     * nothing here to open, and there never will be. Saying "a problem
     * reaching the binder" about one invites somebody to press Try again
     * forever over a page that is working correctly.
     */
    const missing = store.error instanceof CalendarError && store.error.code === "not-found";

    return (
      <Page>
        {missing ? (
          <ErrorState title="There is nothing here to open">
            This may be a registered document — the binder records what it is and where it lives,
            and the document itself stays where it is. Open it from Documents &amp; Forms, which
            links to wherever it is kept.
          </ErrorState>
        ) : (
          <ErrorState title="This document could not be opened" onRetry={store.retry}>
            Nothing is lost. This is a problem reaching the binder.
          </ErrorState>
        )}
      </Page>
    );
  }

  const document = store.document;
  const ministryId = document.associations.find((a) => a.entityType === "ministry")?.entityId;
  const ministry = ministries.find((m) => m.id === ministryId);
  const conflict = store.saveError instanceof CalendarError && store.saveError.code === "conflict";

  const active = store.blocks.find((b) => b.id === focusedId)?.type;
  const title = renaming ?? document.title;

  const remove = async () => {
    const named = title.trim();
    if (
      !(await confirm(
        named ? "documents.delete.confirm" : "documents.delete.confirm.untitled",
        named ? { title: named } : undefined,
      ))
    ) {
      return;
    }
    await removeDocument({ data: { id: document.id } });
    void navigate(
      ministry
        ? { to: "/ministries/$ministryId", params: { ministryId: ministry.id }, search: {} }
        : { to: "/documents" },
    );
  };

  return (
    <Page>
      {ministry ? (
        <Link
          to="/ministries/$ministryId"
          params={{ ministryId: ministry.id }}
          search={{ view: "documents" as const }}
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {ministry.name}
        </Link>
      ) : (
        <Link
          to="/documents"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Documents &amp; Forms
        </Link>
      )}

      <header className="mb-3">
        {store.mayWrite ? (
          <input
            value={title}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => {
              if (renaming !== null && renaming !== document.title) void store.rename(renaming);
              setRenaming(null);
            }}
            placeholder={`Untitled ${document.kind.toLowerCase()}`}
            aria-label="Document title"
            className="w-full bg-transparent font-display text-[26px] leading-tight outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <h1 className="font-display text-[26px] leading-tight">
            {document.title || `Untitled ${document.kind.toLowerCase()}`}
          </h1>
        )}

        {/* Prepared by is not Belongs to: the ministry owns it, the person
            started it, and the line says both without confusing them. */}
        <p className="mt-1 text-[13px] text-muted-foreground">
          {document.kind}
          {ministry ? ` · ${ministry.name}` : ""} · started by{" "}
          <PersonName personId={document.registeredById} /> ·{" "}
          {format(fromISO(document.updatedAt.slice(0, 10)), "d MMM")}
        </p>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-status-overdue/40 bg-status-overdue/5 px-4 py-3 text-[13px] leading-relaxed"
        >
          <p className="font-medium">
            Someone else in this ministry changed this while you were writing.
          </p>
          <p className="mt-1 text-muted-foreground">
            What you have typed is still here and has not been saved. Open their version to see what
            they wrote — you will need to add your part to it again.
          </p>
          <button
            type="button"
            onClick={store.discardDraft}
            className="mt-2 font-medium underline underline-offset-2"
          >
            Open their version
          </button>
        </div>
      ) : null}

      {store.mayWrite ? (
        <MeetingToolbar
          activeType={active}
          canMakeTask={false}
          /* A ministry document does not produce tracked tasks. A control that
             will never become available is not shown disabled — it is not
             shown. */
          showTasks={false}
          showMeetingMarks={false}
          onCommand={(command) => {
            if (command.kind === "set-type" && focusedId) {
              store.setBlockType(focusedId, command.type);
            }
            if (command.kind === "delete" && focusedId) store.removeBlock(focusedId);
          }}
        />
      ) : (
        /* True whether the reader is shared with the ministry or simply not
           in it — the page does not guess which. */
        <p className="mb-2 text-[12px] text-muted-foreground">
          Writing here is for the people who work in this ministry.
        </p>
      )}

      <div className="rounded-2xl border border-border bg-surface shadow-card px-5 py-4">
        <MeetingDocument
          blocks={store.blocks}
          readOnly={!store.mayWrite}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onChange={store.setBlockHtml}
          onEnter={(id) => setFocusedId(store.insertAfter(id))}
          onRemove={(id) => {
            const index = store.blocks.findIndex((b) => b.id === id);
            store.removeBlock(id);
            setFocusedId(store.blocks[index - 1]?.id ?? null);
          }}
          onToggleCheck={store.toggleCheck}
          onCycleFollowUp={() => {}}
        />
      </div>

      {store.mayWrite ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void remove()}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete document
          </button>

          <div className="flex items-center gap-3">
            <SaveState state={store.saveState} conflict={conflict} error={store.saveError} />
            <Button type="button" variant="secondary" onClick={() => void store.flush()}>
              Save now
            </Button>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

/** What the binder has, in words rather than a spinner. */
function SaveState({
  state,
  conflict,
  error,
}: {
  state: "idle" | "saving" | "saved" | "error";
  conflict: boolean;
  error: unknown;
}) {
  if (conflict) return null;
  if (state === "error") {
    return (
      <span role="alert" className="text-[12px] text-status-overdue">
        {errorMessage(error)}
      </span>
    );
  }
  const said = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : null;
  if (!said) return null;
  return (
    <span aria-live="polite" className="text-[12px] text-muted-foreground">
      {said}
    </span>
  );
}
