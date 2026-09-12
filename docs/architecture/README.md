# Oikonomia architecture

Written from the source, with each claim checked against the code or against a
running instance.

Where this documentation and the code disagree, **the code is right and the
documentation is a bug**.

## The documents

|                                               |                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------- |
| [Overview](overview.md)                       | What the system is, the stack, and how a request travels through it |
| [Identity and access](identity-and-access.md) | Who somebody is, and what that does and does not entitle them to    |
| [Data](data.md)                               | Persistence, migrations, versioning and concurrency                 |
| [The API boundary](api-boundary.md)           | Server functions, envelopes, errors and validation                  |
| [Configuration](configuration.md)             | What an administrator can change while the application runs         |
| [Deployment and operations](deployment.md)    | Building, configuring, backing up, restoring, scheduling            |

## The shape, in numbers

|                    |     |
| ------------------ | --- |
| Routes             | 44  |
| Client API modules | 18  |
| Services           | 19  |
| Repositories       | 18  |
| Schema migrations  | 33  |
| Test files         | 62  |

## Three ideas the rest of this follows from

**Signing in proves identity and nothing else.** Not membership, not a
position, not a capability. Those come from confirmed assignments the
organisation owns, and no authentication path writes one.

**Configuration chooses among behaviours the code already has.** An
administrator renames things, opens and closes vocabularies, and decides which
of several implemented strategies applies. Configuration never adds a
behaviour and never widens access.

**The interface does not claim more than the system does.** A control that
cannot work is not shown; a value nobody entered is not displayed; a state
nobody verified is not asserted. Where something is genuinely absent, the
screen says so.
