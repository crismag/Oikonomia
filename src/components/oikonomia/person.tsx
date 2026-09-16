import type { AreaId } from "@/domain/appearance";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
};

const avatarAreas: AreaId[] = [
  "plan",
  "meet",
  "reach",
  "reports",
  "goals",
  "life",
  "ministry",
  "lead",
];

const hashOf = (text: string) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
};

export function PersonAvatar({
  personId,
  size = "md",
  className,
}: {
  personId: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const { personById } = useOrganization();
  const person = personById(personId);
  return (
    <span
      title={`${person.name}${person.role ? ` · ${person.role}` : ""}`}
      /* A colour of their own, the same every time, so a face is easier to
         pick out of a list. It says nothing about the person. */
      data-area={avatarAreas[hashOf(person.id) % avatarAreas.length]}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-area font-semibold text-on-area",
        sizes[size],
        className,
      )}
    >
      {person.initials}
    </span>
  );
}

export function PersonName({
  personId,
  withRole,
  className,
}: {
  personId: string;
  withRole?: boolean;
  className?: string;
}) {
  const { personById } = useOrganization();
  const person = personById(personId);
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {person.name}
      {withRole && person.role ? (
        <span className="text-muted-foreground"> · {person.role}</span>
      ) : null}
    </span>
  );
}

/** Overlapping stack for reviewers/participants. Caps at four plus a count. */
export function PersonStack({
  personIds,
  max = 4,
  className,
}: {
  personIds: string[];
  max?: number;
  className?: string;
}) {
  const shown = personIds.slice(0, max);
  const rest = personIds.length - shown.length;

  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((id) => (
        <PersonAvatar
          key={id}
          personId={id}
          size="sm"
          className="-ml-1.5 ring-2 ring-surface first:ml-0"
        />
      ))}
      {rest > 0 ? (
        <span className="-ml-1.5 grid size-6 place-items-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-surface">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
