import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Mail, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstallationNotice, useInstallationRestricted } from "./installation-notice";
import { Section } from "./section";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import {
  addCampus,
  addGroup,
  addMinistry,
  addPerson,
  addVenue,
  setGroupMembership,
  updateGroup,
  updateMinistry,
  updatePerson,
  type PersonRecord,
} from "@/lib/organization-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { currentRoles } from "@/domain/roles";
import { inviteToOikonomia } from "@/lib/auth-api";
import { notify } from "@/config/messages/handlers";
import { config } from "@/config";
import { groupTypeLabel } from "@/domain/assignment";
import type { Ministry } from "@/domain/types";
import { useViewer } from "@/domain/session";
import {
  venueTypeLabel,
  type PersonaId,
  type ResponsibilityGroup,
  type VenueType,
} from "@/domain/types";

/**
 * Entering the organisation.
 *
 * Somebody has to be able to say who is in this church, what its ministries
 * are and where its campuses stand — otherwise the only way the application
 * could have any of that is for it to arrive with a church already in it,
 * which is what this replaced.
 *
 * Administrative, and refused in the service as well as hidden here: a leader
 * who reached this component would still be told no by the server.
 *
 * Venues are the exception and are added where they are used — arranging next
 * Thursday's gathering at somebody's home should not require an administrator.
 */

function useOrganizationWrite() {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: () => {
      /* Everything on every page names people and ministries, so a new one is
         not "a row in a list" — it is context the whole application reads. */
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
    onError: (error) => setFailure(errorMessage(error)),
    networkMode: "always" as const,
    retry: 0,
  });

  return {
    failure,
    busy: mutation.isPending,
    run: (work: () => Promise<unknown>, then?: () => void) => {
      setFailure(null);
      void mutation
        .mutateAsync(work)
        .then(() => then?.())
        .catch(() => {
          /* Rendered from `failure`. */
        });
    },
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "";
  onChange: (value: T | "") => void;
  options: { id: T; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
      >
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Who is in one responsibility group.
 *
 * Membership is the whole point of the record: a group marked as a leadership
 * audience decides who a confidential report reaches, so this list is an
 * access control list wearing ordinary clothes. It says so.
 */
function GroupMembers({
  group,
  write,
}: {
  group: ResponsibilityGroup;
  write: ReturnType<typeof useOrganizationWrite>;
}) {
  const organization = useOrganization();
  const { persona } = useViewer();
  const [adding, setAdding] = useState("");

  /* Only people who are here now may be added to a body of responsibility;
     somebody already in one stays in it, and stays named. Never yourself:
     another administrator decides where you belong. */
  const candidates = organization.activePeople.filter(
    (person) => !group.memberIds.includes(person.id) && person.id !== persona.personId,
  );

  return (
    <div className="mt-2 space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {group.memberIds.map((id) => (
          <li
            key={id}
            className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px]"
          >
            {organization.personById(id).name}
            <button
              type="button"
              disabled={write.busy}
              aria-label={`Remove ${organization.personById(id).name} from ${group.name}`}
              onClick={() =>
                write.run(() =>
                  setGroupMembership({
                    data: { groupId: group.id, personId: id, member: false },
                  }),
                )
              }
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        ))}
        {group.memberIds.length === 0 ? (
          <li className="text-[12px] text-muted-foreground">
            Nobody yet. A group with no members is an audience of nobody.
          </li>
        ) : null}
      </ul>

      <div className="flex items-end gap-2">
        <div className="w-full max-w-xs">
          <Choice
            label="Add a member"
            value={adding}
            onChange={setAdding}
            options={candidates.map((person) => ({ id: person.id, label: person.name }))}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={write.busy || !adding}
          onClick={() =>
            write.run(
              () =>
                setGroupMembership({
                  data: { groupId: group.id, personId: adding, member: true },
                }),
              () => setAdding(""),
            )
          }
        >
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * Correcting a person's record.
 *
 * The service could always do this; nothing could reach it. An organisation
 * that can be entered but never corrected is an organisation with a
 * misspelled name in it forever — and worse, a leader who has moved campus, or
 * a reporting line that changed, both of which decide what other people see.
 *
 * Opened in place rather than on a page of its own: the list is where somebody
 * notices the record is wrong.
 */
