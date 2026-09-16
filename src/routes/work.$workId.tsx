import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronLeft, HelpCircle, MessageSquare } from "lucide-react";

import {
  AccessNotice,
  ClassificationTag,
  MetadataPanel,
  RedactedSection,
} from "@/components/oikonomia/access";
import { ActivityTimeline } from "@/components/oikonomia/activity";
import { DecisionCard, DiscussionThread } from "@/components/oikonomia/discussion";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { KindLabel, StatusBadge, kindLabel } from "@/components/oikonomia/status";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { useWork } from "@/components/oikonomia/work-provider";
import { useFiledDocuments } from "@/components/oikonomia/filed-documents";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { AskedOfYou } from "@/components/oikonomia/put-on-week";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/calendar-client";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useViewer } from "@/domain/session";
import { documentHref, openableUrl } from "@/domain/document-record";
import type { WorkStatus } from "@/domain/types";

export const Route = createFileRoute("/work/$workId")({
  /* The document title is deliberately generic. Access depends on the viewing
     persona, which head() cannot resolve, and a tab title is a leak surface
     like any other — so it never carries the subject. */
  head: () => ({ meta: [{ title: "Work — Oikonomia" }] }),
  component: WorkPage,
});

/**
 * The universal work/review context.
 *
 * Borrows the useful grammar of a pull request — context, working material,
 * participants, conversation, decisions, state, history — without the
 * engineering machinery. Current state and decisions sit *above* the thread so
 * a long conversation never has to be reread to learn where things stand.
 */
