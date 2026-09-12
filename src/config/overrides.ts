import type { OptionDefinition } from "./schema";

/**
 * Laying an administrator's decisions over what the product shipped.
 *
 * An override changes **how a value reads and whether it is offered**. It
 * never changes an option's `id`, because that id is written on every
 * historical record: renaming it would quietly detach them. Renaming is what
 * `label` is for, which is the whole reason ids and labels were separated.
 *
 * Unknown ids in the stored overrides are ignored rather than added. An
 * override is an edit to something that exists; if an upgrade removed an
 * option, its leftover override is noise, not a definition.
 */

export interface OverrideRecord {
  namespace: string;
  optionId?: string;
  field?: string;
  value: unknown;
  /** True when this record defines an option rather than patching one. */
  isAddition?: boolean;
}

/** Fields of an option an administrator may change. Nothing else. */
const EDITABLE = new Set(["label", "description", "active", "sortOrder"]);

/**
 * Fields only certain vocabularies allow, because only there do they mean
 * anything.
 *
 * `capabilities` on an access role is the one that matters: a role **is** a
 * named bundle of capabilities, so a role whose bundle could not be changed
 * would be a name with the product's opinion permanently inside it. What may
 * go in the bundle is still closed — the registry validator drops anything
 * the application does not implement — so this widens who may act only in the
 * ways the application already knows how to enforce, and only for an
 * administrator.
 */
const EDITABLE_BY_NAMESPACE: Record<string, Set<string>> = {
  "people.roles": new Set(["capabilities"]),
};

const editableIn = (namespace: string, field: string) =>
  EDITABLE.has(field) || (EDITABLE_BY_NAMESPACE[namespace]?.has(field) ?? false);

export function applyOptionOverrides<T extends OptionDefinition>(
  namespace: string,
  options: T[],
  overrides: OverrideRecord[],
): T[] {
  const forNamespace = overrides.filter(
    (override) => override.namespace === namespace && override.optionId,
  );
  if (forNamespace.length === 0) return options;

  /*
   * Options an administrator added.
   *
   * Appended first so that a patch written against one of them applies in the
   * same pass. The service decides *which* vocabularies may be added to at
   * all — most cannot, because their ids are written into schema constraints
   * and into code that switches on them.
   */
  const added = forNamespace
    .filter((override) => override.isAddition)
    .filter((override) => !options.some((option) => option.id === override.optionId))
    .map((override) => {
      const patch = (override.value ?? {}) as Record<string, unknown>;
      return {
        ...patch,
        id: override.optionId!,
        active: patch["active"] !== false,
      } as unknown as T;
    });

  options = [...options, ...added];

  const byId = new Map<string, Record<string, unknown>>();
  for (const override of forNamespace) {
    const patch = override.value;
    if (!patch || typeof patch !== "object") continue;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (editableIn(namespace, key)) clean[key] = value;
    }
    byId.set(override.optionId!, { ...(byId.get(override.optionId!) ?? {}), ...clean });
  }

  return options.map((option) => {
    const patch = byId.get(option.id);
    return patch ? ({ ...option, ...patch } as T) : option;
  });
}

/** The same, for a namespace that is a set of scalars rather than a list. */
export function applyScalarOverrides<T extends Record<string, unknown>>(
  namespace: string,
  value: T,
  overrides: OverrideRecord[],
): T {
  const patch: Record<string, unknown> = {};
  for (const override of overrides) {
    if (override.namespace !== namespace || !override.field) continue;
    /* Only keys the shipped configuration actually has: an override cannot
       invent a setting the application does not read. */
    if (override.field in value) patch[override.field] = override.value;
  }
  return Object.keys(patch).length > 0 ? { ...value, ...patch } : value;
}
