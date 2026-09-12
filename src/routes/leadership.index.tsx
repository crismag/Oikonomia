import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BookLock, Lock, Plus, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createEntry, type JournalEntry } from "@/lib/journal-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";

import { ClassificationTag } from "@/components/oikonomia/access";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader, RailBlock } from "@/components/oikonomia/page";
import { DetailLayout } from "@/components/oikonomia/page";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { useViewer } from "@/domain/session";

export const Route = createFileRoute("/leadership/")({
  head: () => ({
    meta: [
      { title: "Leadership — Oikonomia" },
      {
        name: "description",
        content: "Personal reflection and development, private by default, shared only on purpose.",
      },
    ],
  }),
  component: LeadershipPage,
});

/**
 * Leadership development is document-oriented, not table-first.
 *
 * The organising idea is the boundary: entries are private by default, and a
 * report derived from them is a separate object with its own audience. Nothing
 * here is visible to a Bishop or Admin merely because of their title.
 */
function LeadershipPage() {
  const { person } = useViewer();

  /*
   * The same records the review shell reads, scoped in the service rather than
   * here — so this page and `/work` can never disagree about where something
   * stands, and so the "closed to you" count is of development records rather
   * than of everything withheld in the binder.
   */
  const store = useWorkList({ scope: "development" });
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const start = async () => {
    setStarting(true);
    setFailure(null);
    try {
      const entry = unwrap(
        (await withTimeout(createEntry({ data: { title: "" } }))) as never,
      ) as JournalEntry;
      void navigate({
        to: "/leadership/$entryId",
        params: { entryId: entry.work.id },
      });
    } catch (error) {
      setFailure(error);
    } finally {
      setStarting(false);
    }
  };
  const readable = store.work.map((work) => ({ work }));
  const closed = store.withheld;

  const mine = readable.filter(({ work }) => work.ownerId === person.id);
  const shared = readable.filter(({ work }) => work.ownerId !== person.id);

  if (store.status === "loading") {
    return (
      <Page>
        <ListSkeleton rows={4} />
      </Page>
    );
  }
  if (store.status === "error") {
    return (
      <Page>
        <ErrorState title="Your development records could not be loaded" onRetry={store.retry}>
          Nothing is lost. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Leadership"
        description="Reflection, goals and development. Private by default; sharing is an explicit act, and a derived report never opens the rest."
        actions={
          <Button type="button" variant="primary" onClick={() => void start()} disabled={starting}>
            <Plus className="size-3.5" aria-hidden />
            New entry
          </Button>
        }
      />

      {failure ? (
        <p role="alert" className="mb-3 text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      <DetailLayout
        rail={
          <>
            <RailBlock label="How sharing works">
              <ol className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                <li>1. Write privately. Nobody else can read an entry, whatever their role.</li>
                <li>2. Tick the lines that belong in an accountability summary.</li>
                <li>
                  3. Those lines are copied into a leadership report with its own audience and
                  review lifecycle.
                </li>
                <li>
                  4. Everything you left unticked stays here. A summary is not a way into the rest.
                </li>
              </ol>
            </RailBlock>

            {closed > 0 ? (
              <RailBlock label="Closed to you">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {closed} development {closed === 1 ? "record is" : "records are"} held by other
                  leaders. Seniority does not open them.
                </p>
              </RailBlock>
            ) : null}
          </>
        }
      >
        <Section
          title="My development"
          meta={mine.length > 0 ? `${mine.length}` : undefined}
          action={
            mine.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Share2 className="size-3.5" aria-hidden />
                Shared on purpose only
              </span>
            ) : null
          }
        >
          {mine.length > 0 ? (
            <ul className="divide-y divide-border">
              {mine.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  {/* A journal entry opens where it is written. The review
                      shell is for records that were sent to somebody, which a
                      private entry has not been. */}
                  <Link
                    {...(work.kind === "development-record"
                      ? { to: "/leadership/$entryId" as const, params: { entryId: work.id } }
                      : { to: "/work/$workId" as const, params: { workId: work.id } })}
                    className="block px-4 py-3.5"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 text-[15px]">{work.subject}</span>
                      <StatusBadge status={work.status} />
                    </span>
                    <span className="mt-1.5 block text-[13px] leading-relaxed text-muted-foreground">
                      {work.currentState}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ClassificationTag classification={work.policy.classification} />
                      {work.policy.restrictedSections?.length ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                          <Lock className="size-3" aria-hidden />
                          {work.policy.restrictedSections.length} section held tighter
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={BookLock}
              title="Nothing recorded yet"
              action={
                <Button type="button" variant="primary" onClick={() => void start()}>
                  <Plus className="size-3.5" aria-hidden />
                  New entry
                </Button>
              }
            >
              Reflection you write here stays private until you deliberately share it.
            </EmptyState>
          )}
        </Section>

        {shared.length > 0 ? (
          <Section title="Shared with you" meta={`${shared.length}`}>
            <ul className="divide-y divide-border">
              {shared.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  <Link to="/work/$workId" params={{ workId: work.id }} className="block px-4 py-3">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 text-[14px]">{work.subject}</span>
                      <StatusBadge status={work.status} />
                    </span>
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {work.currentState}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </DetailLayout>
    </Page>
  );
}
