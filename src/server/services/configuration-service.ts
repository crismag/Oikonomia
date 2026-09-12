import { text } from "@/config/messages";
import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  accessStrategies,
  applyOverrides,
  entryStrategies,
  config,
  currentOverrides,
  knownCapabilities,
  option,
  options,
  type Namespace,
} from "@/config";
import type {
  ConfigurationChange,
  ConfigurationRepository,
} from "../repositories/configuration-repository";
import { statusBehaviorSchema } from "@/config/schema";
import type { CadenceConfig, SiteConfig } from "@/config/schema";
import type { Viewer } from "@/domain/viewer";

/**
 * Managing configuration.
 *
 * ## What may be changed
 *
 * A label, a description, whether an option is offered, and where it sits in a
 * list. That is the whole surface, and it is deliberately small:
 *
 * - **Ids are never editable.** Every historical record stores one. Renaming
 *   "in-progress" would detach them silently, which is exactly the failure
 *   separating ids from labels was meant to prevent.
 * - **Semantics are never editable.** What `restricted` *means*, what a role
 *   may do, whether a status is terminal — those are behaviour, and a
 *   configuration screen that could change them would be an authorization
 *   screen wearing a disguise.
 *
 * ## Deactivate rather than delete
 *
 * There is no delete. An option with three hundred records behind it must keep
 * rendering its name; deactivating stops it being *offered* and leaves history
 * legible. `clear` removes an **override**, restoring what shipped — which is
 * "reset to default", not deletion.
 *
 * ## Every change is recorded
 *
 * Renaming a status changes a word on every page that shows it. "Who called it
 * Reviewed?" has to be answerable a year later, so the previous value is kept.
 */

/** Namespaces an administrator may edit. */
const EDITABLE_NAMESPACES: Namespace[] = [
  "site.profile",
  "site.cadence",
  "reports.statuses",
  "reports.visibility",
  "work.statuses",
  "goals.statuses",
  "lifegroup.attendance",
  "lifegroup.gatheringStatuses",
  "lifegroup.entryVisibility",
  "meetings.types",
  "meetings.noteTypes",
  "information.categories",
  "people.roles",
];

/**
 * Vocabularies an administrator may **add to**, and why only these.
 *
 * Adding a value is only honest where the application can actually carry it:
 * the column must accept it, and the code must read it generically rather
 * than switching on it. Everywhere else, a new option would be one nothing
 * can set and nothing knows how to handle — a control that looks operational
 * and is not.
 *
 * | Vocabulary | Why |
 * | --- | --- |
 * | `meetings.types` | `meeting_note.meeting_type` is free text, used as a label and a filter |
 * | `information.categories` | `category` is free text on entries and reports; code asks `triggersAttention(id)`, never `id === "..."` |
 * | `reports.visibility` | each choice names an access strategy the code owns |
 * | `people.roles` | a role names a bundle of capabilities the code owns |
 * | `reports.statuses` | a stage names behaviours the code owns, and a move is derived from them |
 *
 * Work statuses, goal statuses, attendance and note types are still pinned by
 * a CHECK constraint **and** by logic that turns on the id. Those are product
 * structure wearing a label, and the label is the only part a church may
 * change. Each of the five above earned its place by having that coupling
 * removed first — never by loosening the list.
 */
const ADDABLE_NAMESPACES: Namespace[] = [
  "meetings.types",
  "information.categories",
  /*
   * Audience choices are addable because an added one cannot invent access.
   *
   * It names one of the application's **access strategies** — a closed set the
   * code owns — and the strategy decides everything. A church may add
   * "Pastoral team" and say it behaves like `named-people`; it may not say
   * what `named-people` means. That is the line: configuration chooses among
   * capabilities, and never writes one.
   */
  "reports.visibility",
  /*
   * Access roles are addable because a role does not *have* permissions — it
   * **names a bundle** of them. The capabilities in the bundle are a closed
   * set the code owns, each one a rule somebody wrote; an added role starts
   * with none and receives only what an administrator ticks. So a church may
   * say "Regional Overseer behaves like campus oversight"; it may not say what
   * campus oversight means, and it may not invent a fourth permission.
   */
  "people.roles",
  /*
   * Report stages became addable when the four named actions went away.
   *
   * Publishing, sharing, archiving and reopening used to be four branches with
   * four hard-coded target ids, so a fifth stage was unreachable by
   * construction — and migration 022 kept a CHECK on the column for exactly
   * that reason. A move is now derived from the **behaviours** of the two
   * stages (`planTransition`), migration 024 removed the CHECK, and an added
   * stage has to say what it behaves like.
   */
  "reports.statuses",
  /*
   * Entry audiences are addable for the same reason report audiences are: an
   * added choice names one of the application's **entry strategies** and the
   * strategy decides everything. Migration 026 removed the CHECK that used to
   * make this a lie.
   */
  "lifegroup.entryVisibility",
];

