/**
 * Who may read a meeting note, as SQL.
 *
 * The rule itself is stated in `domain/authorize.ts`. This is that rule
 * expressed as a WHERE clause, and it lives in one file because **two copies
 * of a privacy rule is one copy too many** — the second drifts, and drift here
 * means a personal note appearing in a list it should never have reached.
 *
 * Two callers need it: the Meeting Notes list, which pages and so cannot filter
 * afterwards without a `COUNT(*)` that tells a leader how many notes they may
 * not read, and the document registry, where a resource must not be findable
 * through a note the viewer cannot open.
 *
 * `meeting-service.test.ts` and `document-service.test.ts` each assert that
 * what this returns agrees with `canView`, and each is mutation-tested.
 */
export function noteReadableSql(alias: string): string {
  /*
   * A personal note is its author's alone. Minutes are the meeting's record,
   * for the people who were at it — and for whoever wrote them up.
   */
  return `(${alias}.author_id = ? OR ${alias}.note_taker_id = ? OR (${alias}.note_type = 'minutes' AND ${alias}.participants LIKE ?))`;
}

/** The three parameters `noteReadableSql` expects, in order. */
export const noteReadableParams = (personId: string): unknown[] => [
  personId,
  personId,
  `%"${personId}"%`,
];
