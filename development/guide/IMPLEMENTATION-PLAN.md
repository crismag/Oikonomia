# Guide implementation plan

## Shipped (PR #13)

| Area                                                                         | State                               |
| ---------------------------------------------------------------------------- | ----------------------------------- |
| Core contracts: host adapter, knowledge provider, retriever, answer provider | Done                                |
| Knowledge format: front matter, Markdown subset, safe links, walkthroughs    | Done, validated in tests            |
| Deterministic retrieval with an honest fallback                              | Done                                |
| Capability and flag visibility; destinations filtered by the host            | Done                                |
| Panel: rail at ≥1440px, Sheet below; focus management; Escape                | Done                                |
| Contextual home from one route table                                         | Done                                |
| Browse by category; _Previous help_ history                                  | Done                                |
| Walkthroughs with per-session progress and navigation                        | Done                                |
| Deep links with `GuideHint` (first placement: Confidential on the editor)    | Done                                |
| Lazy knowledge chunk                                                         | Done                                |
| Events through `host.onEvent`                                                | Emitted; nothing listens yet        |
| Oikonomia pack: 16 categories, 106 items, 13 walkthroughs                    | Done; kept current with the product |
| One switch to turn it off                                                    | `GUIDE_ENABLED`                     |

## Known limits

- **Help lives in two places.** `docs/user-guide/` and `knowledge/oikonomia/`
  describe the same product and are kept in step by hand.
- **Fixed width.** The panel is 22rem and cannot be resized.
- **The rail needs 1440px.** Narrower screens get the Sheet, which covers the
  page — at 1280px the rail left the binder's tables too narrow.
- **No analytics sink.** `guide_search_no_result` queries are not collected.
- **Few `hideWhen` rules.** Only help about switched-off operations uses them.
- **Matching is lexical.** A question sharing no words with an item finds
  nothing, even when the item answers it. Aliases are today's remedy.
- **One `GuideHint`.** Add more only where a control's effect is not obvious.

## Priority

**The Guide is for leaders and users first.** Its job is to help somebody use
the section they are on and find where to do their work — a user guide at
their elbow, not an administrator's manual. Coverage, walkthroughs and "where
do I…" answers for the pages leaders work in come before administration help.
Administration help stays, shown only to administrators.

## Next, in order

1. Record `guide_search_no_result` where an owner reads it, and write help for
   what people actually ask.
2. `GuideHint` beside the controls that most confuse: report visibility, Put on
   my week, claims awaiting confirmation.
3. Decide which of `docs/user-guide/` and `knowledge/` is the source, and
   generate the other.
4. Only then, [RAG-ROADMAP.md](RAG-ROADMAP.md).

## Product findings from writing the pack

Writing help from the code surfaced these. Where they stand:

| Finding                                            | Outcome                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| A draft report was readable by its audience        | Fixed (PR #14): drafts are author-only; sharing is the author's move     |
| An administrator could confirm their own place     | Fixed (PR #14): self-confirmation, self-membership and self-lead refused |
| No screen to change a password                     | Fixed (PR #14): Change password on Account & security                    |
| Inviting took two edits, one person at a time      | Fixed (PR #14): Invite people, by address, in bulk                       |
| Team Overview and Inbox Approvals docs out of date | Fixed in the user guide                                                  |
| Page "Leadership", sidebar "Leadership journal"    | Both "Leadership Journal"                                                |
| Registering a document does not check its ministry | Intended: documents live anywhere and are linked by their leader         |
| "Shared" report visibility behaves as Named people | Intended: shared means explicitly shared by the author                   |