const addOption = z.object({
  namespace: z.string().min(1),
  label: z.string().trim().min(1, "Give it a name.").max(120),
  description: z.string().trim().max(400).optional(),
  /** Categories only: whether a record in this category asks to be looked at. */
  attentionTrigger: z.boolean().optional(),
  /** Audience choices only: which access strategy this choice uses. */
  accessStrategy: z.enum(accessStrategies).optional(),
  /** Access roles only: which of the application's permissions the bundle holds. */
  capabilities: z.array(z.enum(knownCapabilities)).optional(),
  /** Report stages only: what the stage does, which is what a move reads. */
  behaviors: statusBehaviorSchema.optional(),
  /** Entry audiences only: which entry strategy this choice uses. */
  entryStrategy: z.enum(entryStrategies).optional(),
});

const optionPatch = z.object({
  namespace: z.string().min(1),
  optionId: z.string().min(1),
  label: z.string().trim().min(1, "A label cannot be empty.").max(120).optional(),
  description: z.string().trim().max(400).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  /**
   * Access roles only.
   *
   * `z.enum` and not `z.string()`: a capability the application does not
   * implement is not a permission that does nothing, it is a refusal. The
   * registry drops unknown ones too, so a hand-edited row is harmless; this
   * makes a mistyped one visible instead.
   */
  capabilities: z.array(z.enum(knownCapabilities)).optional(),
});

const scalarPatch = z.object({
  namespace: z.enum(["site.profile", "site.cadence"]),
  field: z.string().trim().min(1),
  value: z.union([z.string().trim().max(200), z.number(), z.boolean()]),
});

/** What the administration screen is handed. Typed, so it can cross the wire. */
export interface AdminConfiguration {
  namespaces: ConfigurationView[];
  site: SiteConfig;
  cadence: CadenceConfig;
}

export interface ConfigurationView {
  namespace: Namespace;
  label: string;
  description: string;
  /** Whether this vocabulary accepts a new value at all. */
  addable: boolean;
  /** Said on screen when it does not, so the absence is explained. */
  fixedReason?: string;
  /** Every option, including ones no longer offered. */
  options: {
    id: string;
    label: string;
    description?: string;
    active: boolean;
    sortOrder?: number;
    semanticState?: string;
    /** Access roles only: the permissions in this bundle. */
    capabilities?: string[];
    /** True when an administrator has changed this one. */
    overridden: boolean;
  }[];
}

/**
 * Why a list cannot take a new value — said accurately, per list.
 *
 * A generic sentence was wrong as soon as the architecture improved: report
 * statuses now carry their meaning in configuration, so the reason is no
 * longer "nothing would understand it" but "nothing could reach it".
 */
const DEFAULT_FIXED_REASON =
  "These values are part of the product: the record stores them and the rules act on them. You can rename one, or make it unavailable for new records.";

const FIXED_REASONS: Partial<Record<string, string>> = {
  "work.statuses":
    "A work record moves through a review process, and each step carries a rule of its own — who may take it, which one requires a note, and that every review step is refused on a record nobody asked to have reviewed. A new state would have no step that reaches it and none that leaves. What each state *means* for a list — still open, still editable — is configuration, and you can rename any of them.",
  "goals.statuses":
    "Each of these carries its own field on the record and its own line in the goal's history — when it was completed, when it went on hold. A new state would have nowhere to keep its own date and nothing to say about itself, so the four are fixed while their names are yours.",
  "lifegroup.gatheringStatuses":
    "A gathering's state follows what has happened to it — scheduled, claimed, held, completed. Those steps are the product's; their names are yours.",
  "lifegroup.attendance":
    "Present, absent and excused are what the attendance record stores and what every count is built on.",
  "meetings.noteTypes":
    "A personal note and minutes are enforced differently — who may read one is decided by which it is. That difference is the product's, not a setting.",
};

