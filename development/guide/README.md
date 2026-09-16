# Guide

The Guide is the right-hand help panel. It explains the page the reader is on,
answers questions from curated help, and walks through common tasks one step at
a time.

It is **deterministic**. It has no model, no embeddings, no tool calls, and it
performs no actions. An answer is a knowledge item chosen by matching the
reader's words against curated metadata. When nothing matches well, the Guide
says so. The Guide **navigates** — it opens a page the reader could already
open from the sidebar — and never **acts**: it creates, changes and approves
nothing.

**Who it is for:** leaders and users first — how to use the section they are
on and where to do their work. Administration help exists and is shown only to
administrators; it is not the priority.

This folder is developer documentation. No runtime code lives here.

| Document                                         | Read it when                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | You change Guide Core, retrieval, or the panel                               |
| [KNOWLEDGE-SCHEMA.md](KNOWLEDGE-SCHEMA.md)       | You write or edit a help article or walkthrough                              |
| [INTEGRATION.md](INTEGRATION.md)                 | You connect a page, route or destination, or mount the Guide in another host |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | You want to know what shipped, what did not, and what is next                |
| [RAG-ROADMAP.md](RAG-ROADMAP.md)                 | You plan semantic search or generated answers                                |

## Where things are

```
src/features/guide/            Guide Core — knows no host application
  core/                        types, contracts, the service
  knowledge/                   front matter, Markdown subset, parsing, validation
  retrieval/                   normalisation, visibility, deterministic retriever
  walkthrough/                 the pure step engine
  ui/                          provider, panel, content renderer, walkthrough view
  test-support.ts              a host-free fixture pack

src/integrations/guide/        Oikonomia's side
  oikonomia-guide.tsx          the host adapter and the on/off switch
  context.ts                   route → module, page, topics
  destinations.ts              semantic destination ids → routes
  pack.ts                      browse categories
  knowledge-pack.ts            loads and validates knowledge/oikonomia

knowledge/oikonomia/           the help itself, one Markdown file per item
```

Dependency direction: `src/integrations/guide` imports `src/features/guide`.
Nothing in `src/features/guide` imports from `@/` outside itself.

## Common tasks

- **Add an article:** create `knowledge/oikonomia/<area>/<name>.md` (see
  [KNOWLEDGE-SCHEMA.md](KNOWLEDGE-SCHEMA.md)), then run
  `npx vitest run src/integrations/guide`.
- **Make an article this page's help:** add its id to the route's `topics` in
  `src/integrations/guide/context.ts`.
- **Link to a page:** add a destination in `src/integrations/guide/destinations.ts`
  and use `destination:<id>` in knowledge.
- **Point a control at help:** `<GuideHint topic="<id>" label="What does X do?" />`.
- **Turn the Guide off:** set `GUIDE_ENABLED = false` in
  `src/integrations/guide/oikonomia-guide.tsx`.
- **Changed a screen?** Update the knowledge that describes it in the same
  change, as with `docs/user-guide/`.

## Checks

```
npx vitest run src/features/guide src/integrations/guide
```

Core tests use invented modules and capabilities, so Core cannot come to depend
on Oikonomia without a test noticing. Integration tests validate the whole
corpus (ids, links, categories, destinations, capabilities), check every
destination is a real route, and check a leader is never shown administration
help.
