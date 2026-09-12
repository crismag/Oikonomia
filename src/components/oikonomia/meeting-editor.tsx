import { useEffect, useRef } from "react";
import {
  Bold,
  CheckSquare,
  Gavel,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  RemoveFormatting,
  Trash2,
  Underline,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { blockText, sanitizeInline } from "@/domain/meeting";
import type { MeetingBlock, MeetingBlockType } from "@/domain/types";

/**
 * The meeting document.
 *
 * Each block is its own contentEditable line. Structure lives in the block
 * list — headings, lists, checklists, decisions, follow-ups — while
 * contentEditable handles only inline marks inside a line, which is what it is
 * genuinely good at. Nothing here parses markup to find structure.
 *
 * Enter creates the next block, Backspace on an empty block removes it, so
 * writing flows without touching the toolbar.
 */

export type BlockCommand =
  { kind: "set-type"; type: MeetingBlockType } | { kind: "make-task" } | { kind: "delete" };

const blockClass: Record<MeetingBlockType, string> = {
  paragraph: "text-[15px] leading-relaxed",
  "heading-1": "font-display text-[22px] leading-tight mt-4",
  "heading-2": "font-display text-[18px] leading-tight mt-3",
  bullet: "text-[15px] leading-relaxed",
  numbered: "text-[15px] leading-relaxed",
  quote: "text-[15px] leading-relaxed italic text-muted-foreground",
  divider: "",
  checklist: "text-[15px] leading-relaxed",
  decision: "text-[15px] leading-relaxed",
  "follow-up": "text-[15px] leading-relaxed",
};

export function MeetingDocument({
  blocks,
  readOnly,
  focusedId,
  onFocus,
  onChange,
  onEnter,
  onRemove,
  onToggleCheck,
  onCycleFollowUp,
}: {
  blocks: MeetingBlock[];
  readOnly?: boolean;
  focusedId?: string | null;
  onFocus?: (id: string) => void;
  onChange?: (id: string, html: string) => void;
  onEnter?: (afterId: string) => void;
  onRemove?: (id: string) => void;
  onToggleCheck?: (id: string) => void;
  onCycleFollowUp?: (id: string) => void;
}) {
  let numbered = 0;

  return (
    <div className="space-y-1">
      {blocks.map((block) => {
        if (block.type === "numbered") numbered += 1;
        else if (block.type !== "checklist") numbered = 0;

        if (block.type === "divider") {
          return <hr key={block.id} className="my-4 border-border" aria-hidden={!readOnly} />;
        }

        const line = (
          <BlockLine
            block={block}
            readOnly={readOnly ?? false}
            focused={focusedId === block.id}
            {...(onFocus ? { onFocus } : {})}
            {...(onChange ? { onChange } : {})}
            {...(onEnter ? { onEnter } : {})}
            {...(onRemove ? { onRemove } : {})}
          />
        );

        /* Decision and follow-up are records that emerged from writing, so they
           are visually set apart from ordinary prose without becoming cards. */
        if (block.type === "decision") {
          return (
            <div
              key={block.id}
              className="my-2 border-l-2 border-status-done bg-status-done-soft/40 py-2 pl-3.5 pr-2"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-status-done">
                <Gavel className="size-3" aria-hidden />
                Decision
              </p>
              <div className="mt-0.5">{line}</div>
            </div>
          );
        }

        if (block.type === "follow-up") {
          const state = block.state ?? "open";
          return (
            <div
              key={block.id}
              className={cn(
                "my-2 border-l-2 py-2 pl-3.5 pr-2",
                state === "open"
                  ? "border-status-waiting bg-status-waiting-soft/40"
                  : "border-border bg-surface-muted",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "text-[11px] font-medium",
                    state === "open" ? "text-status-waiting" : "text-muted-foreground",
                  )}
                >
                  Follow-up{state !== "open" ? ` · ${state}` : ""}
                </p>
                {!readOnly && onCycleFollowUp ? (
                  <button
                    type="button"
                    onClick={() => onCycleFollowUp(block.id)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {state === "open" ? "Mark resolved" : "Reopen"}
                  </button>
                ) : null}
              </div>
              <div
                className={cn(
                  "mt-0.5",
                  /* Resolved, not faded: the strike-through says it, and the
                     text still has to be readable to be worth keeping. */
                  state !== "open" && "text-muted-foreground line-through",
                )}
              >
                {line}
              </div>
            </div>
          );
        }

        if (block.type === "checklist") {
          return (
            <div key={block.id} className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={block.checked ?? false}
                disabled={readOnly}
                onChange={() => onToggleCheck?.(block.id)}
                aria-label={blockText(block) || "Checklist item"}
                className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
              />
              <div
                className={cn(
                  "min-w-0 flex-1",
                  block.checked && "text-muted-foreground line-through",
                )}
              >
                {line}
              </div>
            </div>
          );
        }

        if (block.type === "bullet" || block.type === "numbered") {
          return (
            <div key={block.id} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-[9px] shrink-0 text-[13px] tabular-nums text-muted-foreground"
              >
                {block.type === "bullet" ? "•" : `${numbered}.`}
              </span>
              <div className="min-w-0 flex-1">{line}</div>
            </div>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote key={block.id} className="border-l-2 border-border pl-3.5">
              {line}
            </blockquote>
          );
        }

        return <div key={block.id}>{line}</div>;
      })}
    </div>
  );
}

/**
 * One editable line.
 *
 * The DOM is written to only when the value genuinely differs from what the
 * element already holds — otherwise React would reset the caret on every
 * keystroke.
 */
function BlockLine({
  block,
  readOnly,
  focused,
  onFocus,
  onChange,
  onEnter,
  onRemove,
}: {
  block: MeetingBlock;
  readOnly: boolean;
  focused: boolean;
  onFocus?: (id: string) => void;
  onChange?: (id: string, html: string) => void;
  onEnter?: (afterId: string) => void;
  onRemove?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* Sanitized on the way out as well as on the way in. The server checks the
       allowlist too, but this is the line that actually decides what a reader's
       browser executes, and content stored before that check existed is still
       in the database. `sanitizeInline` is idempotent, so re-running it on
       already-clean markup does not fight the editor. */
    const safe = sanitizeInline(block.html);
    if (el.innerHTML !== safe) el.innerHTML = safe;
  }, [block.html]);

  useEffect(() => {
    if (focused && ref.current && document.activeElement !== ref.current) {
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [focused]);

  const placeholder =
    block.type === "heading-1" || block.type === "heading-2"
      ? "Heading"
      : block.type === "decision"
        ? "What was agreed?"
        : block.type === "follow-up"
          ? "What is still unresolved?"
          : "Write…";

  return (
    <div
      ref={ref}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role={readOnly ? undefined : "textbox"}
      aria-label={readOnly ? undefined : placeholder}
      data-placeholder={placeholder}
      onFocus={() => onFocus?.(block.id)}
      onInput={(e) => onChange?.(block.id, sanitizeInline(e.currentTarget.innerHTML))}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter?.(block.id);
          return;
        }
        if (e.key === "Backspace" && !e.currentTarget.textContent?.trim() && onRemove) {
          e.preventDefault();
          onRemove(block.id);
        }
      }}
      className={cn(
        "min-w-0 outline-none",
        blockClass[block.type],
        !readOnly &&
          "rounded-sm empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus:bg-surface-muted/40",
      )}
    />
  );
}

