import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The former Planning index.
 *
 * It was a document index organized by storage provider — Sheets, Docs, Drive
 * — which is the wrong primary axis: a leader looks for the Music Ministry
 * planning sheet, not for "the thing in Drive". Resource Search replaces it,
 * organized by where a resource participates in leadership work.
 *
 * Kept as a redirect so existing links continue to arrive somewhere useful.
 */
export const Route = createFileRoute("/planning")({
  beforeLoad: () => {
    throw redirect({ to: "/resource-search", search: {} });
  },
});
