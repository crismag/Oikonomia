import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The former Leader Progress Report page.
 *
 * Section 7 is now **Leadership Reports**, of which the Leader Progress Report
 * is one report type. This route is kept as a redirect so existing links and
 * bookmarks keep working rather than dead-ending.
 */
export const Route = createFileRoute("/progress-report")({
  beforeLoad: () => {
    throw redirect({ to: "/leadership-reports", search: {} });
  },
});
