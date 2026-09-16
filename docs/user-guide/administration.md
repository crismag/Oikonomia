# For administrators

Everything here is in **Administration**, and it divides into four jobs: the
organisation, who can get in, what things are called, and looking after the
data.

> **What administration is not.** Managing structure is not permission to read
> pastoral or leadership content. The screen tells you how many records are
> closed to your account, and administering the installation never opens them.

## Where structure comes from

> _Somebody entered it, here. Nothing arrives with the application: a new
> installation has no campuses, no ministries and no people until an
> administrator adds them._

A new Oikonomia is genuinely empty. There is no starter church, no sample
ministry and no demonstration data to clear out before real work begins.

Until it is set up, an administrator's Home shows **Set up your church**: add a
campus, add the ministries, add the leaders, invite them in, and confirm where
they serve. Each step is ticked by the records existing — there is nothing to
mark done by hand — and each opens the part of Administration where it is
done. Once every step is done the card is gone.

Add, in roughly this order:

1. **Campuses** — a place the church meets. Ministries and people are filed
   under one.
2. **Ministries** — each exists independently of whoever leads it, so it can be
   created before a lead is chosen.
3. **People** — name, what they are called here, email address, campus, and who
   they report to.
4. **Responsibility groups** — a body the church answers through: an eldership,
   a leadership team. Reports set to "leadership" reach the group you mark as
   the leadership audience.
5. **Venues** — reused across gatherings; one can also be named while
   scheduling.

## Giving somebody access

### Several people at once

In **Invite people**, list their email addresses — one per line, or separated
by commas — and choose **Send invitations**. Each address gets its own result:

| Result                            | What happened                                                  |
| --------------------------------- | -------------------------------------------------------------- |
| _Invitation sent_                 | An account, and an email with a link to set a password         |
| _Account created — no email sent_ | An account; this installation cannot send email (see below)    |
| _Already signs in_                | Nothing — they already have access                             |
| _Not an email address_            | Nothing; the address stays in the box to correct               |
| _Held by another record_          | Nothing; the address belongs to another account — check People |

An address nobody in **People** has adds a person, recorded under the address
(_· added to People_). They give their name the first time they sign in; after
that it is yours to change like the rest of their record. Up to 200 addresses
at a time. The link works once and lasts seven days.

### One person

Open the person's record, **save an email address**, then press **Invite to
Oikonomia**.

### What an invitation gives

A way in **and nothing else** — no ministry, no group, no capability. Where
they serve is claimed in Welcome and confirmed by you.

Where no mail provider is configured, the button reads **Create accounts**:
the accounts are still created and you set the password yourself:

```bash
npm run auth:set-password -- them@example.org "a long passphrase"
```

To remove access: **deactivate** the person. Their sessions stop immediately,
they can no longer sign in, and everything they wrote stays readable and
correctly attributed.

## Awaiting confirmation

> _What people have said about where they serve, and corrections they have
> asked for._

When somebody claims an assignment, it lands here. **A claim grants nothing
until you confirm it** — no membership, no readership, no export scope — and
nobody can confirm their own.

That includes administrators. Your own claims show _Another administrator
confirms this_ instead of **Confirm**, and Oikonomia refuses an administrator
adding themselves to a ministry or a responsibility group, or naming themselves
a ministry's lead. Removing yourself is allowed. A church with one
administrator needs a second one to place them.

This is the single most important administrative habit in Oikonomia: the queue
is where "I lead the youth ministry" becomes true.

## What you may change, and what you may not

> _What things are called, whether they are offered, and — where a list says so
> — which of the application's own behaviours each one uses. An option's
> identity never changes, because records already refer to it._

You can rename anything. Renaming "Submitted" to "Sent in" changes a label and
no behaviour, because nothing branches on the label.

Configurable vocabularies include: report stages, report visibility, work
statuses, goal statuses, attendance, gathering statuses, entry visibility,
meeting types, note types, information categories, access roles, site settings
and cadence.

**Lists with an Add button accept new values. Lists without one do not** — and
the difference is not an oversight. A closed list is one the code branches on;
adding a member would name a behaviour that does not exist.

Where a list lets you add a stage, you choose which of the application's
existing behaviours it uses — whether it makes a record final, whether it makes
it visible, whether it retires it. The transition rules follow from that
choice, which is how you can add a stage without the code learning its name.

### Access roles

A role is a **bundle of capabilities** drawn from a closed set of three:

| Capability               | What it grants                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Campus oversight         | Sees one campus's leadership work by name, and may put somebody else's name against a gathering. **Does not open confidential reports** |
| Cross-ministry oversight | Sees across ministries                                                                                                                  |
| Administration           | Administers the installation                                                                                                            |

You can create a role, name it anything, and give it any combination of those
three. You cannot invent a fourth, because a capability is something the code
checks.

**Configuration never widens access.** Renaming a role, adding a stage or
opening a vocabulary cannot give anybody something the code does not already
implement.

Oikonomia refuses to leave itself unadministrable: you cannot remove the last
role that can administer it.

### Changes take effect immediately

Saving configuration does not require restarting or redeploying. **What has
been changed** lists your overrides, and **Importing configuration** brings a
set in from elsewhere.

## Looking after the data

### Continuity

The panel states its own limits before you ask:

> _No backup has ever completed. Nothing here could be recovered._
> _Every backup is on this server. A failure of this machine would take the
> backups with it._
> _No restore has been verified. A backup nobody has restored is a backup
> nobody knows works._

**Back up now** takes one immediately. **Verify the last backup** opens the
copy as a database of its own and checks it can be read — beside the running
installation, never over it.

Three things to arrange with whoever runs the server:

1. **A second destination** (`OIKONOMIA_BACKUP_DIR`) so a backup survives this
   machine.
2. **A schedule**, from cron. Nothing runs on its own.
3. **An address for failures** (`OIKONOMIA_ALERT_TO`), so a backup that fails
   at two in the morning is not discovered on the day it matters.

Restoring _into_ the installation is deliberately not a button here — a control
that replaces every record in the church is one nobody should have. The
procedure is in [the deployment documentation](../architecture/deployment.md#restoring).

### Export

> _An export contains only what you may read. A site export leaves out every
> record you are not an audience for, and says how many — never which._

JSON, CSV or OPK. That rule holds for administrators too: export is not a way
around the access model. You are told a count of what was withheld, never its
titles.

### Check a package

Paste a package to see what it holds. **Checking writes nothing** — it reads
the manifest, verifies checksums and says what an import would contain.
Committing an import is not offered, because what a commit should do to
existing records has not been decided, and offering it before then is how a
church loses records.

### Retention

**Apply retention now** deletes what has outlived its policy. Three separate
things stop a deletion — the policy being disabled, the class being on hold,
and the artifact not being old enough — because deleting a backup early is the
one mistake in this domain that cannot be undone.
