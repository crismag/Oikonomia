# Integrating the Guide

## How Oikonomia mounts it

`src/components/oikonomia/app-shell.tsx` wraps the signed-in shell in
`<OikonomiaGuide>` and places `<GuidePanel />` beside the main column;
`top-bar.tsx` renders `<GuideToggle />`. That is the whole footprint in the
shell.

`OikonomiaGuide` (`src/integrations/guide/oikonomia-guide.tsx`) builds the host
adapter from `useViewer()` (capabilities), `useAuth().installation` (demo and
restricted operations), the router location, and `useNavigate()`.

**Turning it off:** `GUIDE_ENABLED = false`. The toggle, panel and hints render
nothing and the knowledge chunk is never loaded.

## Associating a page with help

`src/integrations/guide/context.ts` holds one table, `routeGuides`:

```ts
{
  pattern: "/leadership-reports/$reportId",
  module: "reports",
  page: "leadership-report",
  topics: ["reports.editing", "reports.visibility", "reports.confidential"],
  entityType: "leadership-report",
}
```

- `pattern` — the TanStack route path; `$` segments match any value.
- `module` / `page` — the identifiers knowledge names in `modules` and `pages`.
- `topics` — shown first on this page's Guide home, in order. Tests fail when
  an id does not exist.

A route missing from the table still gets general help. Pages do not register
themselves, and knowledge does not know routes.

## Destinations

Knowledge refers to places by **semantic id**, never by path, through
`src/integrations/guide/destinations.ts`:

```ts
"administration.invite": {
  path: "/administration",
  hash: "invite",
  label: "Open Administration → Invite people",
},
```

`mayOpen(id, persona)` decides whether a destination is offered, reusing
`navFor(persona)` from `src/components/oikonomia/nav.ts`: a destination whose
page is in the sidebar is offered only when the sidebar shows it to this
person. No role names, and no second authorization. Tests check every path is a
real file route; the corpus test rejects an unknown id in knowledge.

## Pointing a control at help

```tsx
import { GuideHint } from "@/features/guide";

<GuideHint topic="reports.confidential" label="What does Confidential do?" />;
```

A small `?` button that opens that topic and returns focus to itself when the
Guide closes; nothing when the Guide is off. Use it beside a control whose
effect is not obvious — not on every field.

## Capabilities and Demo Mode

- Capability names in knowledge must be in `knownCapabilities` (`@/config`);
  the pack rules reject others.
- The installation's `demo` flag and each restricted operation become context
  flags (`demo`, `restricted:<operation>`). Use `hideWhen` for help about
  something the installation switched off. The Guide enforces nothing:
  `src/server/installation/operations.ts` does.

## Mounting in another host

Guide Core needs:

1. a `GuideHostAdapter`;
2. `loadKnowledge(): Promise<{ items, categories }>` — usually `buildCorpus`
   over the host's files and `createMemoryKnowledgeProvider`;
3. `<GuideProvider host loadKnowledge enabled routeKey>` around the shell,
   `<GuidePanel />` beside the content, `<GuideToggle />` in the chrome.

`src/features/guide/test-support.ts` is a complete example with an invented
host.
