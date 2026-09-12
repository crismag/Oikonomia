import { fileSources } from "./source";
import { applyOptionOverrides, applyScalarOverrides, type OverrideRecord } from "./overrides";
import {
  audienceOptionSchema,
  behavioralStatusSchema,
  cadenceSchema,
  optionList,
  entryOptionSchema,
  optionSchema,
  roleOptionSchema,
  siteSchema,
  statusSchema,
  type CadenceConfig,
  type OptionDefinition,
  type SemanticState,
  type SiteConfig,
  type StatusDefinition,
} from "./schema";

/**
 * The configuration service.
 *
 * **One way in.** A module asks `config.reports.statuses`, never
 * `import statuses from "../../../config/reports.json"`. The difference is the
 * whole point of this file: when these values move into the database and an
 * Administration screen, every consumer keeps working, because none of them
 * knew where the values came from.
 *
 * ## Validated once, at load
 *
 * Every namespace is parsed against its schema the first time it is read. A
 * duplicate id, a label used as an identifier, a missing required key — all
 * fail immediately and loudly, in development, with the namespace named.
 * Malformed configuration that merely produces strange behaviour later is the
 * thing this prevents.
 *
 * ## What it does not hold
 *
 * No secrets: nothing here is a credential, a key or a token, and nothing here
 * should ever be, because configuration is readable by the browser and headed
 * for an editable admin screen. No records either: no person, no ministry, no
 * campus. Those are the church, not choices about behaviour.
 */

export { accessStrategies, entryStrategies, knownCapabilities, semanticStates } from "./schema";
export type {
  AccessStrategy,
  EntryOptionDefinition,
  EntryStrategy,
  RoleOptionDefinition,
  AudienceOptionDefinition,
  BehavioralStatusDefinition,
  OptionDefinition,
  SemanticState,
  StatusBehavior,
  StatusDefinition,
} from "./schema";

/**
 * Namespaces: what each holds, and what validates it.
 *
 * The value comes from the shipped file, then an administrator's overrides are
 * laid over it, and only then is it validated. Validating after the merge is
 * deliberate — a stored override that would produce invalid configuration must
 * fail as loudly as a bad file, not quietly slip past because it arrived from
 * the database.
 */
const namespaces = {
  "site.profile": (o: OverrideRecord[]) =>
    siteSchema.parse(applyScalarOverrides("site.profile", fileSources["site.profile"], o)),
  "site.cadence": (o: OverrideRecord[]) =>
    cadenceSchema.parse(applyScalarOverrides("site.cadence", fileSources["site.cadence"], o)),

  "reports.statuses": (o: OverrideRecord[]) =>
    optionList(behavioralStatusSchema).parse(
      applyOptionOverrides("reports.statuses", fileSources["reports.statuses"] as never, o),
    ),
  "reports.visibility": (o: OverrideRecord[]) =>
    optionList(audienceOptionSchema).parse(
      applyOptionOverrides("reports.visibility", fileSources["reports.visibility"] as never, o),
    ),

  /*
   * Work stages carry behaviours too, but for a narrower purpose than report
   * stages: nothing derives a *transition* from them. A work record moves
   * through a review process whose steps carry rules no set of booleans
   * implies — who may take it, which one requires a note. What the behaviours
   * answer is the question every list asks: is this still open, and may its
   * owner still write in it.
   */
  "work.statuses": (o: OverrideRecord[]) =>
    optionList(behavioralStatusSchema).parse(
      applyOptionOverrides("work.statuses", fileSources["work.statuses"] as never, o),
    ),
  "goals.statuses": (o: OverrideRecord[]) =>
    optionList(statusSchema).parse(
      applyOptionOverrides("goals.statuses", fileSources["goals.statuses"] as never, o),
    ),

  "lifegroup.attendance": (o: OverrideRecord[]) =>
    optionList(statusSchema).parse(
      applyOptionOverrides("lifegroup.attendance", fileSources["lifegroup.attendance"] as never, o),
    ),
  "lifegroup.gatheringStatuses": (o: OverrideRecord[]) =>
    optionList(statusSchema).parse(
      applyOptionOverrides(
        "lifegroup.gatheringStatuses",
        fileSources["lifegroup.gatheringStatuses"] as never,
        o,
      ),
    ),
  "lifegroup.entryVisibility": (o: OverrideRecord[]) =>
    optionList(entryOptionSchema).parse(
      applyOptionOverrides(
        "lifegroup.entryVisibility",
        fileSources["lifegroup.entryVisibility"] as never,
        o,
      ),
    ),

  "meetings.types": (o: OverrideRecord[]) =>
    optionList(optionSchema).parse(
      applyOptionOverrides("meetings.types", fileSources["meetings.types"] as never, o),
    ),
  "meetings.noteTypes": (o: OverrideRecord[]) =>
    optionList(optionSchema).parse(
      applyOptionOverrides("meetings.noteTypes", fileSources["meetings.noteTypes"] as never, o),
    ),

  "information.categories": (o: OverrideRecord[]) =>
    optionList(optionSchema.passthrough()).parse(
      applyOptionOverrides(
        "information.categories",
        fileSources["information.categories"] as never,
        o,
      ),
    ),
  "organization.groupTypes": (o: OverrideRecord[]) =>
    optionList(optionSchema).parse(
      applyOptionOverrides(
        "organization.groupTypes",
        fileSources["organization.groupTypes"] as never,
        o,
      ),
    ),
  "organization.assignmentFunctions": (o: OverrideRecord[]) =>
    optionList(optionSchema).parse(
      applyOptionOverrides(
        "organization.assignmentFunctions",
        fileSources["organization.assignmentFunctions"] as never,
        o,
      ),
    ),
  "people.roles": (o: OverrideRecord[]) =>
    optionList(roleOptionSchema.passthrough()).parse(
      applyOptionOverrides("people.roles", fileSources["people.roles"] as never, o),
    ),
} as const;