/** How each namespace is described on the administration screen. */
const DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  "reports.statuses": {
    label: "Report stages",
    description:
      "The stages a report moves through. A stage is what it does — whether its author can still change it, whether its audience can read it, whether it is the record — and moving between two stages does whatever the difference implies.",
  },
  "reports.visibility": {
    label: "Report visibility",
    description:
      "The audience choices a report's author may pick. Each one uses an access strategy the application enforces — you choose which, and what it is called.",
  },
  "work.statuses": { label: "Work statuses", description: "What a work record's state is called." },
  "goals.statuses": { label: "Goal statuses", description: "What a goal's state is called." },
  "lifegroup.attendance": {
    label: "Attendance",
    description: "How a person's presence at a gathering is recorded.",
  },
  "lifegroup.gatheringStatuses": {
    label: "Gathering statuses",
    description: "What a row on the LifeGroup schedule is called at each stage.",
  },
  "lifegroup.entryVisibility": {
    label: "Entry visibility",
    description:
      "The audience choices a leader may pick when writing in a gathering. Each one uses a rule the application enforces — you choose which, and what it is called.",
  },
  "meetings.types": { label: "Meeting types", description: "The kinds of meeting a church holds." },
  "meetings.noteTypes": {
    label: "Note types",
    description: "Personal working notes, or the meeting's own record.",
  },
  "information.categories": {
    label: "Information categories",
    description:
      "What kind of information an entry or report is. Whether a category asks for attention is part of the product.",
  },
  "people.roles": {
    label: "Access roles",
    description:
      "A named bundle of the permissions the application enforces. You choose which permissions are in a bundle; the permissions themselves are part of the product.",
  },
};

