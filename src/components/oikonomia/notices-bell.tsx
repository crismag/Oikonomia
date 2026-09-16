import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { noticesFor, type Notice } from "@/domain/notices";
import { toISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { useLeadershipInbox, useReadState } from "./escalation-provider";
import { useMyMeetingTasks } from "./meeting-provider";
import { PersonName } from "./person";

/**
 * The bell: what is new for this leader, and what has slipped past its date.
 *
 * In the app only. It counts what somebody else asked of them or gave them in
 * a meeting that they have not seen, and opening it records those as seen —
 * the count is about news, not about work outstanding. Past-due work is listed
 * inside but never counted, so the bell cannot become a number that only
 * finishing everything makes go away. Every row opens where the work lives.
 */
export function NoticesBell() {
  const { person } = useViewer();
  const inbox = useLeadershipInbox();
  const myTasks = useMyMeetingTasks();
  const readState = useReadState();
  const [open, setOpen] = useState(false);
  /* What was new when the panel opened, so it still reads as new while open. */
  const [shownAsNew, setShownAsNew] = useState<Set<string>>(new Set());

  const today = useMemo(() => toISO(new Date()), []);
  const loaded = inbox.status === "ready" && readState.status === "ready";
  const { fresh, pastDue } = noticesFor({
    viewerId: person.id,
    asks: inbox.mine,
    tasks: myTasks.tasks,
    isSeen: readState.isRead,
    today,
  });
  const count = loaded ? fresh.length : 0;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setShownAsNew(new Set(fresh.map(key)));
      readState.markSeen(fresh.map(({ itemType, itemId }) => ({ itemType, itemId })));
    }
  };

  /* While open, the panel keeps listing what was new when it was opened —
     marking it seen must not make it vanish from under the reader. */
  const listedNew = open
    ? noticesFor({
        viewerId: person.id,
        asks: inbox.mine,
        tasks: myTasks.tasks,
        isSeen: (type, id) => !shownAsNew.has(`${type}:${id}`),
        today,
      }).fresh
    : fresh;
  /* Listed once: something new that is also late appears under New. */
  const listedKeys = new Set(listedNew.map(key));
  const pastDueOnly = pastDue.filter((notice) => !listedKeys.has(key(notice)));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={count > 0 ? `Notices, ${count} new` : "Notices"}
        className="relative grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground tabular-nums"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-[14px] font-medium">Notices</p>
          <p className="text-[12px] text-muted-foreground">
            What was asked of you, and what has passed its date. Nothing here is sent anywhere.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <NoticeList
            title="New for you"
            notices={listedNew}
            empty={loaded ? "Nothing new has been asked of you." : "Checking…"}
            onFollow={() => setOpen(false)}
          />
          {pastDueOnly.length > 0 ? (
            <NoticeList
              title="Past its date"
              notices={pastDueOnly}
              empty=""
              onFollow={() => setOpen(false)}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-[12px]">
          <Link
            to="/inbox"
            onClick={() => setOpen(false)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Leadership Inbox
          </Link>
          <Link
            to="/weekly-agenda"
            onClick={() => setOpen(false)}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Your week
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const key = (notice: Pick<Notice, "itemType" | "itemId">) => `${notice.itemType}:${notice.itemId}`;

function NoticeList({
  title,
  notices,
  empty,
  onFollow,
}: {
  title: string;
  notices: Notice[];
  empty: string;
  onFollow: () => void;
}) {
  return (
    <section className="px-4 py-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {notices.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {notices.map((notice) => (
            <li key={key(notice)}>
              <Link
                to={notice.href.to}
                {...(notice.href.search ? { search: notice.href.search } : {})}
                onClick={onFollow}
                className="-mx-2 block rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <span className="block text-[13px] leading-5">{notice.title}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {notice.kind === "ask" && notice.fromId ? (
                    <>
                      <PersonName personId={notice.fromId} /> ·{" "}
                    </>
                  ) : null}
                  {notice.context}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{empty}</p>
      ) : null}
    </section>
  );
}
