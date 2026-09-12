import { CornerDownRight, Gavel, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import { PersonAvatar } from "./person";
import type { Comment, Decision } from "@/domain/types";

/**
 * Discussion around work.
 *
 * System events are visually distinct from human comments; decisions are pulled
 * out of the thread rather than buried in it, so a long conversation never
 * forces someone to reread everything to learn the current state.
 */

export function DecisionCard({ decision }: { decision: Decision }) {
  const { personById } = useOrganization();
  const person = personById(decision.decidedById);
  const requested = decision.state === "requested";

  return (
    <div
      className={cn(
        "rounded-md border px-3.5 py-3",
        requested
          ? "border-status-approval/30 bg-status-approval-soft"
          : "border-status-done/25 bg-status-done-soft",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Gavel
          className={cn(
            "size-3.5 shrink-0",
            requested ? "text-status-approval" : "text-status-done",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "text-[12px] font-medium",
            requested ? "text-status-approval" : "text-status-done",
          )}
        >
          {requested ? "Decision requested" : "Decision recorded"}
        </span>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed">{decision.summary}</p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {requested ? "Asked of" : "By"} {person.name} · {decision.at}
      </p>
    </div>
  );
}

export function CommentItem({ comment }: { comment: Comment }) {
  const { personById } = useOrganization();
  const person = personById(comment.authorId);

  if (comment.system) {
    return (
      <li className="flex items-center gap-2.5 py-2 pl-1 text-[13px] text-muted-foreground">
        <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          {comment.body} <span className="text-muted-foreground">· {comment.at}</span>
        </span>
      </li>
    );
  }

  return (
    <li className="flex gap-3 py-3.5">
      <PersonAvatar personId={comment.authorId} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium">{person.name}</span>
          <span className="text-[12px] text-muted-foreground">{comment.at}</span>
          {comment.restricted ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-status-overdue">
              <Lock className="size-3" aria-hidden />
              Restricted
            </span>
          ) : null}
        </div>

        {comment.target ? (
          <p className="mt-1 inline-flex rounded-sm border border-border bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            on {comment.target}
          </p>
        ) : null}

        <p className="mt-1 text-[14px] leading-relaxed text-foreground/90">{comment.body}</p>
      </div>
    </li>
  );
}

export function DiscussionThread({ comments }: { comments: Comment[] }) {
  return (
    <ul className="divide-y divide-border">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
    </ul>
  );
}
