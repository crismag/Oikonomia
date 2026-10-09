# Explore the Oikonomia demonstration

[Open the demonstration](https://oikosdemo.crishub.com/).

The demonstration runs Oikonomia with invented church data and real permission
checks. Different identities let you see how the binder changes with a leader's
confirmed responsibilities.

## Enter and choose a perspective

A first visit without a session cookie enters as the first designated demo
identity and opens Home. Use the demo bar's switcher or `/login` to choose
another available identity. **Try it as yourself** creates a temporary visitor
with a name, no email address and the least-privileged role, then opens onboarding.

An identity's visible pages and available actions follow its permissions. A
visitor's claimed assignments remain claims until another authorized person
confirms them; claiming a role does not unlock leadership access.

## A useful tour

1. **Home → My Progress:** see what needs attention and which responsibility
   cycles still have an open step.
2. **Weekly Agenda → Meeting Notes:** follow a meeting task back to its minutes,
   or write a note and create a dated task to see the connection.
3. **LifeGroup:** explore the shared schedule, leaders, venues, attendance,
   entries and gathering report.
4. **Ministry → Goals → Documents & Forms:** see how a team's work, reference
   material and reusable forms stay together.
5. **Leadership Reports → Leadership Inbox:** explore the difference between
   sharing information and explicitly asking for attention, action or approval.
6. **Team Overview:** switch to an identity with oversight to see its scoped
   reporting and obligation view.
7. **Guide:** search for help or follow a walkthrough from the page you are on.

Actions in this tour remain subject to the selected identity's authorization.
You may need to switch identity to explore a particular workspace.

## What demo mode protects

**Some features are disabled or read-only for security and to protect the
shared demonstration.**

| Area | Demonstration behaviour |
| --- | --- |
| Church work | Planning, notes, reports, gatherings, goals, forms and other allowed work can be changed within the identity's permissions. |
| People and accounts | Invitations, credentials, person creation/editing and ending other people's sessions are restricted. Temporary visitors use the dedicated demo entrance. |
| Configuration | Vocabulary, site settings and access configuration are read-only. |
| Connected services | Email is suppressed and Google Workspace operations are unavailable. Ordinary visitors use demo identities rather than Google sign-in. |
| Data administration | Backups, exports, package checks and retention changes are restricted. |
| Church structure | Allowed campus, ministry, group and assignment operations still require their ordinary permissions. |

These limits are enforced on the server, including for a demo administrator.
A configured church installation provides the corresponding operations under
its usual authorization and connected-service settings.

## Shared and temporary

People exploring the same designated identity share that identity's records.
Changes can be seen by other visitors, and an edit conflict is handled by the
application's normal version checks.

The demo bar identifies the current perspective and shows the next refresh;
**About this demo** explains the shared environment. A refresh restores the
curated baseline, removes temporary visitors and edits, and ends sessions.
After a refresh, choose an identity again to continue. The actual refresh
schedule is deployment configuration, not a guarantee that your changes will
remain for a fixed duration.

Use invented content when exploring; the demonstration is not a place to keep
real church records. See [Your binder](your-binder.md) for the working guide and
[Demo Mode](../architecture/deployment.md#demo-mode) for deployment details.
