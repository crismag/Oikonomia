# Guide architecture

## Layers

```
 Host application (Oikonomia)
 ┌──────────────────────────────────────────────────────────────┐
 │ src/integrations/guide                                       │
 │   GuideHostAdapter  ── getContext / hasCapability /          │
 │                        canNavigate / destinationLabel /      │
 │                        navigate / onEvent                    │
 │   knowledge pack    ── knowledge/oikonomia/**/*.md (lazy)    │
 └──────────────┬───────────────────────────────────────────────┘
                │ depends on
 ┌──────────────▼───────────────────────────────────────────────┐
 │ src/features/guide  (Guide Core)                             │
 │   ui/          GuideProvider · GuidePanel · GuideToggle ·    │
 │                GuideHint · content renderer · walkthrough    │
 │   core/        createGuideService(host, knowledge,           │
 │                retriever, answers?) → GuideResponse          │
 │   retrieval/   GuideRetriever (deterministic)                │
 │   knowledge/   parse → validate → GuideKnowledgeProvider     │
 │   walkthrough/ pure step engine                              │
 └──────────────────────────────────────────────────────────────┘
```

Guide Core never imports the host. Everything application-specific arrives
through one adapter:

```ts
interface GuideHostAdapter {
  getContext(): GuideContext; // route, module, page, topics, capabilities, flags
  hasCapability(capability: string): boolean;
  canNavigate(destinationId: string): boolean;
  destinationLabel(destinationId: string): string | undefined;
  navigate(destinationId: string): void;
  onEvent?(event: GuideEvent): void;
}
```

## The service

`createGuideService` has four operations. Each returns a `GuideResponse`:

| Operation    | Returns                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `home()`     | `home`: the `page` item for the current page, if any, and the topics most relevant here  |
| `topic(id)`  | `article` or `walkthrough`; `fallback` when the id is missing or hidden from this reader |
| `ask(query)` | `results` (with `answer` when retrieval is confident) or `fallback`                      |
| `browse()`   | `browse`: categories with the items this reader may see                                  |

Every response carries `sourceIds`, the knowledge items it was built from. The
panel renders responses; it never builds one.

Before returning an item the service drops `related` items the reader may not
see, `destinations` the host says the reader cannot open, and a walkthrough
step's destination the reader cannot open (the step stays; its text is still
useful).

## Retrieval

`GuideRetriever.retrieve({ query, context, limit })` is async, so a later
retriever can call a server. The deterministic retriever:

1. normalises text: lower case, accents folded, punctuation removed, simple
   plural folding, stopwords dropped;
2. scores each **visible** item:

   | Signal                              | Points              |
   | ----------------------------------- | ------------------- |
   | exact id or title                   | 100                 |
   | exact alias                         | 90                  |
   | query contains a multi-word alias   | 45                  |
   | most words of an alias              | up to 35            |
   | keyword phrase in the query (max 2) | 25 phrase / 15 word |
   | title words                         | 10 each             |
   | keyword words                       | 5 each              |
   | summary words                       | 3 each              |
   | body words                          | 1 each, at most 5   |

3. discards anything under **8**;
4. lifts what already matched: +10 for a topic of this page, +8 for this page,
   +4 for this area. Context breaks ties; it never creates a match;
5. marks the result **confident** when the top score is at least 40 and at
   least 1.3× the next.

Every hit records `reasons`, so a surprising ranking can be traced.

The answer provider presents hits. The default is deterministic: no hits →
`fallback` ("I couldn't find an answer to that", with browse and this page's
topics); confident → `results` with the top item as `answer`; otherwise a list.
`GuideAnswerProvider` is the replacement point for generated answers — see
[RAG-ROADMAP.md](RAG-ROADMAP.md).

## Visibility is not authorization

The Guide authorizes nothing. It avoids _offering_ help and links the reader
could not use:

- `capabilities` on an item: shown when the reader has **any** of them; none
  listed means everyone.
- `hideWhen` on an item: hidden when the context carries any of those flags.
  Oikonomia sets `demo` and `restricted:<operation>` from the installation.
- Destinations: offered only when `host.canNavigate(id)`. Oikonomia answers
  from the same `navFor(persona)` filter the sidebar uses.

The server enforces every rule. A page the Guide opens runs its own checks.

## Knowledge

Knowledge files are Markdown with a small front-matter subset, parsed into
data (`GuideBlock` / `GuideInline`) that React renders as text. There is no
HTML path. Links are only `topic:<id>` and `destination:<id>`; anything else
(`https:`, `javascript:`, `data:`, bare paths) is a validation error and renders
as plain text.

`buildCorpus(sources, rules)` checks duplicate ids, `related` and topic links
that go nowhere, self-relations, and — with host rules — unknown categories,
destinations and capabilities. Oikonomia loads its pack with Vite's
`import.meta.glob`, in its own chunk, on first open.

## Walkthroughs

A walkthrough is data: an introduction and ordered steps, each with an optional
destination. `walkthrough/engine.ts` is pure (`startWalkthrough`,
`moveWalkthrough(next | back | restart)`, `stepLabel`). The provider keeps
progress per walkthrough for the session, so following a step's button does not
lose the reader's place. A walkthrough never clicks, fills or submits anything.

## UI

- **GuideProvider** keeps a stack of views (home, topic, ask, browse) for
  _Previous help_, creates the service on first open, reloads the response when
  the route changes, and remembers open/closed in `localStorage` (`guide.open`).
  Nothing else persists.
- **GuidePanel** is a 22rem rail beside the content at `(min-width: 1440px)`,
  and a Sheet below that. Navigating from the Sheet closes it so the reader sees
  the page.
- **Accessibility:** a labelled landmark or dialog; focus moves to the question
  box on open and back to the opener on close; Escape closes; walkthrough
  progress is a `progressbar` with a live step label; icon buttons are labelled.

## Events

`guide_opened`, `guide_topic_opened`, `guide_search`, `guide_search_no_result`,
`guide_walkthrough_started`, `guide_walkthrough_completed`,
`guide_walkthrough_abandoned` go to `host.onEvent`. Oikonomia does not listen
yet. The queries in `guide_search_no_result` are the list of missing help.
