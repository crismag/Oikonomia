import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FileText, Lock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { PersonName } from "./person";
import { useReports } from "./report-provider";
import { useViewer } from "@/domain/session";
import { categoriesFor, categoryLabelOf, DEFAULT_CATEGORY } from "@/domain/categories";
import { errorMessage } from "@/lib/calendar-client";
import { message } from "@/config";
import type { ReportVisibility } from "@/domain/types";

/**
 * Reports written after a gathering.
 *
 * ## Why a report and not an entry
 *
 * An entry belongs to the evening and is read by the leaders who were there.
 * Some of what a leader needs to write afterwards is not that: a pastoral
 * concern about one person, a difficulty in a family, something that should
 * reach one or two people and nobody else. Writing it as an entry would put it
 * in front of everybody who can open the gathering.
 *
 * So this writes a **report** — the same record the binder keeps everywhere
 * else — which happens to remember that it came from this gathering. The
 * gathering is context: it names the source and opens it, and it grants
 * nothing.
 *
 * ## What it shows
 *
 * Only reports this viewer may discover. The service filtered them before they
 * reached the browser, so a confidential concern is not here to be counted,
 * hinted at, or hidden with CSS — for anybody else it does not exist.
 */
export function GatheringReports({
  gatheringId,
  gatheringLabel,
}: {
  gatheringId: string;
  gatheringLabel: string;
}) {
  const store = useReports();
  const { person } = useViewer();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const confidentialNotice = message("reports.confidential.notice");

  const mine = store.visible.filter(
    (report) => report.contextType === "lifegroup-gathering" && report.contextId === gatheringId,
  );

  const create = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const id = await store.createReport({
        authorId: person.id,
        reportType: "Gathering report",
        contentSource: "native",
        title: title.trim(),
        contextType: "lifegroup-gathering",
        contextId: gatheringId,
        category,
        /*
         * Confidential means **restricted**, which the report module already
         * understands: its author and the people named on it, and nobody
         * else. Not "hidden in this list" — the server does not return it.
         */
        visibility: (confidential ? "restricted" : "leadership") as ReportVisibility,
      });
      setOpen(false);
      setTitle("");
      setConfidential(false);
      setCategory(DEFAULT_CATEGORY);
      void navigate({
        to: "/leadership-reports/$reportId",
        params: { reportId: id },
        search: { edit: true },
      });
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Section
      title="Reports"
      meta={mine.length > 0 ? `${mine.length}` : undefined}
      action={
        !open ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add report
          </Button>
        ) : null
      }
    >
      {mine.length > 0 ? (
        <ul className="divide-y divide-border">
          {mine.map((report) => (
            <li key={report.id} className="row-quiet">
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/leadership-reports/$reportId",
                    params: { reportId: report.id },
                    search: {},
                  })
                }
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
              >
                {report.visibility === "restricted" || report.visibility === "private" ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">
                    {report.title || "Untitled report"}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {categoryLabelOf(report.category ?? "general")} ·{" "}
                    <PersonName personId={report.authorId} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : !open ? (
        <p className="px-4 py-4 text-[13px] leading-relaxed text-muted-foreground">
          Nothing written up yet. A report is for what belongs outside the gathering&apos;s own
          notes — a concern, a follow-up, something one or two people should see.
        </p>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-border px-4 py-3.5">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Give it a short title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What this report covers"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          {/*
           * There is deliberately no "about this person" field.
           *
           * A structured subject is not a neutral label: it makes the report
           * findable by that person's name and, in this module, it gives them
           * a way in — a subject may read a report written about them. On a
           * pastoral concern written after a gathering, both are wrong.
           *
           * Whoever the report concerns is written in the report, by the
           * leader, in their own words. That is a sentence somebody chose to
           * write; it is not an index entry that pulls the report into a
           * person's record.
           */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                What kind of information
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
              >
                {categoriesFor("report").map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[13px] leading-relaxed">
              {/* Says exactly what the server enforces, and no more. One
                  definition, used wherever confidentiality is explained. */}
              {confidentialNotice.title}
              <span className="block text-[12px] text-muted-foreground">
                {confidentialNotice.body}
              </span>
            </span>
          </label>

          {failure ? (
            <p role="alert" className="text-[12px] text-status-overdue">
              {failure}
            </p>
          ) : null}

          <div className="flex gap-1.5">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void create()}>
              Start the report
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            It is kept with your reports — {gatheringLabel} is where it came from, not where it
            lives.
          </p>
        </div>
      ) : null}
    </Section>
  );
}
