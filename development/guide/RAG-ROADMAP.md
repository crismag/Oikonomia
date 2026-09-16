# Retrieval-augmented Guide: roadmap

Nothing here is built. This records where semantic retrieval and generated
answers would attach, so adding them does not mean redesigning the Guide.

## Principles that stay

- **Answers cite knowledge.** Every `GuideResponse` carries `sourceIds`. A
  generated answer that cannot name its sources is not shown.
- **Navigation, never action.** A model may suggest a destination id; the host
  still decides with `canNavigate`. No tool calling that changes data.
- **Visibility before retrieval.** Items the reader may not see are filtered out
  before anything reaches a model.
- **Honest fallback.** When retrieval is weak, say so; never generate from
  nothing.
- **Demo installations** run without any external model.

## Integration points

### 1. `GuideRetriever` — semantic or hybrid search

```ts
interface GuideRetriever {
  retrieve(request: GuideRetrievalRequest): Promise<GuideRetrievalResult>;
}
```

Already async. A hybrid retriever would:

1. run the deterministic retriever, so exact titles and aliases stay the
   strongest signal;
2. query an embedding index of the same items — chunked by `## ` section,
   keyed by item id — **after** applying `visibleIn(item, context)`;
3. merge scores, keep `reasons` (`"semantic 0.82"`), and set `confident`
   conservatively.

Index what `blocksText` already produces; the knowledge files stay the source.

### 2. `GuideAnswerProvider` — generated answers

```ts
interface GuideAnswerProvider {
  answer(query, context, retrieval): Promise<GuideResponse>;
}
```

A generating provider receives the retrieved items, writes a short answer
grounded only in them, and returns `results` with that answer and the
`sourceIds` it used. It calls a server function — never an SDK in the browser —
and that function needs its entry in `src/server/installation/operations.ts`
like any other. When generation fails or is off, it delegates to the
deterministic provider.

Showing a generated answer needs one new, clearly marked response part (text
with citations). It must not look like curated help.

### 3. Events as evaluation data

`guide_search` and `guide_search_no_result` give real queries. Before any model
work, collect them and build an evaluation set — query → the items a person
judges correct — and compare retrievers on it, not on impressions.

## Order

1. Collect no-result queries; improve aliases and articles.
2. Build the evaluation set from real queries.
3. Hybrid retriever behind a flag, measured on the set.
4. Generated answers only if people still cannot find answers in what the
   hybrid retriever returns.
