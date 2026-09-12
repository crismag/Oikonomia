import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { fetchSession, type PersonRecord, type SessionSnapshot } from "@/lib/organization-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { applyOverrides, type OverrideRecord } from "@/config";
import type { Campus, Ministry, Persona, ResponsibilityGroup, Venue } from "@/domain/types";

/**
 * Who is here, and what exists.
 *
 * People, campuses, ministries and venues used to be imported straight from a
 * fixture module by forty different files, which is why a fresh installation
 * of Oikonomia displayed a church nobody had entered. They come from the
 * database now, through one query the shell makes once, and every name drawn
 * anywhere in the product resolves through this.
 *
 * ## Somebody may be nobody
 *
 * `viewer` is null until a person signs in, and on a new installation there is
 * nobody to sign in as. The shell renders setup or sign-in in that case and
 * does not mount the application, which is why `useViewer()` may assume a
 * viewer while this may not.
 *
 * ## Naming a person who is not there
 *
 * `personById` returns a **placeholder** rather than throwing when an id
 * resolves to nobody — a record may refer to somebody since removed, and a
 * missing name must not take a page down. It renders as "Unknown person", and
 * it is deliberately not a plausible invented name.
 */

export interface OrganizationStore {
  viewer: { person: PersonRecord; persona: Persona } | null;
  setupRequired: boolean;
  /** This person has not been through setup, or went through an older version. */
  onboardingRequired: boolean;

  /**
   * Everybody and everything, including what has been deactivated.
   *
   * Use these to **resolve** a name: a report signed by somebody who has left
   * is still a report somebody wrote, and a page that could not name them
   * would be rewriting history.
   */
  people: PersonRecord[];
  campuses: Campus[];
  ministries: Ministry[];
  venues: Venue[];
  groups: ResponsibilityGroup[];

  /**
   * What may be **offered**: put on a team, named as a reporting leader,
   * chosen as a lead.
   *
   * The distinction is the whole of what deactivation means here. Nothing
   * about it decides who may read anything — the access model does not consult
   * it — and nothing is hidden from where it already appears.
   */
  activePeople: PersonRecord[];
  activeCampuses: Campus[];
  activeMinistries: Ministry[];

  /**
   * The groups a report addressed to leadership reaches.
   *
   * Empty until a church marks a group as its leadership audience, and empty
   * is the safe answer: a leadership report with no named leadership reaches
   * its author alone rather than everybody.
   */
  leadershipGroupIds: string[];
  groupById: (id: string) => ResponsibilityGroup | undefined;
  /** The groups this person belongs to. */
  groupsOf: (personId: string) => ResponsibilityGroup[];

  personById: (id: string) => PersonRecord;
  findPerson: (id: string) => PersonRecord | undefined;
  campusById: (id: string) => Campus | undefined;
  ministryById: (id: string) => Ministry | undefined;
  venueById: (id: string) => Venue | undefined;

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  refresh: () => void;
}

const OrganizationContext = createContext<OrganizationStore | null>(null);

export function useOrganization(): OrganizationStore {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error("useOrganization must be used inside OrganizationProvider");
  return value;
}

/** Somebody a record refers to who is not in the directory any more. */
export function unknownPerson(id: string): PersonRecord {
  return {
    id,
    name: "Unknown person",
    initials: "?",
    role: "",
    campusId: "",
    ministryIds: [],
    accessRole: "leader",
    joinedAt: "",
  };
}

/**
 * Whether the **browser** should hand these overrides to the registry.
 *
 * Extracted so the rule can be tested rather than trusted. Two answers are
 * "no", and both were real: on the server, where writing would corrupt a
 * singleton shared by every request in the process; and with nothing loaded
 * yet, where writing an empty list would clear whatever is in force.
 */
export function browserShouldApply(inBrowser: boolean, configuration: unknown): boolean {
  return inBrowser && Array.isArray(configuration);
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery<SessionSnapshot>({
    queryKey: ["organization"],
    queryFn: async () => unwrap(await withTimeout(fetchSession({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["organization"] });
  }, [queryClient]);

  /*
   * Configuration arrives with the session and is handed to the registry
   * **during this render**, not in an effect afterwards.
   *
   * That distinction is the whole of "runtime-effective". The registry is a
   * module, not React state, so nothing re-renders when it changes: applying
   * overrides in an effect meant the render that had just received them still
   * drew the previous labels, and the new ones appeared whenever something
   * else happened to re-render — or on a reload. Applying here, before any
   * descendant renders, makes an administrator's change visible on the render
   * that fetched it.
   *
   * `useMemo` for the identity check only; `applyOverrides` is idempotent, so
   * running it twice costs nothing.
   */
  useMemo(() => {
    /*
     * **Browser only, and only once there is something to apply.**
     *
     * The registry is a module-level singleton, which on the server is shared
     * by every request in the process. This component renders there too, and
     * an unguarded call handed it `[]` during server rendering — wiping the
     * overrides the request had just applied and leaving the *server's* own
     * answer built on shipped defaults. The symptom was a configured value
     * resolving correctly everywhere except the one snapshot the browser was
     * given.
     *
     * So: the server applies overrides per request in `refreshConfiguration`,
     * the browser applies what the session carried, and neither reaches into
     * the other's copy.
     */
    if (!browserShouldApply(typeof window !== "undefined", query.data?.configuration)) return;
    applyOverrides(query.data!.configuration as OverrideRecord[]);
    /* Deliberately narrower than the rule wants. Depending on the whole of
       `query.data` would re-apply the overrides on every refetch of people,
       ministries and groups — none of which can change configuration — and
       `applyOverrides` is the one thing here with a module-level effect. The
       dependency is the thing that actually decides the outcome. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data?.configuration]);

  const value = useMemo<OrganizationStore>(() => {
    const data = query.data;
    const people = data?.people ?? [];
    const byPerson = new Map(people.map((person) => [person.id, person]));
    const groups = data?.groups ?? [];

    return {
      viewer: data?.viewer ?? null,
      setupRequired: data?.setupRequired ?? false,
      onboardingRequired: data?.onboardingRequired ?? false,

      people,
      campuses: data?.campuses ?? [],
      ministries: data?.ministries ?? [],
      venues: data?.venues ?? [],
      groups,

      activePeople: people.filter((person) => person.active !== false),
      activeCampuses: (data?.campuses ?? []).filter((campus) => campus.active !== false),
      activeMinistries: (data?.ministries ?? []).filter((ministry) => ministry.active !== false),

      leadershipGroupIds: groups
        .filter((group) => group.active && group.leadershipAudience)
        .map((group) => group.id),
      groupById: (id) => groups.find((group) => group.id === id),
      groupsOf: (personId) => groups.filter((group) => group.memberIds.includes(personId)),

      personById: (id) => byPerson.get(id) ?? unknownPerson(id),
      findPerson: (id) => byPerson.get(id),
      campusById: (id) => (data?.campuses ?? []).find((campus) => campus.id === id),
      ministryById: (id) => (data?.ministries ?? []).find((ministry) => ministry.id === id),
      venueById: (id) => (data?.venues ?? []).find((venue) => venue.id === id),

      status: query.isError ? "error" : data ? "ready" : "loading",
      error: query.error,
      retry: () => void query.refetch(),
      refresh,
    };
  }, [query, refresh]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}
