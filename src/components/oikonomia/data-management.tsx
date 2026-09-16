import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Check, Download, HardDrive, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstallationNotice, useInstallationRestricted } from "./installation-notice";
import { Section } from "./section";
import { PersonName } from "./person";
import {
  fetchContinuity,
  fetchDataJobs,
  runBackup,
  runExport,
  runRetention,
  validatePackage,
  verifyBackup,
  type ContinuityView,
  type DataJob,
} from "@/lib/data-management-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { jobStatusLabel } from "@/domain/data-management";
import { cn } from "@/lib/utils";

/**
 * Data Management, for whoever administers the installation.
 *
 * ## What this screen refuses to say
 *
 * "Backup complete", when every copy is on the machine that would be lost. A
 * local backup is genuinely useful for a bad deploy and genuinely useless for a
 * dead server, and a screen that reported it as done would leave a church one
 * hardware failure from losing everything while believing otherwise.
 *
 * So the concerns are shown above the controls, permanently, until they are
 * actually resolved — which for an off-server copy means somebody configuring
 * one, because this installation has no such destination and nothing here
 * pretends it does.
 */
export function DataManagement() {
  const queryClient = useQueryClient();
  const restricted = useInstallationRestricted("data");
  const [failure, setFailure] = useState<string | null>(null);
  const [packageText, setPackageText] = useState("");
  const [checked, setChecked] = useState<string | null>(null);

  const continuity = useQuery<ContinuityView>({
    queryKey: ["continuity"],
    queryFn: async () => unwrap(await withTimeout(fetchContinuity({ data: undefined }))),
    retry: 1,
    networkMode: "always",
  });

  const jobs = useQuery<DataJob[]>({
    queryKey: ["data-jobs"],
    queryFn: async () => unwrap(await withTimeout(fetchDataJobs({ data: undefined }))),
    retry: 1,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (error) => setFailure(errorMessage(error)),
    networkMode: "always" as const,
    retry: 0,
  });

  const run = (work: () => Promise<unknown>) => {
    setFailure(null);
    void mutation.mutateAsync(work).catch(() => {});
  };

  const status = continuity.data;
  const busy = mutation.isPending;

  return (
    <div className="space-y-4">
      <InstallationNotice restriction="data" className="rounded-md border" />
      {failure ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {failure}
        </p>
      ) : null}

      {/* What needs attention, before anything that could be mistaken for
          reassurance. */}
      <Section title="Continuity" className="bg-surface-muted">
        {status && status.concerns.length > 0 ? (
          <ul className="divide-y divide-border">
            {status.concerns.map((concern) => (
              <li key={concern} className="flex items-start gap-2.5 px-4 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-overdue" aria-hidden />
                <span className="text-[13px] leading-relaxed">{concern}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            {status ? "Nothing needs attention." : "Checking…"}
          </p>
        )}

        <dl className="divide-y divide-border border-t border-border">
          <Row
            label="Last backup"
            value={
              status?.lastSuccessfulBackup
                ? `${status.lastSuccessfulBackup.completedAt?.slice(0, 16).replace("T", " ")} · ${bytes(status.lastSuccessfulBackup.artifactBytes)}`
                : "Never"
            }
          />
          <Row
            label="Last verified restore"
            value={
              status?.lastVerifiedRestore
                ? (status.lastVerifiedRestore.completedAt?.slice(0, 16).replace("T", " ") ?? "—")
                : "Never"
            }
          />
          <Row
            label="Off-server copy"
            value={
              status?.offsiteMissing
                ? "Not configured — every copy is on this server"
                : "Configured"
            }
          />
          <Row
            label="Encryption"
            value={
              !status
                ? "—"
                : status.encryption === "on"
                  ? "On — backup files can be opened only with this server's backup key"
                  : status.encryption === "invalid"
                    ? "The backup key is not usable — backups will fail until it is corrected"
                    : "Off — anyone who can read the backup files can read them"
            }
          />
          <Row label="Scheduled backups" value="Not configured — run manually or from cron" />
        </dl>

        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || restricted}
            onClick={() => run(() => runBackup({ data: undefined }))}
          >
            <HardDrive className="size-3.5" aria-hidden />
            Back up now
          </Button>
          {status?.lastSuccessfulBackup ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || restricted}
              onClick={() =>
                run(() => verifyBackup({ data: { jobId: status.lastSuccessfulBackup!.id } }))
              }
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              Verify the last backup
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy || restricted}
            onClick={() => run(() => runRetention({ data: undefined }))}
          >
            Apply retention now
          </Button>
        </div>
      </Section>

      <Section title="Export">
        <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
          An export contains only what you may read. A site export leaves out every record you are
          not an audience for, and says how many — never which.
        </p>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {(["json", "csv", "opk"] as const).map((format) => (
            <Button
              key={format}
              type="button"
              variant="secondary"
              disabled={busy || restricted}
              onClick={() => run(() => runExport({ data: { scope: { type: "site" }, format } }))}
            >
              <Download className="size-3.5" aria-hidden />
              Whole site ({format.toUpperCase()})
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Check a package">
        <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
          Paste a package to see what it holds. Checking writes nothing — it reads the manifest,
          verifies the checksums, and says what an import would contain.
        </p>
        <div className="space-y-2 px-4 py-3">
          <textarea
            value={packageText}
            onChange={(e) => setPackageText(e.target.value)}
            rows={4}
            aria-label="Package contents to check"
            placeholder="Paste the contents of a .opk file"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-[12px] outline-none focus:border-border-strong"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || restricted || !packageText.trim()}
            onClick={() => {
              setChecked(null);
              setFailure(null);
              void mutation
                .mutateAsync(() => validatePackage({ data: { content: packageText } }))
                .then((result) => {
                  const outcome = result as {
                    ok: boolean;
                    problem?: string;
                    counts: Record<string, number>;
                  };
                  setChecked(
                    outcome.ok
                      ? `That package is readable: ${Object.entries(outcome.counts)
                          .map(([section, n]) => `${n} ${section}`)
                          .join(", ")}.`
                      : (outcome.problem ?? "That package was refused."),
                  );
                })
                .catch(() => {});
            }}
          >
            <Check className="size-3.5" aria-hidden />
            Check it
          </Button>
          {checked ? <p className="text-[13px]">{checked}</p> : null}
        </div>
      </Section>

      <Section title="Recent data operations" meta={`${jobs.data?.length ?? 0}`}>
        <ul className="divide-y divide-border">
          {(jobs.data ?? []).slice(0, 15).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px]">
                  {job.operation} · {job.scope.type}
                </span>
                <span className="block text-[12px] text-muted-foreground">
                  {job.requestedAt.slice(0, 16).replace("T", " ")}
                  {" · "}
                  {job.executionActor === "system" ? (
                    "Automatic"
                  ) : job.requestedBy ? (
                    <PersonName personId={job.requestedBy} />
                  ) : (
                    "Unknown"
                  )}
                  {job.withheldCount > 0 ? ` · ${job.withheldCount} withheld` : ""}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] uppercase tracking-wide",
                  job.status === "failed" || job.status === "validation_failed"
                    ? "text-status-overdue"
                    : "text-muted-foreground",
                )}
              >
                {jobStatusLabel[job.status]}
              </span>
            </li>
          ))}
          {(jobs.data ?? []).length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              Nothing yet. Exports, backups and imports are recorded here with who asked for them.
            </li>
          ) : null}
        </ul>
      </Section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
      <dt className="w-48 shrink-0 text-[12px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13px]">{value}</dd>
    </div>
  );
}

const bytes = (n?: number) => (n ? `${(n / 1024).toFixed(0)} KB` : "—");
