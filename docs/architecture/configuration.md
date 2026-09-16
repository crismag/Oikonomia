# Configuration

## What configuration is, and what it can never be

An administrator can rename things, open and close vocabularies, and choose
which of several **already-implemented** strategies applies.

Configuration **chooses among behaviours the code already has**. It never adds
a behaviour, and it never widens access. A role is a bundle of capabilities
drawn from a closed set of three; an administrator can create a role called
anything and give it any of those three, and cannot invent a fourth, because a
capability is a thing the code checks.

> **Configuration must never accidentally widen authorization.** This is the
> constraint the design exists to satisfy, and it is why capabilities are a
> closed union in `src/domain/capabilities.ts` rather than strings in a table.

## One way in

```ts
config.reports.statuses; // yes
import statuses from "…/reports.json"; // no
```

No module knows where a value came from. That is the whole point: values began
as JSON files, are now overridable from the database through an Administration
screen, and every consumer kept working across that change because none of them
had reached for a file.

Each namespace is parsed against a zod schema the first time it is read, so
malformed configuration fails immediately and loudly, in development, with the
namespace named — rather than becoming an undefined label three screens away.

## Layers

```text
  src/config/files/*.json        shipped defaults — what a new church starts with
        +
  configuration overrides        rows an administrator has changed
        ↓
  the registry                   validated, cached, one answer per namespace
```

Eight default files: `cadence`, `categories`, `goals`, `lifegroup`,
`meetings`, `organization`, `reports`, `roles`.

## Runtime-effective, and what that cost

**Saving configuration does not require rebuilding, redeploying or restarting
Oikonomia.** An administrator's change is visible on the render that fetched
it.

That is harder than it sounds, because the registry is a module rather than
React state — nothing re-renders when it changes. Applying overrides in an
effect meant the render that had just received them still drew the previous
labels, and the new ones appeared whenever something else happened to
re-render, or on a reload. They are applied **during render**, before any
descendant draws.

The matching trap is server-side. The browser's provider also renders on the
server, and handing the server registry the browser's (empty) override list
wipes configuration for that request — a configured value then resolves
correctly everywhere except the one snapshot the browser was given. So the
server applies overrides per request, the browser applies what the session
carried, and neither reaches into the other's copy. `browserShouldApply()` is
that rule, and it has a test.

## Ids are not labels

A status, a role, a category, a visibility is stored as a stable id and
displayed through configuration. Renaming "Submitted" to "Sent in" changes a
label and no behaviour, because nothing branches on the label.

Where a vocabulary is **open**, an administrator may add entries — report
statuses, access roles, entry visibility. Where it is closed, they may not,
because the code branches on the members. The Administration screen offers
adding only where adding is meaningful, and a test asserts each vocabulary
appears exactly once in the editable or addable list, after a block landed in
the wrong one and rendered "Report stages" twice.

## Dates and times follow the site profile

`site.profile` holds how the church writes a date. Screens do not call
date-fns `format` with a pattern of their own; they ask `src/domain/dates.ts`
for a date by intent — `formatDate`, `formatDateShort`, `formatDayMonth`,
`formatDayMonthShort`, `formatWeekdayShort`, `formatWeekdayLong`,
`formatWeekdayFull`, `formatMonthYear`, `formatDayRange`, `formatTime`,
`formatDateTime`, `formatDayMonthTime` — and the settings decide how it reads.

| Setting | Honoured as |
| --- | --- |
| `dateFormat` | The full date, as written (a date-fns pattern). Its order — day, month or year first — also sets the short and weekday forms: `MMMM d, yyyy` gives "Sep 12" and "Sat, Sep 12". |
| `timeFormat` | Every time of day. An `H` pattern is a 24-hour clock ("19:30"). The shipped `h:mm a` keeps the binder's compact "7:30 PM" / "9 AM" for wall-clock times. |
| `locale` | Day and month names, for the locales `dates.ts` carries; any other tag reads in English. |
| `timezone` | Timestamps (`createdAt`, `updatedAt`, audit rows, sessions, comments) are shown on the church's clock, not the reader's device. |
| `weekStartsOn` | Where the weekly agenda begins (`AGENDA_WEEK_STARTS_ON`). |

Two rules the helper keeps:

- **A calendar date is never shifted.** A `yyyy-MM-dd` value is a day, read as
  local midnight like `fromISO`; only instants move into the site timezone.
  An instant near midnight UTC can therefore land on the previous or next day,
  which is the point.
- **A mistyped pattern does not break a page.** The settings are free text on
  the Administration screen; a pattern date-fns refuses falls back to the
  shipped one, and an unknown zone name to the device's clock.

Machine formats — ISO values, file names, exports — do not go through the
helper. Email notices spell their dates out on the server and do not read
these settings yet.

## Status transitions

A status change is not a free-text field write. `planTransition(from, to)`
derives the capability required and the effects that follow from the
_behaviour_ of the two states — whether the record becomes final, whether it
becomes visible, whether it is retired — rather than from their names:

```ts
const capability = thaws
  ? "manageAccess"
  : freezes || reaches
    ? "publish"
    : retires
      ? "archive"
      : sideways && before.final
        ? "manageAccess"
        : "edit";
```

This is what lets an administrator add a stage to the report lifecycle without
the code learning its name: the new stage declares its behaviour, and the
transition rules follow.

## Messages

User-facing wording lives in one catalogue (`src/config/messages/`), so a
refusal, a confirmation and a success read consistently and can be changed
without hunting through components. A confirmation dialog is a key plus
values; dismissing one is declining, because a confirmation that resolves true
when somebody pressed Escape is a confirmation that did not happen.
