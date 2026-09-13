import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, History, Plus, RotateCcw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstallationNotice, useInstallationRestricted } from "./installation-notice";
import { Section } from "./section";
import { capabilities } from "@/domain/capabilities";
import { PersonName } from "./person";
import { ErrorState, ListSkeleton } from "./async-state";
import {
  addConfigurationOption,
  fetchConfigurationAdmin,
  fetchConfigurationHistory,
  resetConfiguration,
  setConfigurationOption,
  setConfigurationValue,
  type ConfigurationChange,
  type ConfigurationView,
} from "@/lib/configuration-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { notify, useConfirm } from "@/config";
import { cn } from "@/lib/utils";

/**
 * Administration → Configuration.
 *
 * What an administrator may change here is deliberately narrow: **what things
 * are called, and whether they are offered**. Not ids, which every historical
 * record stores; not what an option means, which is behaviour.
 *
 * The screen says that rather than leaving it to be discovered — a settings
 * page that looks like it can change anything invites somebody to try.
 *
 * Deactivating replaces deleting. An option with records behind it keeps
 * rendering its name; it just stops being offered. And every change is
 * recorded, because renaming a status changes a word on every page that shows
 * it and "who called it that?" has to be answerable later.
 */

type AdminPayload = import("@/server/services/configuration-service").AdminConfiguration;