/* ---------------------------------------------------------------- toolbar */

/**
 * Compact toolbar. Inline marks act on the current selection; block buttons
 * change the type of the focused block. Deliberately not a word processor.
 */
export function MeetingToolbar({
  activeType,
  onCommand,
  canMakeTask,
  showTasks = true,
  showMeetingMarks = true,
}: {
  activeType?: MeetingBlockType | undefined;
  onCommand: (command: BlockCommand) => void;
  canMakeTask: boolean;
  /**
   * Whether this document can produce tracked tasks at all.
   *
   * Meeting Notes can; a leadership report cannot yet. A control that will
   * never become available is not shown disabled — it is not shown.
   */
  showTasks?: boolean;
  /**
   * Whether decisions and follow-ups belong in this document.
   *
   * They are what a *meeting* records. A ministry plan does not hold them, and
   * a mark that nothing downstream reads is decoration pretending to be a
   * feature — so it is not offered rather than offered and ignored.
   */
  showMeetingMarks?: boolean;
}) {
  /* execCommand is deprecated but remains the only cross-browser way to apply
     an inline mark to a selection without shipping an editor framework. Its
     output is sanitized on the next input event. */
  const mark = (command: "bold" | "italic" | "underline" | "removeFormat") => {
    document.execCommand(command);
  };

  const link = () => {
    const url = window.prompt("Link to");
    if (!url) return;
    document.execCommand("createLink", false, url);
  };

  const types: { type: MeetingBlockType; icon: typeof Bold; label: string }[] = [
    { type: "heading-1", icon: Heading1, label: "Heading 1" },
    { type: "heading-2", icon: Heading2, label: "Heading 2" },
    { type: "bullet", icon: List, label: "Bullet list" },
    { type: "numbered", icon: ListOrdered, label: "Numbered list" },
    { type: "checklist", icon: CheckSquare, label: "Checklist" },
    { type: "quote", icon: Quote, label: "Quote" },
    { type: "divider", icon: Minus, label: "Divider" },
  ];

  return (
    <div
      data-print="hide"
      className="sticky top-14 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 overflow-x-auto border-b border-border bg-surface/95 px-1 py-1.5 backdrop-blur-sm"
    >
      <ToolButton label="Bold" onClick={() => mark("bold")}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton label="Italic" onClick={() => mark("italic")}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton label="Underline" onClick={() => mark("underline")}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton label="Link" onClick={link}>
        <Link2 className="size-4" />
      </ToolButton>
      <ToolButton label="Clear formatting" onClick={() => mark("removeFormat")}>
        <RemoveFormatting className="size-4" />
      </ToolButton>

      <Divider />

      {types.map(({ type, icon: Icon, label }) => (
        <ToolButton
          key={type}
          label={label}
          active={activeType === type}
          onClick={() => onCommand({ kind: "set-type", type })}
        >
          <Icon className="size-4" />
        </ToolButton>
      ))}

      {showMeetingMarks ? <Divider /> : null}

      {showMeetingMarks ? (
        <>
          <ToolButton
            label="Mark as decision"
            active={activeType === "decision"}
            onClick={() => onCommand({ kind: "set-type", type: "decision" })}
          >
            <Gavel className="size-4" />
          </ToolButton>
          <button
            type="button"
            onClick={() => onCommand({ kind: "set-type", type: "follow-up" })}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition-colors",
              activeType === "follow-up"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Follow-up
          </button>
        </>
      ) : null}
      {showTasks ? (
        <button
          type="button"
          disabled={!canMakeTask}
          onClick={() => onCommand({ kind: "make-task" })}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition-colors",
            canMakeTask ? "text-primary hover:bg-muted" : "text-disabled",
          )}
        >
          Create task
        </button>
      ) : null}

      <ToolButton
        label="Delete block"
        onClick={() => onCommand({ kind: "delete" })}
        className="ml-auto"
      >
        <Trash2 className="size-4" />
      </ToolButton>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function ToolButton({
  label,
  onClick,
  active,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      /* Keeps the caret in the document while the button is pressed. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
