import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, BookOpen, CircleHelp, Compass, Home, Search, X } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { GuideResponse, GuideSuggestion, KnowledgeType } from "../core/types";
import { GuideContent } from "./guide-content";
import { useGuide, useOptionalGuide } from "./guide-provider";
import { GuideWalkthrough } from "./guide-walkthrough";

/**
 * The Guide panel.
 *
 * A right rail beside the page on wide screens, a sheet over it on narrower
 * ones. Opening and closing never navigates or disturbs the page underneath.
 *
 * It presents curated help, not generated answers: there is no typing
 * indicator, and a question it cannot match says so and offers topics instead.
 */

/* Wide enough that navigation, the page and the Guide all stay usable side by
   side; below it the Guide is a sheet over the page instead. */
export const GUIDE_RAIL_MEDIA = "(min-width: 1440px)";
const WIDE = GUIDE_RAIL_MEDIA;

function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Mount once in the application shell, beside the main content. */
export function GuidePanel() {
  const guide = useGuide();
  const wide = useWide();
  if (!guide.enabled) return null;

  if (wide) {
    if (!guide.isOpen) return null;
    return (
      <aside
        aria-label="Guide"
        data-print="hide"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            guide.close();
          }
        }}
        className="sticky top-[var(--demo-bar)] flex h-[calc(100vh-var(--demo-bar))] w-[22rem] shrink-0 flex-col border-l border-border bg-surface"
      >
        <GuideBody />
      </aside>
    );
  }

  return (
    <Sheet open={guide.isOpen} onOpenChange={(open) => (open ? guide.open() : guide.close())}>
      {/* The Guide's header has its own close button; the sheet's corner one
          would sit on top of it. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button.absolute]:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Guide</SheetTitle>
          <SheetDescription>Help for this page and Oikonomia</SheetDescription>
        </SheetHeader>
        <GuideBody />
      </SheetContent>
    </Sheet>
  );
}

function GuideBody() {
  const guide = useGuide();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    guide.ask(query);
    setQuery("");
  };

  return (
    <>
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <IconButton label="Previous help" disabled={!guide.canGoBack} onClick={guide.back}>
          <ArrowLeft className="size-4" aria-hidden />
        </IconButton>
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[14px] font-medium">
          <Compass className="size-4 shrink-0 text-primary" aria-hidden />
          Guide
        </h2>
        <IconButton label="Help for this page" onClick={guide.goHome}>
          <Home className="size-4" aria-hidden />
        </IconButton>
        <IconButton label="Browse all help" onClick={guide.browse}>
          <BookOpen className="size-4" aria-hidden />
        </IconButton>
        <IconButton label="Close the Guide" onClick={guide.close}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-busy={guide.loading}>
        {guide.loading || !guide.response ? (
          <p className="text-[13px] text-muted-foreground">Loading help…</p>
        ) : (
          <ResponseView response={guide.response} />
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border px-3 py-2.5">
        <label className="sr-only" htmlFor="guide-query">
          Ask about this page or Oikonomia
        </label>
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 focus-within:border-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            id="guide-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask about this page or Oikonomia…"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Answers come from Oikonomia&apos;s help, matched to your words.
        </p>
      </form>
    </>
  );
}

function ResponseView({ response }: { response: GuideResponse }) {
  const guide = useGuide();
  const open = (id: string) => guide.openTopic(id);
  const go = (id: string) => guide.navigate(id);
  const canGo = (id: string) => guide.host.canNavigate(id);

  switch (response.kind) {
    case "home":
      return (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-[18px] leading-tight">{response.title}</h3>
            {response.summary ? (
              <p className="mt-1 text-[13px] text-muted-foreground">{response.summary}</p>
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Help with Oikonomia. Ask a question below, or browse all help.
              </p>
            )}
          </div>
          {response.suggestions.length > 0 ? (
            <SuggestionList title="Help for this page" items={response.suggestions} onOpen={open} />
          ) : null}
          {response.walkthroughs.length > 0 ? (
            <SuggestionList title="Walk me through" items={response.walkthroughs} onOpen={open} />
          ) : null}
          <button
            type="button"
            onClick={guide.browse}
            className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Browse all help
          </button>
        </div>
      );

    case "article":
      return (
        <article className="space-y-4">
          <ItemHeading item={response.item} />
          <GuideContent
            blocks={response.body}
            onTopic={open}
            onDestination={go}
            canNavigate={canGo}
          />
          {response.destinations.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {response.destinations.map((destination) => (
                <button
                  key={destination.id}
                  type="button"
                  onClick={() => go(destination.id)}
                  className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-muted"
                >
                  {destination.label}
                </button>
              ))}
            </div>
          ) : null}
          {response.related.length > 0 ? (
            <SuggestionList title="Related" items={response.related} onOpen={open} />
          ) : null}
        </article>
      );

    case "walkthrough":
      return (
        <div className="space-y-4">
          <ItemHeading item={response.item} />
          <GuideWalkthrough
            key={response.item.id}
            item={response.item}
            steps={response.steps}
            onTopic={open}
          />
          {response.related.length > 0 ? (
            <SuggestionList title="Related" items={response.related} onOpen={open} />
          ) : null}
        </div>
      );

    case "results":
      return (
        <div className="space-y-4">
          <p className="text-[12px] text-muted-foreground">
            You asked: <span className="text-foreground">“{response.query}”</span>
          </p>
          {response.answer ? <ResponseView response={response.answer} /> : null}
          {response.results.length > 0 ? (
            <SuggestionList
              title={response.answer ? "Also relevant" : "Topics that match"}
              items={response.results}
              onOpen={open}
            />
          ) : null}
        </div>
      );

    case "fallback":
      return (
        <div className="space-y-4">
          {response.query ? (
            <p className="text-[12px] text-muted-foreground">
              You asked: <span className="text-foreground">“{response.query}”</span>
            </p>
          ) : null}
          <div>
            <h3 className="text-[14px] font-medium">
              {response.query
                ? "I couldn't find an answer to that."
                : "That topic isn't available."}
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Try other words, or one of these topics.
            </p>
          </div>
          {response.suggestions.length > 0 ? (
            <SuggestionList title="These may help" items={response.suggestions} onOpen={open} />
          ) : null}
          <button
            type="button"
            onClick={guide.browse}
            className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Browse all help
          </button>
        </div>
      );

    case "browse":
      return (
        <div className="space-y-5">
          <h3 className="font-display text-[18px] leading-tight">All help</h3>
          {response.categories.map((category) => (
            <SuggestionList
              key={category.id}
              title={category.title}
              items={category.items}
              onOpen={open}
            />
          ))}
        </div>
      );
  }
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  concept: "Explanation",
  page: "Page",
  procedure: "How to",
  walkthrough: "Walkthrough",
  permission: "Access",
  troubleshooting: "Troubleshooting",
};

function ItemHeading({ item }: { item: GuideSuggestion }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {TYPE_LABEL[item.type]}
      </p>
      <h3 className="font-display text-[18px] leading-tight">{item.title}</h3>
    </div>
  );
}

function SuggestionList({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: GuideSuggestion[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className="block text-[13px] font-medium leading-5">{item.title}</span>
              <span className="block text-[12px] leading-5 text-muted-foreground">
                {TYPE_LABEL[item.type]} · {item.summary}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The top-bar button that opens and closes the Guide. */
export function GuideToggle({ className }: { className?: string }) {
  const guide = useGuide();
  const button = useRef<HTMLButtonElement>(null);
  if (!guide.enabled) return null;
  return (
    <button
      ref={button}
      type="button"
      aria-label={guide.isOpen ? "Close the Guide" : "Open the Guide"}
      aria-expanded={guide.isOpen}
      onClick={() => {
        guide.setReturnFocus(button.current);
        guide.toggle();
      }}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        guide.isOpen && "bg-muted text-foreground",
        className,
      )}
    >
      <CircleHelp className="size-4" aria-hidden />
    </button>
  );
}

/**
 * A `[?]` beside a control that opens the Guide at one topic, without leaving
 * the page. Renders nothing where the Guide is not mounted.
 */
export function GuideHint({ topic, label }: { topic: string; label: string }) {
  const guide = useOptionalGuide();
  const button = useRef<HTMLButtonElement>(null);
  if (!guide?.enabled) return null;
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        guide.setReturnFocus(button.current);
        guide.openTopic(topic);
      }}
      className="inline-grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <CircleHelp className="size-3.5" aria-hidden />
    </button>
  );
}