/** "Safeguarding concern" → `safeguarding-concern`. Fixed once, forever. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function createConfigurationService(repo: ConfigurationRepository) {
  /** Load what has been changed and hand it to the registry for this process. */
  function refresh(): void {
    applyOverrides(repo.all());
  }

  const requireAdmin = (viewer: Viewer) => {
    if (!viewer.persona.capabilities.includes("administration")) {
      throw ApiError.forbidden(text("refusal.configuration.admin"));
    }
  };

  /**
   * Nobody may lock the church out of its own installation.
   *
   * Removing `administration` from the last role that has it — or deactivating
   * that role — would leave an installation nobody can administer and no way
   * back in, because the only screen that could undo it is the one that just
   * closed. Refused, and refused *before* the write, so the failure is a
   * message rather than a recovery.
   */
  const guardAdministrationSurvives = (optionId: string, merged: Record<string, unknown>) => {
    const after = (options("people.roles") as { id: string; capabilities?: string[] }[])
      .map((role) =>
        role.id === optionId
          ? {
              id: role.id,
              active: merged["active"] !== false,
              capabilities: (merged["capabilities"] as string[] | undefined) ?? role.capabilities,
            }
          : { id: role.id, active: true, capabilities: role.capabilities },
      )
      .filter((role) => role.active);

    if (!after.some((role) => (role.capabilities ?? []).includes("administration"))) {
      throw ApiError.conflict(
        "At least one role has to be able to administer Oikonomia. Give another role that permission first.",
      );
    }
  };

  const requireEditable = (namespace: string): Namespace => {
    if (!EDITABLE_NAMESPACES.includes(namespace as Namespace)) {
      throw ApiError.forbidden("That configuration is part of the product, not a setting.");
    }
    return namespace as Namespace;
  };

  return {
    refresh,

    /** Everything editable, as the administration screen shows it. */
    all(viewer: Viewer): AdminConfiguration {
      requireAdmin(viewer);
      refresh();

      const overridden = new Set(
        currentOverrides()
          .filter((entry: { optionId?: string }) => entry.optionId)
          .map(
            (entry: { namespace: string; optionId?: string }) =>
              `${entry.namespace}:${entry.optionId}`,
          ),
      );

      const views = EDITABLE_NAMESPACES.filter((namespace) => namespace in DESCRIPTIONS).map(
        (namespace): ConfigurationView => {
          const list = config.get(namespace) as unknown as {
            id: string;
            label: string;
            description?: string;
            active?: boolean;
            sortOrder?: number;
            semanticState?: string;
            capabilities?: string[];
          }[];

          const addable = ADDABLE_NAMESPACES.includes(namespace);

          return {
            namespace,
            label: DESCRIPTIONS[namespace]!.label,
            description: DESCRIPTIONS[namespace]!.description,
            addable,
            ...(addable ? {} : { fixedReason: FIXED_REASONS[namespace] ?? DEFAULT_FIXED_REASON }),
            options: list.map((entry) => ({
              id: entry.id,
              label: entry.label,
              ...(entry.description ? { description: entry.description } : {}),
              active: entry.active !== false,
              ...(entry.sortOrder !== undefined ? { sortOrder: entry.sortOrder } : {}),
              ...(entry.semanticState ? { semanticState: entry.semanticState } : {}),
              ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
              overridden: overridden.has(`${namespace}:${entry.id}`),
            })),
          };
        },
      );

      return { namespaces: views, site: config.site, cadence: config.cadence };
    },

    /** Which vocabularies accept a new value. The screen asks before offering. */
    addable: (namespace: string): boolean => ADDABLE_NAMESPACES.includes(namespace as Namespace),

    /**
     * Add an option.
     *
     * Refused for every vocabulary whose values are part of the product. The
     * id is derived from the label once and then fixed forever — it is what
     * records will store, and the whole point of separating it from the label
     * is that renaming later changes nothing underneath.
     */
    addOption(viewer: Viewer, input: unknown): { id: string; label: string } {
      requireAdmin(viewer);
      const parsed = parse(addOption, input) as z.infer<typeof addOption>;
      const namespace = requireEditable(parsed.namespace);

      if (!ADDABLE_NAMESPACES.includes(namespace)) {
        throw ApiError.forbidden(
          "The values in this list are part of the product. You can rename them, and stop offering one, but a new value would be one nothing can use.",
        );
      }

      const id = slug(parsed.label);
      if (!id) throw ApiError.validation({ label: "Use a name with letters or numbers in it." });

      refresh();
      if (option(namespace, id)) {
        throw ApiError.conflict("Something with that name is already on the list.");
      }

      /* Added options go to the end of the list, not the front. Without a
         sort order they would sort as 0 and jump ahead of everything the
         product ships with, which is not what "add" means. */
      const last = Math.max(
        0,
        ...(config.get(namespace) as unknown as { sortOrder?: number }[]).map(
          (existing) => existing.sortOrder ?? 0,
        ),
      );

      /*
       * An audience choice must say how it is enforced, and the answer must be
       * one of the application's own strategies. Refusing here rather than
       * defaulting is deliberate: a default would be a guess about access.
       */
      if (namespace === "reports.visibility" && !parsed.accessStrategy) {
        throw ApiError.validation({
          accessStrategy: "Say how this audience is enforced.",
        });
      }

      /*
       * A stage has to say what it does. Defaulting would be a guess about
       * whether a report can still be edited and who can see it — the two
       * questions the whole module turns on.
       */
      if (namespace === "reports.statuses" && !parsed.behaviors) {
        throw ApiError.validation({ behaviors: "Say what this stage does." });
      }

      /* Same refusal, same reason: an audience that named no strategy would be
         a guess about who may read a prayer request. */
      if (namespace === "lifegroup.entryVisibility" && !parsed.entryStrategy) {
        throw ApiError.validation({ entryStrategy: "Say how this audience is enforced." });
      }

      const value: Record<string, unknown> = {
        label: parsed.label,
        active: true,
        sortOrder: last + 1,
        ...(parsed.description ? { description: parsed.description } : {}),
        /* A category's attention trigger is the product-meaningful part, and
           the one thing worth an administrator's judgement. Everywhere else it
           is absent, because nothing reads it. */
        ...(namespace === "information.categories"
          ? { attentionTrigger: parsed.attentionTrigger ?? false, contexts: ["entry", "report"] }
          : {}),
        ...(namespace === "reports.visibility" ? { accessStrategy: parsed.accessStrategy } : {}),
        /* A new role starts with whatever was ticked, and nothing is ticked by
           default: a bundle that granted something nobody chose would be the
           accidental widening this whole design exists to prevent. */
        ...(namespace === "people.roles" ? { capabilities: parsed.capabilities ?? [] } : {}),
        ...(namespace === "reports.statuses"
          ? { behaviors: parsed.behaviors, semanticState: "neutral", terminal: false }
          : {}),
        ...(namespace === "lifegroup.entryVisibility"
          ? { entryStrategy: parsed.entryStrategy }
          : {}),
      };

      repo.set({ namespace, optionId: id, value, isAddition: true, actorId: viewer.person.id });
      repo.record({
        actorId: viewer.person.id,
        namespace,
        optionId: id,
        after: value as never,
        summary: `Added “${parsed.label}”`,
      });

      refresh();
      return { id, label: parsed.label };
    },

    /** Rename one, reword it, reorder it, or stop offering it. */
    setOption(viewer: Viewer, input: unknown): ConfigurationView["options"][number] {
      requireAdmin(viewer);
      const patch = parse(optionPatch, input);
      const namespace = requireEditable(patch.namespace);

      refresh();
      const before = option(namespace, patch.optionId);
      if (!before) throw ApiError.notFound("That option");

      const existing = repo.find(namespace, patch.optionId)?.value;
      const merged = {
        ...(typeof existing === "object" && existing ? existing : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
      };

      if (namespace === "people.roles") guardAdministrationSurvives(patch.optionId, merged);

      repo.set({
        namespace,
        optionId: patch.optionId,
        value: merged,
        actorId: viewer.person.id,
      });
      repo.record({
        actorId: viewer.person.id,
        namespace,
        optionId: patch.optionId,
        before: { label: before.label, active: before.active !== false },
        after: merged,
        summary:
          patch.label && patch.label !== before.label
            ? `Renamed “${before.label}” to “${patch.label}”`
            : patch.active === false
              ? `Stopped offering “${before.label}”`
              : patch.active === true
                ? `Offered “${before.label}” again`
                : `Changed “${before.label}”`,
      });

      refresh();
      const after = option(namespace, patch.optionId)!;
      return {
        id: after.id,
        label: after.label,
        ...(after.description ? { description: after.description } : {}),
        active: after.active !== false,
        overridden: true,
      };
    },

    /** A site or cadence value: page size, week start, the "due soon" window. */
    setValue(viewer: Viewer, input: unknown): void {
      requireAdmin(viewer);
      const patch = parse(scalarPatch, input);

      refresh();
      const current = (patch.namespace === "site.profile" ? config.site : config.cadence) as Record<
        string,
        unknown
      >;
      if (!(patch.field in current)) {
        throw ApiError.notFound("That setting");
      }

      repo.set({
        namespace: patch.namespace,
        field: patch.field,
        value: patch.value,
        actorId: viewer.person.id,
      });
      repo.record({
        actorId: viewer.person.id,
        namespace: patch.namespace,
        field: patch.field,
        before: current[patch.field] as string | number | boolean,
        after: patch.value,
        summary: `Set ${patch.field} to ${String(patch.value)}`,
      });
      refresh();
    },

    /**
     * Back to what shipped.
     *
     * Forgets the override rather than writing the old value back — which is
     * why an upgrade that improves the default wording reaches a church that
     * had reset, and leaves alone one that had decided otherwise.
     */
    reset(viewer: Viewer, namespace: string, optionId?: string, field?: string): void {
      requireAdmin(viewer);
      const checked = requireEditable(namespace);

      refresh();
      const before = optionId ? option(checked, optionId)?.label : undefined;
      repo.clear(checked, optionId, field);
      repo.record({
        actorId: viewer.person.id,
        namespace: checked,
        ...(optionId ? { optionId } : {}),
        ...(field ? { field } : {}),
        after: "default",
        summary: before ? `Reset “${before}” to its default` : `Reset ${field ?? checked}`,
      });
      refresh();
    },

    /** What was changed, by whom. Configuration changes are quiet and wide. */
    history(viewer: Viewer, limit = 50): ConfigurationChange[] {
      requireAdmin(viewer);
      return repo.history(limit);
    },

    /**
     * What an option is used by, before somebody stops offering it.
     *
     * Counting is the caller's job — this service does not know every table.
     * What it guarantees is that the screen asks before it hides something.
     */
    offeredOptions(namespace: Namespace) {
      refresh();
      return options(namespace);
    },
  };
}

export type ConfigurationService = ReturnType<typeof createConfigurationService>;