export function ConfigurationAdmin() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const restricted = useInstallationRestricted("configuration");
  const [showHistory, setShowHistory] = useState(false);

  const query = useQuery<AdminPayload>({
    queryKey: ["configuration-admin"],
    queryFn: async () => unwrap(await withTimeout(fetchConfigurationAdmin({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const history = useQuery<ConfigurationChange[]>({
    queryKey: ["configuration-history"],
    queryFn: async () => unwrap(await withTimeout(fetchConfigurationHistory({ data: undefined }))),
    enabled: showHistory,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: () => {
      /* Labels are read on every page, so a change invalidates everything —
         including the session, which carries the overrides to the browser. */
      void queryClient.invalidateQueries();
      notify.success("common.save.success");
    },
    onError: (error) => {
      /* The catalogue says what went wrong in general; the server's own
         refusal says what went wrong here, and an administrator needs both —
         a refusal they cannot read is indistinguishable from a control that
         does nothing. */
      notify.error("common.save.error", undefined, errorMessage(error));
    },
    networkMode: "always" as const,
    retry: 0,
  });

  if (query.status === "pending") return <ListSkeleton rows={4} />;
  if (query.status === "error") {
    return (
      <ErrorState title="Configuration could not be read" onRetry={() => void query.refetch()}>
        Nothing is lost. This is a problem reaching the server.
      </ErrorState>
    );
  }

  const save = (work: () => Promise<unknown>) => void mutation.mutateAsync(work).catch(() => {});
  /* Where this installation refuses every change, every control that makes
     one is as good as busy: shown, and not pressable. */
  const busy = mutation.isPending || restricted;

  return (
    <div className="space-y-4">
      <InstallationNotice restriction="configuration" className="rounded-md border" />
      <Section title="What may be changed here" className="bg-surface-muted">
        <p className="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          What things are called, whether they are offered, and — where a list says so — which of
          the application&apos;s own behaviours each one uses. An option&apos;s identity never
          changes, because records already refer to it.
          <br />
          <br />
          The lists with an <strong>Add</strong> button accept new values, because each added value
          either is free text the application reads generically or must name a behaviour the
          application already implements: an access strategy, a permission, a report stage&apos;s
          effects. That is the line throughout — you choose <em>among</em> behaviours, and never
          write one. The rest cannot be added to, and each says why.
          <br />
          <br />
          Nothing here is ever deleted; an option with records behind it is <em>stopped</em>, which
          keeps those records readable.
        </p>
      </Section>

      {query.data.namespaces.map((namespace) => (
        <NamespaceEditor
          key={namespace.namespace}
          namespace={namespace}
          busy={busy}
          onSave={save}
          onReset={async (optionId, label) => {
            if (await confirm("common.reset.confirm", { label })) {
              save(() =>
                resetConfiguration({ data: { namespace: namespace.namespace, optionId } }),
              );
            }
          }}
          onDeactivate={async (optionId, label, active) => {
            if (active && !(await confirm("configuration.deactivate.confirm", { label }))) return;
            save(() =>
              setConfigurationOption({
                data: { namespace: namespace.namespace, optionId, active: !active },
              }),
            );
          }}
        />
      ))}

      <Section title="Site settings">
        <ul className="divide-y divide-border">
          {Object.entries(query.data.site as Record<string, string | number>).map(
            ([field, value]) => (
              <ScalarRow
                key={field}
                field={field}
                value={value}
                busy={busy}
                onSave={(next) =>
                  save(() =>
                    setConfigurationValue({
                      data: { namespace: "site.profile", field, value: next },
                    }),
                  )
                }
              />
            ),
          )}
        </ul>
      </Section>

      <Section title="Cadence">
        <ul className="divide-y divide-border">
          {Object.entries(query.data.cadence as Record<string, number>).map(([field, value]) => (
            <ScalarRow
              key={field}
              field={field}
              value={value}
              busy={busy}
              onSave={(next) =>
                save(() =>
                  setConfigurationValue({
                    data: { namespace: "site.cadence", field, value: next },
                  }),
                )
              }
            />
          ))}
        </ul>
      </Section>

      <Section
        title="What has been changed"
        action={
          <Button type="button" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-3.5" aria-hidden />
            {showHistory ? "Hide" : "Show"}
          </Button>
        }
      >
        {showHistory ? (
          history.data && history.data.length > 0 ? (
            <ul className="divide-y divide-border">
              {history.data.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5">
                  <p className="text-[13px]">{entry.summary}</p>
                  <p className="text-[12px] text-muted-foreground">
                    <PersonName personId={entry.actorId} /> · {entry.at.slice(0, 10)} ·{" "}
                    {entry.namespace}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Nothing has been changed from what Oikonomia ships with.
            </p>
          )
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            Every rename, reorder and deactivation is recorded with who made it.
          </p>
        )}
      </Section>
    </div>
  );
}

/**
 * The access strategies the application implements.
 *
 * Shown so an administrator chooses among capabilities rather than inventing
 * one. The list is the code's; the names on the left of each choice are the
 * church's.
 */
/**
 * What a report stage can do.
 *
 * Four questions, and the answers are the whole of what a stage means: a move
 * between two stages is derived from the difference between their answers, so
 * these ticks are the stage's behaviour rather than a description of it.
 */
const BEHAVIOURS = [
  {
    id: "editable" as const,
    label: "Its author can still change the content",
  },
  {
    id: "visibleToAudience" as const,
    label: "Its audience can read it at this stage",
  },
  {
    id: "final" as const,
    label: "The content is the record — reaching this stage keeps a copy",
  },
  {
    id: "current" as const,
    label: "It still counts as current work",
  },
];

/**
 * How an entry's audience is enforced.
 *
 * Separate from the report strategies above because an entry lives inside a
 * gathering: its audiences are the ones that gathering has. Offering a church
 * the report list here would be offering choices this place cannot honour.
 */
const ENTRY_STRATEGIES = [
  {
    id: "author-only",
    label: "Only whoever wrote it",
    description: "Nobody else, whatever else they can reach.",
  },
  {
    id: "named-viewers",
    label: "People named on the entry",
    description: "Its author, and whoever is explicitly added to it.",
  },
  {
    id: "gathering-leaders",
    label: "This gathering's leaders",
    description: "Whoever is assigned to lead the gathering it was written in.",
  },
  {
    id: "all-leaders",
    label: "Leaders",
    description: "Ordinary LifeGroup reporting, readable by the leaders of this group.",
  },
];

const ACCESS_STRATEGIES = [
  {
    id: "owner-only",
    label: "Only its author",
    description: "Nobody else, whatever else they can reach.",
  },
  {
    id: "named-people",
    label: "People named on the record",
    description: "Its author, and whoever is explicitly added to it.",
  },
  {
    id: "leadership-groups",
    label: "The leadership audience",
    description: "Whichever responsibility groups the church has marked as its leadership.",
  },
  {
    id: "organization",
    label: "Ordinary organisational reading",
    description: "The people the record is shared with.",
  },
];

function NamespaceEditor({
  namespace,
  busy,
  onSave,
  onReset,
  onDeactivate,
}: {
  namespace: ConfigurationView;
  busy: boolean;
  onSave: (work: () => Promise<unknown>) => void;
  onReset: (optionId: string, label: string) => void;
  onDeactivate: (optionId: string, label: string, active: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTrigger, setNewTrigger] = useState(false);
  const [newStrategy, setNewStrategy] = useState("named-people");
  const [newEntryStrategy, setNewEntryStrategy] = useState("all-leaders");
  const [newCapabilities, setNewCapabilities] = useState<string[]>([]);
  const [newBehaviors, setNewBehaviors] = useState({
    editable: true,
    final: false,
    current: true,
    visibleToAudience: false,
  });
  const isCategories = namespace.namespace === "information.categories";
  const isAudience = namespace.namespace === "reports.visibility";
  const isRoles = namespace.namespace === "people.roles";
  const isStages = namespace.namespace === "reports.statuses";
  const isEntryAudience = namespace.namespace === "lifegroup.entryVisibility";

  return (
    <Section
      title={namespace.label}
      meta={`${namespace.options.length}`}
      action={
        namespace.addable && !adding ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add
          </Button>
        ) : null
      }
    >
      <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
        {namespace.description}
      </p>
      <ul className="divide-y divide-border">
        {namespace.options.map((option) => (
          <li key={option.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            {editing === option.id ? (
              <>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-border-strong"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !draft.trim()}
                  onClick={() => {
                    onSave(() =>
                      setConfigurationOption({
                        data: {
                          namespace: namespace.namespace,
                          optionId: option.id,
                          label: draft.trim(),
                        },
                      }),
                    );
                    setEditing(null);
                  }}
                >
                  <Check className="size-3.5" aria-hidden />
                  Save
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[14px]", !option.active && "text-disabled")}>
                    {option.label}
                    {!option.active ? (
                      <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Inactive
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {/* The id is shown because it is what records store, and
                        because seeing it makes clear it is not the label. */}
                    <code>{option.id}</code>
                    {option.description ? ` · ${option.description}` : ""}
                  </span>
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(option.id);
                    setDraft(option.label);
                  }}
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onDeactivate(option.id, option.label, option.active)}
                >
                  {option.active ? "Deactivate" : "Reactivate"}
                </Button>
                {option.overridden ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onReset(option.id, option.label)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Reset
                  </Button>
                ) : null}
              </>
            )}

            {/* A role's bundle, editable in place. This is the one list whose
                contents are authorization, so it says so and it saves one tick
                at a time rather than behind a form. */}
            {isRoles ? (
              <fieldset className="w-full pl-1">
                {capabilities.map((capability) => {
                  const held = (option.capabilities ?? []).includes(capability.id);
                  return (
                    <label
                      key={capability.id}
                      className="flex cursor-pointer items-start gap-2 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={held}
                        disabled={busy}
                        /*
                         * The new bundle is computed from what the role
                         * *holds*, never from the event's `checked`. The input
                         * sits inside its label, so one click can reach it
                         * twice; reading the DOM's state made a removal land
                         * as a second addition. A set built from the known
                         * value cannot do that however many times it fires.
                         */
                        onChange={() =>
                          onSave(() =>
                            setConfigurationOption({
                              data: {
                                namespace: namespace.namespace,
                                optionId: option.id,
                                capabilities: held
                                  ? (option.capabilities ?? []).filter((id) => id !== capability.id)
                                  : [...new Set([...(option.capabilities ?? []), capability.id])],
                              },
                            }),
                          )
                        }
                        className="mt-0.5"
                      />
                      <span className="text-[13px] leading-relaxed">
                        {capability.label}
                        <span className="block text-[12px] text-muted-foreground">
                          {capability.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </li>
        ))}
      </ul>

      {/*
       * Where a list cannot take a new value, the screen says so rather than
       * leaving somebody to wonder where the Add button went. The reason is
       * the honest one: these ids are written into the application.
       */}
      {!namespace.addable ? (
        <p className="border-t border-border px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {namespace.fixedReason}
        </p>
      ) : null}

      {adding ? (
        <div className="space-y-2.5 border-t border-border px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Name</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              autoFocus
              placeholder={isCategories ? "Safeguarding concern" : "Prayer meeting"}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Description <span className="font-normal">(optional)</span>
            </span>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          {isAudience ? (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                How this audience is enforced
              </span>
              <select
                value={newStrategy}
                onChange={(e) => setNewStrategy(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
              >
                {ACCESS_STRATEGIES.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                {ACCESS_STRATEGIES.find((s) => s.id === newStrategy)?.description} Oikonomia
                enforces this; naming the choice does not change what it permits.
              </span>
            </label>
          ) : null}

          {isEntryAudience ? (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                How this audience is enforced
              </span>
              <select
                value={newEntryStrategy}
                onChange={(e) => setNewEntryStrategy(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
              >
                {ENTRY_STRATEGIES.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                {ENTRY_STRATEGIES.find((s) => s.id === newEntryStrategy)?.description} Oikonomia
                enforces this; naming the choice does not change what it permits.
              </span>
            </label>
          ) : null}

          {isRoles ? (
            <fieldset>
              <legend className="mb-1 block text-[12px] font-medium text-muted-foreground">
                What this role may do
              </legend>
              {capabilities.map((capability) => (
                <label key={capability.id} className="flex cursor-pointer items-start gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={newCapabilities.includes(capability.id)}
                    onChange={(e) =>
                      setNewCapabilities((current) =>
                        e.target.checked
                          ? [...current, capability.id]
                          : current.filter((id) => id !== capability.id),
                      )
                    }
                    className="mt-0.5"
                  />
                  <span className="text-[13px] leading-relaxed">
                    {capability.label}
                    <span className="block text-[12px] text-muted-foreground">
                      {capability.description}
                    </span>
                  </span>
                </label>
              ))}
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                A role is a name for this list and nothing more. Tick nothing and it is an ordinary
                leader.
              </span>
            </fieldset>
          ) : null}

          {isStages ? (
            <fieldset>
              <legend className="mb-1 block text-[12px] font-medium text-muted-foreground">
                What this stage does
              </legend>
              {BEHAVIOURS.map((behaviour) => (
                <label key={behaviour.id} className="flex cursor-pointer items-start gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={newBehaviors[behaviour.id]}
                    onChange={(e) =>
                      setNewBehaviors((current) => ({
                        ...current,
                        [behaviour.id]: e.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span className="text-[13px] leading-relaxed">{behaviour.label}</span>
                </label>
              ))}
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                Moving a report to this stage will do whatever these answers imply, and will be
                offered only to somebody allowed to make that kind of move.
              </span>
            </fieldset>
          ) : null}

          {isCategories ? (
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={newTrigger}
                onChange={(e) => setNewTrigger(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[13px] leading-relaxed">
                Ask for leadership attention
                <span className="block text-[12px] text-muted-foreground">
                  Anything filed under this category appears in the Leadership Inbox for the people
                  who may already read it. It never widens who can see a record.
                </span>
              </span>
            </label>
          ) : null}

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            The name can be changed later. What the application stores is fixed when you add it, so
            renaming never affects records already filed under it.
          </p>

          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !newLabel.trim()}
              onClick={() => {
                onSave(() =>
                  addConfigurationOption({
                    data: {
                      namespace: namespace.namespace,
                      label: newLabel.trim(),
                      ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
                      ...(isCategories ? { attentionTrigger: newTrigger } : {}),
                      ...(isAudience ? { accessStrategy: newStrategy } : {}),
                      ...(isRoles ? { capabilities: newCapabilities } : {}),
                      ...(isStages ? { behaviors: newBehaviors } : {}),
                      ...(isEntryAudience ? { entryStrategy: newEntryStrategy } : {}),
                    },
                  }),
                );
                setAdding(false);
                setNewLabel("");
                setNewDescription("");
                setNewTrigger(false);
                setNewCapabilities([]);
              }}
            >
              Add it
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function ScalarRow({
  field,
  value,
  busy,
  onSave,
}: {
  field: string;
  value: string | number;
  busy: boolean;
  onSave: (next: string | number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const changed = draft !== String(value);

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{field}</span>
      </span>
      {/* The field name is beside the box rather than tied to it, so a screen
          reader would otherwise read eleven identical unnamed text boxes
          followed by eleven identical "Save" buttons. */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={field}
        className="w-44 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-border-strong"
      />
      <Button
        type="button"
        variant="ghost"
        aria-label={`Save ${field}`}
        disabled={busy || !changed}
        onClick={() => onSave(typeof value === "number" ? Number(draft) : draft)}
      >
        <Settings2 className="size-3.5" aria-hidden />
        Save
      </Button>
    </li>
  );
}
