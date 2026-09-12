import { EyeOff, FileLock2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { accessLabel, classificationLabel } from "@/domain/access";
import type { AccessDecision, Classification } from "@/domain/types";

/**
 * Access/audience presentation.
 *
 * Restricted content is a normal, expected product state — not an error. It is
 * styled calmly and always explains *why*, because the rationale is the point:
 * rank does not grant readership. The rules are stated in
 * `@/domain/access`, which enforces them.
 */

const classificationTone: Record<Classification, string> = {
  open: "text-muted-foreground",
  "context-restricted": "text-status-info",
  "leadership-confidential": "text-status-approval",
  "pastoral-private": "text-status-overdue",
};

export function ClassificationTag({
  classification,
  className,
}: {
  classification: Classification;
  className?: string;
}) {
  const Icon = classification === "open" ? ShieldCheck : Lock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px]",
        classificationTone[classification],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {classificationLabel[classification]}
    </span>
  );
}

/** Explains the resolved access level and the rule that produced it. */
export function AccessNotice({
  decision,
  className,
}: {
  decision: AccessDecision;
  className?: string;
}) {
  if (decision.level === "full") return null;

  const tone =
    decision.level === "denied"
      ? "border-status-overdue/25 bg-status-overdue-soft"
      : "border-border bg-surface-muted";

  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2.5", tone)}>
      <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{accessLabel[decision.level]}.</span>{" "}
        {decision.rationale}.
      </p>
    </div>
  );
}

/** Stands in for a section the viewer may not read. */
export function RedactedSection({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h4 className="text-[14px] font-medium text-foreground">{title}</h4>
      </div>
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        Withheld. This section is classified more strictly than the rest of this record.
      </p>
    </div>
  );
}

/**
 * Whole-object denial, reached by deep link.
 *
 * Reveals strictly less than the metadata-only tier below: the record's
 * existence is acknowledged, but nothing about where it lives or who holds it.
 */
export function DeniedPanel({
  decision,
  contextLabel,
}: {
  decision: AccessDecision;
  contextLabel?: string | undefined;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-surface-muted">
        <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="mt-5 text-xl">You don't have access to this record</h1>
      <p className="mx-auto mt-2.5 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {decision.rationale}.
      </p>
      {contextLabel ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          It belongs to {contextLabel}. Ask its owner to share it with you if you need it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Metadata-only.
 *
 * The viewer may know this record exists and see safe routing metadata, but not
 * its protected content — which is a distinct
 * tier from denial, so it must not be presented as a refusal. Subject line,
 * current state, sections and discussion are all protected content and stay out.
 */
export function MetadataPanel({
  decision,
  kind,
  contextLabel,
  classification,
  ownerName,
  lastActivity,
}: {
  decision: AccessDecision;
  kind: string;
  contextLabel: string;
  classification: Classification;
  ownerName: string;
  lastActivity?: string | undefined;
}) {
  const rows: [string, ReactNode][] = [
    ["Type", kind],
    ["Context", contextLabel],
    ["Classification", <ClassificationTag key="c" classification={classification} />],
    ["Held by", ownerName],
  ];
  if (lastActivity) rows.push(["Last activity", lastActivity]);

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-surface-muted">
        <FileLock2 className="size-5 text-muted-foreground" aria-hidden />
      </div>

      <h1 className="mt-5 text-center text-xl">This record exists, but its content is closed</h1>
      <p className="mx-auto mt-2.5 max-w-sm text-center text-[14px] leading-relaxed text-muted-foreground">
        {decision.rationale}. You can see where it sits and who holds it, which is enough to ask for
        access.
      </p>

      <dl className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 px-4 py-2.5">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-[13px]">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-center text-[12px] text-muted-foreground">
        Nothing above is protected content. The subject, discussion and body of this record stay
        closed until someone shares it with you.
      </p>
    </div>
  );
}