function PersonEditor({
  person,
  write,
  onDone,
}: {
  person: PersonRecord;
  write: ReturnType<typeof useOrganizationWrite>;
  onDone: () => void;
}) {
  const organization = useOrganization();
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.role);
  const [accessRole, setAccessRole] = useState<PersonaId | "">(person.accessRole);
  const [campusId, setCampusId] = useState(person.campusId);
  const [reportsToId, setReportsToId] = useState(person.reportsToId ?? "");
  const [email, setEmail] = useState(person.email ?? "");

  return (
    <div className="w-full space-y-3 py-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" value={name} onChange={setName} />
        <Field
          label="What they are called here"
          value={role}
          onChange={setRole}
          placeholder="LifeGroup leader"
        />
        {/* Where an invitation goes, and the address they sign in with. There
            was no way to enter one here, which meant the invitation below
            could never become available. */}
        <Field
          label="Email address"
          value={email}
          onChange={setEmail}
          placeholder="them@example.org"
        />
        <Choice
          label="What they may do"
          value={accessRole}
          onChange={setAccessRole}
          options={currentRoles().map((r) => ({ id: r.id as PersonaId, label: r.label }))}
        />
        <Choice
          label="Campus"
          value={campusId}
          onChange={setCampusId}
          options={organization.activeCampuses.map((c) => ({ id: c.id, label: c.name }))}
        />
        <Choice
          label="Reports to"
          value={reportsToId}
          onChange={setReportsToId}
          options={organization.activePeople
            .filter((other) => other.id !== person.id)
            .map((other) => ({ id: other.id, label: other.name }))}
        />
      </div>

      {/*
        Giving somebody a way in.

        Until this existed, only the first person could ever sign in: `/setup`
        created one account, and adding anybody else created a person and no
        account. A church could enter its whole leadership team and none of
        them could get in.

        An invitation creates the account and a link to set a password. It
        grants nothing else — no ministry, no group, no capability. Those stay
        with the confirmed assignments the organisation owns.
      */}
      <div className="rounded-md border border-border bg-surface px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {person.email
            ? "An invitation creates their account and emails a link to set a password. It gives them a way in and nothing else."
            : "Save an email address above first — it is where the invitation goes."}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          disabled={write.busy || !person.email}
          onClick={() =>
            write.run(async () => {
              const result = unwrap(await inviteToOikonomia({ data: { personId: person.id } }));
              notify.show(
                result.delivered
                  ? `An invitation was sent to ${result.email}.`
                  : `${person.name} now has an account. This installation cannot send email, so set their password with npm run auth:set-password.`,
              );
            })
          }
        >
          <Mail className="size-3.5" aria-hidden />
          Invite to Oikonomia
        </Button>
      </div>

      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          disabled={write.busy || !name.trim()}
          onClick={() =>
            write.run(
              () =>
                updatePerson({
                  data: {
                    id: person.id,
                    patch: {
                      name: name.trim(),
                      role: role.trim(),
                      ...(email.trim() ? { email: email.trim() } : {}),
                      ...(accessRole ? { accessRole } : {}),
                      ...(campusId ? { campusId } : {}),
                      ...(reportsToId ? { reportsToId } : {}),
                    },
                  },
                }),
              onDone,
            )
          }
        >
          <Check className="size-3.5" aria-hidden />
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The same, for a ministry. Its lead is the field most likely to change. */
function MinistryEditor({
  ministry,
  write,
  onDone,
}: {
  ministry: Ministry;
  write: ReturnType<typeof useOrganizationWrite>;
  onDone: () => void;
}) {
  const organization = useOrganization();
  const { persona } = useViewer();
  const [name, setName] = useState(ministry.name);
  const [purpose, setPurpose] = useState(ministry.purpose ?? "");
  const [campusId, setCampusId] = useState(ministry.campusId ?? "");
  const [leadId, setLeadId] = useState(ministry.leadId ?? "");

  return (
    <div className="w-full space-y-3 py-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Purpose" value={purpose} onChange={setPurpose} />
        <Choice
          label="Campus"
          value={campusId}
          onChange={setCampusId}
          options={organization.activeCampuses.map((c) => ({ id: c.id, label: c.name }))}
        />
        <Choice
          label="Lead"
          value={leadId}
          onChange={setLeadId}
          options={organization.activePeople
            .filter((p) => p.id !== persona.personId || p.id === ministry.leadId)
            .map((p) => ({ id: p.id, label: p.name }))}
        />
      </div>

      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          disabled={write.busy || !name.trim()}
          onClick={() =>
            write.run(
              () =>
                updateMinistry({
                  data: {
                    id: ministry.id,
                    patch: {
                      name: name.trim(),
                      purpose: purpose.trim(),
                      ...(campusId ? { campusId } : {}),
                      ...(leadId ? { leadId } : {}),
                    },
                  },
                }),
              onDone,
            )
          }
        >
          <Check className="size-3.5" aria-hidden />
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function OrganizationAdmin() {
  const organization = useOrganization();
  const viewer = useViewer();
  const write = useOrganizationWrite();
  /* People themselves — who exists, their name, email and access role — are
     identity. Where they belong (memberships, assignments) is not, and stays
     editable in the sections around this one. */
  const identityRestricted = useInstallationRestricted("identity");

  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupCampus, setGroupCampus] = useState("");
  const [groupType, setGroupType] = useState("team");
  const [groupParent, setGroupParent] = useState("");
  const [groupLeadership, setGroupLeadership] = useState(false);

  const [campusName, setCampusName] = useState("");
  const [campusCity, setCampusCity] = useState("");

  const [personName, setPersonName] = useState("");
  const [personRole, setPersonRole] = useState("");
  const [personAccess, setPersonAccess] = useState<PersonaId | "">("");
  const [personCampus, setPersonCampus] = useState<string | "">("");
  const [personReportsTo, setPersonReportsTo] = useState<string | "">("");

  const [ministryName, setMinistryName] = useState("");
  const [ministryPurpose, setMinistryPurpose] = useState("");
  const [ministryCampus, setMinistryCampus] = useState<string | "">("");
  const [ministryLead, setMinistryLead] = useState<string | "">("");

  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingMinistry, setEditingMinistry] = useState<string | null>(null);

  const [venueName, setVenueName] = useState("");
  const [venueType, setVenueType] = useState<VenueType | "">("");

  return (
    <div className="space-y-4">
      {write.failure ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {write.failure}
        </p>
      ) : null}

      <Section id="campuses" title="Campuses" meta={`${organization.campuses.length}`}>
        <ul className="divide-y divide-border">
          {organization.campuses.map((campus) => (
            <li key={campus.id} className="px-4 py-2.5 text-[14px]">
              {campus.name}
              {campus.city ? <span className="text-muted-foreground"> · {campus.city}</span> : null}
            </li>
          ))}
          {organization.campuses.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              No campuses yet. A campus is a place the church meets; ministries and people are filed
              under one.
            </li>
          ) : null}
        </ul>
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field
            label="Name"
            value={campusName}
            onChange={setCampusName}
            placeholder="Scarborough"
          />
          <Field label="City" value={campusCity} onChange={setCampusCity} placeholder="Toronto" />
          <Button
            type="button"
            variant="secondary"
            disabled={write.busy || !campusName.trim()}
            onClick={() =>
              write.run(
                () =>
                  addCampus({
                    data: {
                      name: campusName.trim(),
                      ...(campusCity.trim() ? { city: campusCity.trim() } : {}),
                    },
                  }),
                () => {
                  setCampusName("");
                  setCampusCity("");
                },
              )
            }
          >
            <Plus className="size-3.5" aria-hidden />
            Add campus
          </Button>
        </div>
      </Section>

      <Section id="people" title="People" meta={`${organization.people.length}`}>
        <InstallationNotice restriction="identity" />
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {organization.people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-2.5">
              {editingPerson === person.id ? (
                <PersonEditor person={person} write={write} onDone={() => setEditingPerson(null)} />
              ) : (
                <>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-area-soft text-[10px] font-medium">
                    {person.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[14px]",
                        person.active === false && "text-disabled",
                      )}
                    >
                      {person.name}
                      {person.active === false ? (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Inactive
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[
                        person.role,
                        config.label("people.roles", person.accessRole),
                        person.reportsToId
                          ? `reports to ${organization.personById(person.reportsToId).name}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={identityRestricted}
                    onClick={() => setEditingPerson(person.id)}
                  >
                    Edit
                  </Button>
                  {/* Deactivating is not deleting: a report they wrote is
                      still a report somebody wrote, and their name keeps
                      resolving everywhere it already appears. */}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={write.busy || identityRestricted}
                    onClick={() =>
                      write.run(() =>
                        updatePerson({
                          data: { id: person.id, patch: { active: person.active === false } },
                        }),
                      )
                    }
                  >
                    {person.active === false ? "Reactivate" : "Deactivate"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          <Field
            label="Name"
            value={personName}
            onChange={setPersonName}
            placeholder="Maria Santos"
          />
          <Field
            label="What they are called here"
            value={personRole}
            onChange={setPersonRole}
            placeholder="LifeGroup leader"
          />
          <Choice
            label="What they may do"
            value={personAccess}
            onChange={setPersonAccess}
            options={currentRoles().map((role) => ({ id: role.id, label: role.label }))}
          />
          <Choice
            label="Campus"
            value={personCampus}
            onChange={setPersonCampus}
            options={organization.activeCampuses.map((campus) => ({
              id: campus.id,
              label: campus.name,
            }))}
          />
          {/*
           * Who they report to. This is what "my reporting leader" resolves
           * through when somebody asks leadership for something — which is why
           * it is a relationship on the record rather than a name copied onto
           * each request.
           */}
          <Choice
            label="Reports to"
            value={personReportsTo}
            onChange={setPersonReportsTo}
            options={organization.activePeople.map((person) => ({
              id: person.id,
              label: person.name,
            }))}
          />
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={write.busy || identityRestricted || !personName.trim()}
              onClick={() =>
                write.run(
                  () =>
                    addPerson({
                      data: {
                        name: personName.trim(),
                        ...(personRole.trim() ? { role: personRole.trim() } : {}),
                        ...(personAccess ? { accessRole: personAccess } : {}),
                        ...(personCampus ? { campusId: personCampus } : {}),
                        ...(personReportsTo ? { reportsToId: personReportsTo } : {}),
                      },
                    }),
                  () => {
                    setPersonName("");
                    setPersonRole("");
                    setPersonAccess("");
                    setPersonReportsTo("");
                  },
                )
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add person
            </Button>
          </div>
        </div>
      </Section>

      <Section id="ministries" title="Ministries" meta={`${organization.ministries.length}`}>
        <ul className="divide-y divide-border">
          {organization.ministries.map((ministry) => (
            <li key={ministry.id} className="flex items-center gap-3 px-4 py-2.5">
              {editingMinistry === ministry.id ? (
                <MinistryEditor
                  ministry={ministry}
                  write={write}
                  onDone={() => setEditingMinistry(null)}
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[14px]",
                        ministry.active === false && "text-disabled",
                      )}
                    >
                      {ministry.name}
                      {ministry.active === false ? (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Inactive
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {ministry.teamIds.length} on the team
                      {ministry.leadId
                        ? ` · led by ${organization.personById(ministry.leadId).name}`
                        : " · no lead yet"}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditingMinistry(ministry.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={write.busy}
                    onClick={() =>
                      write.run(() =>
                        updateMinistry({
                          data: { id: ministry.id, patch: { active: ministry.active === false } },
                        }),
                      )
                    }
                  >
                    {ministry.active === false ? "Reactivate" : "Deactivate"}
                  </Button>
                </>
              )}
            </li>
          ))}
          {organization.ministries.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              No ministries yet. A ministry exists independently of whoever currently leads it, so
              it can be created before a lead is chosen.
            </li>
          ) : null}
        </ul>
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          <Field label="Name" value={ministryName} onChange={setMinistryName} placeholder="Music" />
          <Field
            label="Purpose"
            value={ministryPurpose}
            onChange={setMinistryPurpose}
            placeholder="What this ministry is for"
          />
          <Choice
            label="Campus"
            value={ministryCampus}
            onChange={setMinistryCampus}
            options={organization.activeCampuses.map((campus) => ({
              id: campus.id,
              label: campus.name,
            }))}
          />
          <Choice
            label="Lead"
            value={ministryLead}
            onChange={setMinistryLead}
            options={organization.activePeople
              .filter((person) => person.id !== viewer.persona.personId)
              .map((person) => ({
                id: person.id,
                label: person.name,
              }))}
          />
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={write.busy || !ministryName.trim()}
              onClick={() =>
                write.run(
                  () =>
                    addMinistry({
                      data: {
                        name: ministryName.trim(),
                        ...(ministryPurpose.trim() ? { purpose: ministryPurpose.trim() } : {}),
                        ...(ministryCampus ? { campusId: ministryCampus } : {}),
                        ...(ministryLead ? { leadId: ministryLead } : {}),
                      },
                    }),
                  () => {
                    setMinistryName("");
                    setMinistryPurpose("");
                    setMinistryLead("");
                  },
                )
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add ministry
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Responsibility groups" meta={`${organization.groups.length}`}>
        <p className="px-4 pb-1 pt-3 text-[12px] text-muted-foreground">
          A group is a body the church answers through — an eldership, a campus leadership team.
          Marking one as the leadership audience is what decides who a report set to
          &ldquo;leadership&rdquo; reaches, so it is an access decision and not a label.
        </p>
        <ul className="divide-y divide-border">
          {organization.groups.map((group) => (
            <li key={group.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-[14px]">{group.name}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {groupTypeLabel(group.groupType)}
                    {" · "}
                    {group.campusId
                      ? (organization.campusById(group.campusId)?.name ?? "Unknown campus")
                      : "Whole church"}
                    {group.parentGroupId
                      ? ` · under ${organization.groupById(group.parentGroupId)?.name ?? "another group"}`
                      : ""}
                    {group.leadershipAudience ? " · Leadership audience" : ""}
                    {group.active ? "" : " · Inactive"}
                  </span>
                  {group.description ? (
                    <span className="block text-[12px] text-muted-foreground">
                      {group.description}
                    </span>
                  ) : null}
                </div>
                {/* Deactivating is not deleting: past reports were addressed to
                    this group and must keep meaning what they meant. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={write.busy}
                  onClick={() =>
                    write.run(() =>
                      updateGroup({ data: { id: group.id, patch: { active: !group.active } } }),
                    )
                  }
                >
                  {group.active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
              <GroupMembers group={group} write={write} />
            </li>
          ))}
          {organization.groups.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              No groups yet. Until one is marked as the leadership audience, a report set to
              &ldquo;leadership&rdquo; reaches only its author.
            </li>
          ) : null}
        </ul>
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          <Field label="Name" value={groupName} onChange={setGroupName} placeholder="Elders" />
          <Field
            label="What it answers for"
            value={groupDescription}
            onChange={setGroupDescription}
            placeholder="Optional"
          />
          <Choice
            label="Kind of group"
            value={groupType}
            onChange={setGroupType}
            options={config
              .options("organization.groupTypes")
              .map((option) => ({ id: option.id, label: option.label }))}
          />
          <Choice
            label="Campus"
            value={groupCampus}
            onChange={setGroupCampus}
            options={organization.activeCampuses.map((campus) => ({
              id: campus.id,
              label: campus.name,
            }))}
          />
          {/* Structure only. Nothing is inherited through it — a member of a
              team is not thereby a member of its parent. */}
          <Choice
            label="Sits under"
            value={groupParent}
            onChange={setGroupParent}
            options={organization.groups
              .filter((candidate) => candidate.active)
              .map((candidate) => ({ id: candidate.id, label: candidate.name }))}
          />
          <label className="flex items-end gap-2 pb-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={groupLeadership}
              onChange={(e) => setGroupLeadership(e.target.checked)}
              className="size-4"
            />
            <span>Reports set to &ldquo;leadership&rdquo; reach this group</span>
          </label>
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={write.busy || !groupName.trim()}
              onClick={() =>
                write.run(
                  () =>
                    addGroup({
                      data: {
                        name: groupName.trim(),
                        ...(groupDescription.trim()
                          ? { description: groupDescription.trim() }
                          : {}),
                        ...(groupCampus ? { campusId: groupCampus } : {}),
                        ...(groupType ? { groupType } : {}),
                        ...(groupParent ? { parentGroupId: groupParent } : {}),
                        leadershipAudience: groupLeadership,
                      },
                    }),
                  () => {
                    setGroupName("");
                    setGroupDescription("");
                    setGroupCampus("");
                    setGroupType("team");
                    setGroupParent("");
                    setGroupLeadership(false);
                  },
                )
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add group
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Venues" meta={`${organization.venues.length}`}>
        <ul className="divide-y divide-border">
          {organization.venues.map((venue) => (
            <li key={venue.id} className="px-4 py-2.5 text-[14px]">
              {venue.name}
              <span className="text-muted-foreground"> · {venueTypeLabel[venue.type]}</span>
            </li>
          ))}
          {organization.venues.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              No venues yet. One can also be named while scheduling a gathering.
            </li>
          ) : null}
        </ul>
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name" value={venueName} onChange={setVenueName} placeholder="SC Church" />
          <Choice
            label="Kind of place"
            value={venueType}
            onChange={setVenueType}
            options={(Object.keys(venueTypeLabel) as VenueType[]).map((type) => ({
              id: type,
              label: venueTypeLabel[type],
            }))}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={write.busy || !venueName.trim()}
            onClick={() =>
              write.run(
                () =>
                  addVenue({
                    data: {
                      name: venueName.trim(),
                      ...(venueType ? { type: venueType } : {}),
                    },
                  }),
                () => {
                  setVenueName("");
                  setVenueType("");
                },
              )
            }
          >
            <Plus className="size-3.5" aria-hidden />
            Add venue
          </Button>
        </div>
      </Section>
    </div>
  );
}
