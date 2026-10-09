# Oikonomia product overview

Oikonomia is a shared leadership binder for churches: a place to plan the week,
record what happened, coordinate ministry work and follow through on decisions.
Its organising question is **what needs my attention?**

It is delivered as a self-hosted web application with one Node server and a
persistent SQLite database. The
[public demonstration](https://oikosdemo.crishub.com/) uses invented church
records and a protected demonstration configuration.

## Who it serves

- **Leaders** planning their week, writing notes and reports, leading gatherings,
  recording outreach and developing goals.
- **Ministry teams** keeping shared goals, documents and reporting together.
- **Leaders with oversight** responding to requests and following the team's
  work and reporting within their responsibility scope.
- **Administrators** setting up the church's structure, confirming assignments,
  inviting people and maintaining the installation.

The church is represented through campuses, ministries, responsibility groups,
people and confirmed assignments. A ministry persists when its leadership
changes, and one canonical person record connects attendance, outreach and
ministry work.

## From a decision to follow-through

1. **See what needs you.** Home brings together overdue work, asks, the week and
   gatherings you lead or that still need a leader.
2. **Open the owning record.** Work continues in its meeting, report, gathering
   or goal rather than being copied into a second inbox record.
3. **Write, decide or record.** Capture minutes, attendance, outreach, report
   content or goal evidence in the appropriate workspace.
4. **Make the next step explicit.** Assign a dated meeting task, put a report
   follow-up on your week, or ask another leader for attention, action or approval.
5. **Follow the cycle.** My Progress shows your responsibilities; Leadership
   Inbox follows asks; Team Overview shows work and reporting in your scope.

A published report is information. It does not automatically become work for
its readers. Read state, acknowledgement, approval and completion are different
things, and the application keeps them separate.

## Capability catalogue

| Capability | What is implemented | Guide |
| --- | --- | --- |
| Personal orientation | Home, new-notice bell, My Progress, links to the next action | [Your binder](user-guide/your-binder.md#home) |
| Planning | Weekly agenda/list/calendar, printable week, monthly filters, personal items and church events | [Weekly Agenda](user-guide/your-binder.md#weekly-agenda) |
| Meeting records | Personal notes, editable minutes sections, decisions, follow-ups, assigned tasks and previous actions | [Meeting Notes](user-guide/your-binder.md#meeting-notes) |
| LifeGroup coordination | Shared schedule, leader claims, venues, cancellation/restoration, attendance, collaborative entries and gathering reports | [Shared work](user-guide/shared-work.md#lifegroup) |
| Ministry work | Campus-filtered ministries with documents, goals and reports; lead/team editing | [Ministry](user-guide/shared-work.md#ministry) |
| Outreach | Shared reports, contributors, comments and version conflict checks | [Reach-Out](user-guide/your-binder.md#reach-out) |
| Leadership reporting | Draft/shared/published records, audience selection, confidential-read history, follow-ups and explicit asks | [Leadership Reports](user-guide/your-binder.md#leadership-reports) |
| Leadership responses | Attention, action and approval requests; questions, replies, withdrawal and outcome history | [Leadership Inbox](user-guide/leadership.md#leadership-inbox) |
| Oversight | Reporting timeliness, outstanding obligations, consistency and scoped named or aggregate views | [Team Overview](user-guide/leadership.md#team-overview) |
| Goals and reflection | Personal/ministry/group goals, updates, evidence, completion/hold/carry-forward, private journal entries | [Goals](user-guide/your-binder.md#goals), [Journal](user-guide/organisation.md#leadership-journal) |
| Documents and forms | External document registration, filing associations, editable binder documents, form sections/fields, completed snapshots and retirement | [Documents & Forms](user-guide/your-binder.md#documents--forms-and-resource-search) |
| Resource discovery | Search, filters, pagination and relevance/recency/title ordering with access-aware results | [Resource Search](user-guide/your-binder.md#documents--forms-and-resource-search) |
| In-app help | Contextual Guide, curated help search, navigation links and guided walkthroughs | [Guide](user-guide/your-binder.md#guide-and-walkthroughs) |
| Organisation and accounts | Canonical people, campuses, ministries, groups, invitations, onboarding, assignment confirmation and session management | [Administration](user-guide/administration.md), [Getting in](user-guide/getting-in.md) |
| Configuration | Runtime vocabulary, roles/capabilities, site profile, dates, reporting cadence and related settings | [Configuration](architecture/configuration.md) |
| Data operations | Scoped JSON/CSV/OPK exports, backup verification, optional encrypted backups, second backup destination, retention and audit records | [Data](architecture/data.md) |

## Access and sharing

Signing in establishes identity. Confirmed assignments, supported capabilities
and explicit record audiences determine what a person may do. An unconfirmed
claim grants nothing, and a person cannot confirm their own assignment.

Private leadership reports and personal meeting notes are not discoverable to
unauthorized readers. A request for attention does not widen the source record's
audience. Administrative access does not give blanket access to private reports.
A confidential mark records handling and read history; the audience still
decides who may read the report.

Visibility differs by workspace. Church calendar events and LifeGroup schedules
are shared; gathering entries have their own audiences. Reach-Out reports are
shared leader records that leaders can read and continue, rather than private
pastoral case files. Journal entries are private by default and sharing is
explicit. External document access is also controlled by its hosting provider.

## Connected services

| Connection | Enabled behaviour | Configuration |
| --- | --- | --- |
| Google Workspace Drive | Browse files as the leader, register files, upload to ministry folders, create Docs/Sheets/Slides and read file metadata | Workspace service account with domain-wide delegation and church domain/mailbox settings |
| Google Calendar | Publish church events and gatherings; read a leader's personal calendar beside planning views | Workspace configuration and a church calendar destination |
| Gmail or SMTP | Invitations, magic links, password resets, failure alerts and opt-in notices for asks and meeting tasks | Workspace Gmail or SMTP delivery settings |
| Google OAuth | Sign in to an existing account with Google | OAuth client credentials and callback URL |

These integrations are implemented and configuration-dependent. Google
Workspace delegation requires a Workspace domain; consumer Gmail accounts
cannot supply it. Calendar publishing is one-way from Oikonomia; personal
calendar events are read-only overlays and do not count as completed work.

External uploads stream to Drive rather than being stored as application files.
Binder documents, notes, forms and reports are application records in SQLite.
The Guide retrieves curated help deterministically; it does not require an AI
provider. Future RAG proposals in `development/guide/` are separate from the
current help feature.

## Demonstration and deployment

The demo is the application with real permission checks and temporary shared
records. Some features are disabled or read-only for security and to protect
the demonstration environment. These restrictions are installation policy,
not the capability list for a church's configured deployment.

[Demo guide](user-guide/demonstration.md) explains identities and resets.
[Deployment and operations](architecture/deployment.md) covers Node 22,
persistent storage, Hostinger, configuration, maintenance scheduling and
recovery. Backup and retention schedules run through an external scheduler;
the presence of tooling does not mean a deployment has already scheduled it.

## Product scope

Oikonomia focuses on leadership planning and follow-through. Attendance is
recorded for LifeGroup gatherings; calendar services and events do not record
attendance. It does not present membership CRM, giving/accounting, Sunday
service production or a hosted file store as product features.
