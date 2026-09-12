import { afterEach, describe, expect, it } from "vitest";

import { applyOverrides, resetOverrides } from "@/config";
import { isEditableWork, isOpenWork, workStatusBehavior } from "./work";

/**
 * What a work stage means.
 *
 * Lists used to ask this by name — `["resolved", "closed",
 * "acknowledged"].includes(status)` — so renaming a stage would have left the
 * count right and adding one would have left it wrong, silently. The question
 * is now asked of the stage itself.
 *
 * These deliberately do **not** test transitions. Work moves through a review
 * process whose steps carry rules no set of booleans implies; those live in
 * `work-service.ts` and are tested there.
 */
describe("what a work stage means", () => {
  afterEach(() => resetOverrides());

  it("treats a draft as open and its owner's to write", () => {
    expect(isOpenWork("draft")).toBe(true);
    expect(isEditableWork("draft")).toBe(true);
  });

  it("treats a submitted record as open and no longer its owner's to rewrite", () => {
    expect(isOpenWork("submitted")).toBe(true);
    expect(isEditableWork("submitted")).toBe(false);
  });

  it("treats a resolved or closed record as settled", () => {
    for (const status of ["resolved", "closed", "acknowledged"]) {
      expect(isOpenWork(status), status).toBe(false);
    }
  });

  /* Returned for changes is open again, and writable again — otherwise the
     person asked to change something could not. */
  it("reopens a record that was returned for changes", () => {
    expect(isOpenWork("changes-requested")).toBe(true);
    expect(isEditableWork("changes-requested")).toBe(true);
  });

  /**
   * Fail closed, quietly.
   *
   * A record whose stage means nothing reads as settled rather than open: a
   * wrongly-settled record sits in a list of finished things, where somebody
   * will find it. A wrongly-open one is an obligation nobody has.
   */
  it("reads an unrecognised stage as settled and not editable", () => {
    expect(workStatusBehavior("invented-40218")).toEqual({
      editable: false,
      final: true,
      current: false,
      visibleToAudience: false,
    });
  });

  /* Renaming is the thing a church may do here, and it must not move a record
     from one list to the other. */
  it("keeps meaning the same when a church renames the stage", () => {
    applyOverrides([
      { namespace: "work.statuses", optionId: "resolved", value: { label: "Settled" } } as never,
    ]);

    expect(isOpenWork("resolved")).toBe(false);
  });
});
