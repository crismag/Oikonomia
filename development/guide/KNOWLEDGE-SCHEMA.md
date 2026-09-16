# Knowledge schema

A knowledge item is one Markdown file with front matter. The Oikonomia pack
lives in `knowledge/oikonomia/<area>/<name>.md`. Adding a file is enough: the
pack loader finds every `*.md` under the pack, and `npx vitest run
src/integrations/guide` validates the whole corpus.

## Front matter

```yaml
---
id: reports.confidential
title: Confidential reports
type: concept
category: reports
summary: What marking a report confidential does, and what it does not.
modules: [reports]
pages: [leadership-reports, leadership-report]
keywords: [confidential, private, audit, who opened]
aliases:
  - who has read my report
  - make a report confidential
capabilities: []
hideWhen: []
related: [reports.visibility, reports.page]
destinations: [leadership-reports]
---
```

| Field          | Required | Meaning                                                                                                                                           |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | yes      | Stable, lower-case, dotted (`area.topic`). Never reuse or rename casually — links, route tables and future AI sources refer to it.                |
| `title`        | yes      | What the reader would call it.                                                                                                                    |
| `type`         | yes      | `concept`, `page`, `procedure`, `walkthrough`, `permission` or `troubleshooting`.                                                                 |
| `category`     | yes      | Browse category id (see the pack's `pack.ts`).                                                                                                    |
| `summary`      | yes      | One sentence, shown in lists and search results.                                                                                                  |
| `modules`      | no       | Areas this belongs to (`reports`, `planning`, …). Lifts it in search on those pages and lists it in the page's help.                              |
| `pages`        | no       | Specific pages (`leadership-report`, `weekly-agenda`, …). A `page` item whose `pages` includes the current page becomes that page's help heading. |
| `keywords`     | no       | Words and short phrases a reader might search for.                                                                                                |
| `aliases`      | no       | Whole questions as a reader would type them. The strongest search signal after the exact title.                                                   |
| `capabilities` | no       | Shown only to readers holding **any** of these. Empty means everyone. Visibility only — the application still enforces access.                    |
| `hideWhen`     | no       | Hidden while the context has any of these flags (`demo`, `restricted:identity`, …).                                                               |
| `related`      | no       | Other item ids, offered under the content. Every id must exist.                                                                                   |
| `destinations` | no       | Semantic destinations offered as buttons (`leadership-reports`, `administration.people`, …). Must be known to the host.                           |

Lists may be written inline (`[a, b]`) or as `- item` lines. Values are plain
strings. Unknown fields are errors.

## Body

A small Markdown subset, parsed to structure and rendered as text (no HTML):

- paragraphs; `### Heading`; `- ` and `1. ` lists; `> ` notes;
- `**strong**`, `*emphasis*`, `` `code` ``;
- links, only of two kinds:
  - `[confidential reports](topic:reports.confidential)` — another item;
  - `[Leadership Reports](destination:leadership-reports)` — a page to open.

Any other link target (`https:`, `javascript:`, a path) is a validation error.

## Walkthroughs

`type: walkthrough`. Text before the first `## ` is the introduction; each
`## Step title` section is a step, in order. A line `Destination: <id>` inside a
step says where it happens (the Guide offers to open it):

```markdown
---
id: reports.create.walkthrough
title: Write a leadership report
type: walkthrough
...
---

Five steps, from an empty report to one your leaders can read.

## Open Leadership Reports

Destination: leadership-reports

Leadership Reports is under My Work in the sidebar.

## Start a report

Choose **New report**, then **Write report here**.
```

A walkthrough needs at least one step, and every step needs text.

## Writing rules

- Describe the product as it is built. Check the code and
  `docs/user-guide/` before writing; never describe a planned feature as
  available.
- Use the application's own names (Leadership Reports, Weekly Agenda,
  Leadership Inbox, Put on my week).
- Say what is not possible when readers will look for it, rather than leaving
  them to guess.
- Keep an item to one question. Link related questions instead of growing one
  article.