function WorkPage() {
  const { campuses, ministries, personById } = useOrganization();
  const { workId } = Route.useParams();
  const { person } = useViewer();
  const store = useWork(workId);
  const filed = useFiledDocuments("work", workId);

  if (store.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:py-7">
        <DetailSkeleton />
      </div>
    );
  }
  /*
   * A record closed to this viewer is not-found, deliberately and
   * indistinguishably from one that does not exist — so an unreachable server
   * and a withheld record must not look the same either.
   */
  if (store.status === "error" || !store.view) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:py-7">
        <ErrorState title="This could not be opened" onRetry={store.retry}>
          Nothing is lost. This is a problem reaching it.
        </ErrorState>
      </div>
    );
  }

  const view = store.view;

  /*
   * Metadata-only is not a refusal: it shows the routing information policy
   * permits and nothing else — and the content genuinely is not here, rather
   * than being here and unrendered.
   */
  if (view.level === "metadata") {
    return (
      <MetadataPanel
        decision={view.decision}
        kind={kindLabel[view.metadata.kind]}
        contextLabel={view.metadata.contextLabel}
        classification={view.metadata.classification}
        ownerName={personById(view.metadata.ownerId).name}
        lastActivity={view.metadata.lastActivity}
      />
    );
  }

  const work = view.work;
  const access = view.decision;

  /* The working material is whatever has been **registered** against this
     record. Documents used to be resolved from a fixture list of artifacts,
     which meant a record could display a Google Doc nobody had ever filed. */
  const artifacts = filed.documents;
  const ministry = ministries.find((m) => m.id === work.ministryId);
  const campus = campuses.find((c) => c.id === work.campusId);

  /*
   * The bodies of restricted sections were removed by the service, so what is
   * left to say is that they exist. Their titles come from the access decision,
   * never from the record.
   */
  const present = new Set((work.sections ?? []).map((s) => s.title));
  const redacted = access.restrictedSections.filter((title) => !present.has(title));

  const humanComments = work.comments.filter((c) => !c.system).length;
  const isReviewer = work.reviewerIds.includes(person.id);
  const isOwner = work.ownerId === person.id;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:py-7">
      <Link
        to="/inbox"
        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Inbox
      </Link>

      <header className="mt-3 border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <KindLabel kind={work.kind} />
          <span className="text-border-strong" aria-hidden>
            ·
          </span>
          <span className="text-[12px] text-muted-foreground">{work.contextLabel}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 max-w-2xl text-[22px] leading-snug sm:text-[26px]">
            {work.subject}
          </h1>
          <StatusBadge status={work.status} className="mt-1.5" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <PersonAvatar personId={work.ownerId} size="sm" />
            <PersonName personId={work.ownerId} /> opened this
          </span>
          {humanComments > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5" aria-hidden />
              {humanComments} {humanComments === 1 ? "comment" : "comments"}
            </span>
          ) : null}
          {work.due ? <span>{work.due}</span> : null}
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_248px]">
        <div className="min-w-0 space-y-5">
          {access.level !== "full" ? <AccessNotice decision={access} /> : null}

          {/* Current state: the answer to "where does this stand?" */}
          <div className="rounded-xl border border-border bg-surface-muted px-4 py-3.5">
            <h2 className="text-[13px] font-medium text-muted-foreground">Where this stands</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed">{work.currentState}</p>
          </div>

          <ReviewActions
            status={work.status}
            reviewRequired={work.reviewRequired ?? false}
            isReviewer={isReviewer}
            isOwner={isOwner}
            saving={store.saving}
            failure={store.actionError}
            onAct={store.transition}
          />

          {/*
           * What a leader does with information: say something about it, or
           * decide that something has to be done and ask for it. Neither turns
           * this record into a review, and reading it has never obliged
           * anybody to do either.
           */}
          <AskedOfYou sourceType="work" sourceId={work.id} />
          <EscalationControl
            sourceType="work"
            sourceId={work.id}
            contextLabel={work.contextLabel || work.subject}
          />

          {work.decisions.length > 0 ? (
            <section className="space-y-2.5">
              {work.decisions.map((decision) => (
                <DecisionCard key={decision.id} decision={decision} />
              ))}
            </section>
          ) : null}

          {work.openQuestions.length > 0 ? (
            <section className="rounded-2xl border border-border bg-surface shadow-card p-4">
              <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <HelpCircle className="size-3.5" aria-hidden />
                Unresolved
              </h2>
              <ul className="mt-2 space-y-1.5">
                {work.openQuestions.map((question) => (
                  <li key={question} className="flex gap-2.5 text-[14px] leading-relaxed">
                    <span
                      className="mt-[9px] size-1 shrink-0 rounded-full bg-status-waiting"
                      aria-hidden
                    />
                    {question}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(work.sections && work.sections.length > 0) || redacted.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-[13px] font-medium text-muted-foreground">
                {work.kind === "report" ? "Report" : "Record"}
              </h2>
              {(work.sections ?? []).map((section) => (
                <article
                  key={section.title}
                  className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3.5"
                >
                  <h3 className="text-[14px] font-medium">{section.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">
                    {section.body}
                  </p>
                </article>
              ))}
              {redacted.map((title) => (
                <RedactedSection key={title} title={title} />
              ))}
            </section>
          ) : null}

          {artifacts.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-[13px] font-medium text-muted-foreground">Working material</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                {artifacts.map((resource: (typeof artifacts)[number]) => (
                  <li key={resource.id} className="row-quiet flex items-center gap-3 px-4 py-2.5">
                    <Link {...documentHref(resource.id)} className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] hover:underline">
                        {resource.title}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {[resource.kind, resource.provider].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                    {openableUrl(resource.openUrl) ? (
                      <a
                        href={openableUrl(resource.openUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[13px] font-medium text-primary"
                      >
                        Open
                        <span className="sr-only"> {resource.title}, opens in a new tab</span>
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-muted-foreground">
                Edits belong in the authoritative document. Recording a decision here does not
                change it.
              </p>
            </section>
          ) : null}

          <details className="group rounded-2xl border border-border bg-surface shadow-card lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium">
              Details, people and activity
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="space-y-5 border-t border-border px-4 py-4">
              <RailBlock label="Audience">
                <ClassificationTag classification={work.policy.classification} />
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  {access.rationale}.
                </p>
              </RailBlock>

              {work.reviewerIds.length > 0 ? (
                /* Only a record a process reviews has reviewers. On everything
                   else these are the people it was sent to, who owe it
                   nothing. */
                <RailBlock label={work.reviewRequired ? "Reviewers" : "Sent to"}>
                  <PeopleList ids={work.reviewerIds} />
                </RailBlock>
              ) : null}

              {work.assigneeIds.length > 0 ? (
                <RailBlock label="Assigned">
                  <PeopleList ids={work.assigneeIds} />
                </RailBlock>
              ) : null}

              {work.participantIds.length > 0 ? (
                <RailBlock label="Participants">
                  <PeopleList ids={work.participantIds} />
                </RailBlock>
              ) : null}

              <RailBlock label="Context">
                <ul className="space-y-1 text-[13px]">
                  {ministry ? <li>{ministry.name}</li> : null}
                  {campus ? <li className="text-muted-foreground">{campus.name}</li> : null}
                  {work.period ? <li className="text-muted-foreground">{work.period}</li> : null}
                </ul>
              </RailBlock>

              <RailBlock label="Activity">
                <ActivityTimeline entries={work.activity} />
              </RailBlock>
            </div>
          </details>

          <section>
            <h2 className="text-[13px] font-medium text-muted-foreground">Discussion</h2>
            <div className="mt-2 rounded-2xl border border-border bg-surface shadow-card px-4">
              <DiscussionThread comments={work.comments} />
            </div>
            {/*
             * The service lets anyone who may read the record comment on it,
             * and refuses a metadata-only view. This page only reaches here
             * with a readable view, so the box is offered on the same terms.
             */}
            {view.level === "full" || view.level === "limited" ? (
              <CommentBox personId={person.id} saving={store.saving} onSend={store.comment} />
            ) : null}
          </section>
        </div>

        {/* Context rail — a sticky column on wide screens. */}
        <aside className="hidden space-y-5 lg:sticky lg:top-20 lg:block lg:self-start">
          <RailBlock label="Audience">
            <ClassificationTag classification={work.policy.classification} />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {access.rationale}.
            </p>
          </RailBlock>

          {work.reviewerIds.length > 0 ? (
            <RailBlock label={work.reviewRequired ? "Reviewers" : "Sent to"}>
              <PeopleList ids={work.reviewerIds} />
            </RailBlock>
          ) : null}

          {work.assigneeIds.length > 0 ? (
            <RailBlock label="Assigned">
              <PeopleList ids={work.assigneeIds} />
            </RailBlock>
          ) : null}

          {work.participantIds.length > 0 ? (
            <RailBlock label="Participants">
              <PeopleList ids={work.participantIds} />
            </RailBlock>
          ) : null}

          <RailBlock label="Context">
            <ul className="space-y-1 text-[13px]">
              {ministry ? <li>{ministry.name}</li> : null}
              {campus ? <li className="text-muted-foreground">{campus.name}</li> : null}
              {work.period ? <li className="text-muted-foreground">{work.period}</li> : null}
            </ul>
          </RailBlock>

          <RailBlock label="Activity">
            <ActivityTimeline entries={work.activity} />
          </RailBlock>
        </aside>
      </div>
    </div>
  );
}

function CommentBox({
  personId,
  saving,
  onSend,
}: {
  personId: string;
  saving: boolean;
  onSend: (body: string) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) return;
    setFailure(null);
    try {
      await onSend(body.trim());
      setBody("");
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <div className="mt-2.5 flex items-start gap-3">
      <PersonAvatar personId={personId} />
      <div className="min-w-0 flex-1">
        <label className="block">
          <span className="sr-only">Add a comment</span>
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Add a comment…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[14px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </label>
        {failure ? (
          <p role="alert" className="mt-1 text-[12px] text-status-overdue">
            {failure}
          </p>
        ) : null}
        <div className="mt-1.5 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={!body.trim() || saving}
            busy={saving}
            onClick={() => void send()}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function RailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-medium text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}

function PeopleList({ ids }: { ids: string[] }) {
  return (
    <ul className="space-y-1.5">
      {ids.map((id) => (
        <li key={id} className="flex min-w-0 items-center gap-2 text-[13px]">
          <PersonAvatar personId={id} size="sm" />
          <PersonName personId={id} className="truncate" />
        </li>
      ))}
    </ul>
  );
}

/**
 * What this viewer may actually do about it.
 *
 * The owner submits; **where a process reviews this record**, its reviewers
 * decide. Most records are not reviewed by anybody: submitting publishes them,
 * and the only controls offered are the ones that exist — which is why the
 * review buttons are gated on `reviewRequired` rather than on who is reading.
 *
 * Being able to read a record is not authority over its state, so a reader who
 * is neither owner nor reviewer sees nothing here rather than controls that
 * would be refused.
 */
function ReviewActions({
  status,
  reviewRequired,
  isReviewer,
  isOwner,
  saving,
  failure,
  onAct,
}: {
  status: WorkStatus;
  reviewRequired: boolean;
  isReviewer: boolean;
  isOwner: boolean;
  saving: boolean;
  failure: unknown;
  onAct: (action: string, note?: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const canSubmit = isOwner && (status === "draft" || status === "changes-requested");
  /* Only where a process says this record is reviewed. Off by default. */
  const canStart =
    reviewRequired && isReviewer && (status === "submitted" || status === "changes-requested");
  const canReturn =
    reviewRequired && isReviewer && (status === "submitted" || status === "in-review");
  const canAcknowledge = canReturn;
  const canResolve =
    (isOwner || isReviewer) && ["open", "in-review", "acknowledged", "submitted"].includes(status);

  if (!canSubmit && !canStart && !canReturn && !canAcknowledge && !canResolve) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3.5">
      <h2 className="text-[13px] font-medium text-muted-foreground">
        {reviewRequired && isReviewer ? "Your review" : "Yours to move"}
      </h2>

      {asking ? (
        <div className="mt-2.5">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted-foreground">
              What needs changing?
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="So nobody has to reread the thread to find out."
              className="w-full resize-y rounded-md border border-border bg-surface-muted px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground focus:border-border-strong"
            />
          </label>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!note.trim() || saving}
              busy={saving}
              onClick={() => {
                onAct("request-changes", note.trim());
                setAsking(false);
                setNote("");
              }}
            >
              Request changes
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {canSubmit ? (
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => onAct("submit")}
            >
              Submit for review
            </Button>
          ) : null}
          {canStart ? (
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => onAct("start-review")}
            >
              Start review
            </Button>
          ) : null}
          {canAcknowledge ? (
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => onAct("acknowledge")}
            >
              Acknowledge
            </Button>
          ) : null}
          {canReturn ? (
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setAsking(true)}
            >
              Request changes
            </Button>
          ) : null}
          {canResolve ? (
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onAct("resolve")}
            >
              Mark resolved
            </Button>
          ) : null}
        </div>
      )}

      {failure ? (
        <p role="alert" className="mt-2 text-[12px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}
    </div>
  );
}