export type Namespace = keyof typeof namespaces;

type Loaded = { [K in Namespace]: ReturnType<(typeof namespaces)[K]> };

const cache = new Map<Namespace, unknown>();

/**
 * What an administrator has changed.
 *
 * Empty until something supplies it. The server loads it from the database at
 * the start of a request; the browser receives it with the session. Nothing
 * *reads* configuration differently as a result — which is the point of
 * putting a registry in front of it.
 */
let overrides: OverrideRecord[] = [];

/** Replace the override set and drop the cache. Both sides call this. */
export function applyOverrides(next: OverrideRecord[]): void {
  overrides = next;
  cache.clear();
}

/** What is currently laid over the files. For the admin screen to show. */
export function currentOverrides(): OverrideRecord[] {
  return overrides;
}

/**
 * Read one namespace.
 *
 * Cached after the first read: configuration is loaded once per process, and a
 * database-backed implementation would invalidate this cache rather than
 * change any caller.
 */
export function get<K extends Namespace>(namespace: K): Loaded[K] {
  const cached = cache.get(namespace);
  if (cached !== undefined) return cached as Loaded[K];

  try {
    const value = namespaces[namespace](overrides);
    cache.set(namespace, value);
    return value as Loaded[K];
  } catch (error) {
    /* Named, so the failure says which configuration is wrong rather than
       leaving somebody to find it by elimination. */
    throw new Error(
      `Configuration "${namespace}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Validate everything. Called by a test, and by anything that wants to fail early. */
export function validateAll(): Namespace[] {
  const checked: Namespace[] = [];
  for (const namespace of Object.keys(namespaces) as Namespace[]) {
    get(namespace);
    checked.push(namespace);
  }
  return checked;
}

/** Drop the cache. For tests, and for a future administrative save. */
export function reload(): void {
  cache.clear();
}

/** Back to what shipped. Used by tests, and by "reset to default". */
export function resetOverrides(): void {
  overrides = [];
  cache.clear();
}

/* ------------------------------------------------------------- shorthands */

/** What is offered now: active options, in their configured order. */
export function options<K extends Namespace>(
  namespace: K,
): Loaded[K] extends readonly OptionDefinition[] ? OptionDefinition[] : never {
  const list = get(namespace) as unknown as OptionDefinition[];
  return [...list]
    .filter((option) => option.active !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) as never;
}

/**
 * One option by id — **including inactive ones**.
 *
 * A record filed under a category that was later deactivated still has to
 * render its name. Deactivating stops something being offered; it never
 * rewrites history.
 */
export function option<K extends Namespace>(
  namespace: K,
  id: string,
): OptionDefinition | undefined {
  return (get(namespace) as unknown as OptionDefinition[]).find((value) => value.id === id);
}

/** The label for an id, falling back to the id so nothing renders as blank. */
export function label<K extends Namespace>(namespace: K, id: string): string {
  return option(namespace, id)?.label ?? id;
}

/** A label map, for the `Record<Id, string>` shape the interface already uses. */
export function labels<K extends Namespace>(namespace: K): Record<string, string> {
  return Object.fromEntries(
    (get(namespace) as unknown as OptionDefinition[]).map((value) => [value.id, value.label]),
  );
}

/** What a status *means*. Presentation is the design system's to decide. */
export function semanticOf<K extends Namespace>(namespace: K, id: string): SemanticState {
  const found = (get(namespace) as unknown as StatusDefinition[]).find((value) => value.id === id);
  return found?.semanticState ?? "neutral";
}

/** Typed accessors for the values read most often. */
export const config = {
  get site(): SiteConfig {
    return get("site.profile");
  },
  get cadence(): CadenceConfig {
    return get("site.cadence");
  },
  get,
  options,
  option,
  label,
  labels,
  semanticOf,
  validateAll,
  reload,
  applyOverrides,
  currentOverrides,
  resetOverrides,
};
