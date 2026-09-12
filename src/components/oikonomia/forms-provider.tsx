import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import {
  completeFormRecord,
  copyFormDefinition,
  createFormDefinition,
  createFormRecord,
  deleteFormDefinition,
  fetchForms,
  renameFormDefinition,
  reopenFormRecord,
  saveFormDefinition,
  setFormResponse,
  type FormsData,
} from "@/lib/forms-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { FormDefinition, FormRecord, FormResponse, FormSection } from "@/domain/types";

/**
 * One empty array, reused.
 *
 * `query.data ?? []` builds a new array every render while the query has no
 * data, and a new array is a new dependency — so every `useMemo` downstream
 * recomputed on every render, which is the opposite of what it is for. A
 * single shared value keeps the identity stable. Nothing writes to it — every
 * consumer reads — so it is not defensively frozen.
 */
const NONE: never[] = [];

/**
 * Forms — the checklists a ministry designs, and the ones people fill in.
 *
 * **This was the most misleading surface in the application.** The builder was
 * a convincing interface over React state: a leader could design a checklist,
 * publish it, fill one in, and watch every bit of it disappear on reload.
 * Nothing about it looked unfinished, which is what made it worse than an
 * obviously stubbed page.
 *
 * It now reads and writes real rows. The store's shape is deliberately almost
 * unchanged — creation returns a promise instead of an id, and nothing else —
 * so the builder screens did not have to be rewritten to become true.
 *
 * A record captures the structure it was filled under. Editing a master
 * checklist must never retroactively rewrite what somebody already completed,
 * which is why the server copies the sections onto the record.
 */

export interface FormsStore {
  definitions: FormDefinition[];
  records: FormRecord[];

  status: "loading" | "ready" | "error";
  retry: () => void;
  saving: boolean;

  createDefinition: (input: {
    title: string;
    sections: FormSection[];
    ministryId?: string;
    ownerId: string;
  }) => Promise<string>;
  /** Saves a design edit and bumps the version with a history entry. */
  saveDefinition: (
    id: string,
    sections: FormSection[],
    summary: string,
    authorId?: string,
  ) => Promise<void>;
  renameDefinition: (id: string, title: string, description?: string) => Promise<void>;
  copyForm: (id: string, title: string, ownerId: string) => Promise<string | undefined>;
  deleteDefinition: (id: string) => Promise<void>;

  createRecord: (
    definitionId: string,
    input: { title: string; period?: string; date?: string; createdBy: string },
  ) => Promise<string | undefined>;
  setResponse: (
    recordId: string,
    response: FormResponse,
    label: string,
    actorId?: string,
  ) => Promise<void>;
  completeRecord: (recordId: string, actorId?: string) => Promise<void>;
  reopenRecord: (recordId: string, actorId?: string) => Promise<void>;
  recordsFor: (definitionId: string) => FormRecord[];
}

const FormsContext = createContext<FormsStore | null>(null);

export function useForms(): FormsStore {
  const value = useContext(FormsContext);
  if (!value) throw new Error("useForms must be used inside FormsProvider");
  return value;
}

export function FormsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery<FormsData>({
    queryKey: ["forms"],
    queryFn: async () => unwrap(await withTimeout(fetchForms({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["forms"] });
    /* A form is a registry resource too — Documents & Forms lists it. */
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
  }, [queryClient]);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const call = useCallback(
    async (work: () => Promise<unknown>) => {
      await mutation.mutateAsync(work);
    },
    [mutation],
  );

  const definitions = query.data?.definitions ?? NONE;
  const records = query.data?.records ?? NONE;

  const value = useMemo<FormsStore>(
    () => ({
      definitions,
      records,
      status: query.isError ? "error" : query.data ? "ready" : "loading",
      retry: () => void query.refetch(),
      saving: mutation.isPending,

      /* The owner is taken from the request, never from the caller. */
      createDefinition: async (input) => {
        const created = unwrap(
          (await withTimeout(
            createFormDefinition({
              data: {
                title: input.title,
                sections: input.sections,
                ...(input.ministryId ? { ministryId: input.ministryId } : {}),
              },
            }),
          )) as never,
        ) as FormDefinition;
        invalidate();
        return created.id;
      },

      saveDefinition: (id, sections, summary) =>
        call(() => saveFormDefinition({ data: { id, sections, summary } })),

      renameDefinition: (id, title, description) =>
        call(() =>
          renameFormDefinition({
            data: { id, title, ...(description !== undefined ? { description } : {}) },
          }),
        ),

      copyForm: async (id, title) => {
        const copy = unwrap(
          (await withTimeout(copyFormDefinition({ data: { id, title } }))) as never,
        ) as FormDefinition;
        invalidate();
        return copy.id;
      },

      deleteDefinition: (id) => call(() => deleteFormDefinition({ data: { id } })),

      createRecord: async (definitionId, input) => {
        const record = unwrap(
          (await withTimeout(
            createFormRecord({
              data: {
                definitionId,
                title: input.title,
                ...(input.period ? { period: input.period } : {}),
                ...(input.date ? { date: input.date } : {}),
              },
            }),
          )) as never,
        ) as FormRecord;
        invalidate();
        return record.id;
      },

      setResponse: (recordId, response, label) =>
        call(() => setFormResponse({ data: { recordId, response, label } })),

      completeRecord: (recordId) => call(() => completeFormRecord({ data: { id: recordId } })),
      reopenRecord: (recordId) => call(() => reopenFormRecord({ data: { id: recordId } })),

      recordsFor: (definitionId) =>
        records.filter((record) => record.formDefinitionId === definitionId),
    }),
    [definitions, records, query, mutation.isPending, call, invalidate],
  );

  return <FormsContext.Provider value={value}>{children}</FormsContext.Provider>;
}
