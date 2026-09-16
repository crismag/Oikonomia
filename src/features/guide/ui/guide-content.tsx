import type { ReactNode } from "react";

import type { GuideBlock, GuideInline } from "../core/types";

/**
 * Knowledge content, rendered as React text.
 *
 * There is no HTML path: every node is a component or a string, so nothing in
 * a knowledge file — or a future generated answer in the same shape — can
 * inject markup. Topic links open another item in the Guide; destination links
 * ask the host to navigate, and render as plain text when the reader may not
 * go there.
 */
export function GuideContent({
  blocks,
  onTopic,
  onDestination,
  canNavigate,
}: {
  blocks: GuideBlock[];
  onTopic: (id: string) => void;
  onDestination: (id: string) => void;
  canNavigate: (id: string) => boolean;
}) {
  const inline = (nodes: GuideInline[]): ReactNode[] =>
    nodes.map((node, index) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "strong":
          return (
            <strong key={index} className="font-medium text-foreground">
              {inline(node.children)}
            </strong>
          );
        case "em":
          return <em key={index}>{inline(node.children)}</em>;
        case "code":
          return (
            <code key={index} className="rounded bg-muted px-1 py-px font-mono text-[12px]">
              {node.text}
            </code>
          );
        case "topic":
          return (
            <button
              key={index}
              type="button"
              onClick={() => onTopic(node.id)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {inline(node.children)}
            </button>
          );
        case "destination":
          return canNavigate(node.id) ? (
            <button
              key={index}
              type="button"
              onClick={() => onDestination(node.id)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {inline(node.children)}
            </button>
          ) : (
            <span key={index}>{inline(node.children)}</span>
          );
      }
    });

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-foreground/90">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <h4 key={index} className="pt-1 text-[13px] font-medium text-foreground">
                {block.text}
              </h4>
            );
          case "paragraph":
            return <p key={index}>{inline(block.content)}</p>;
          case "note":
            return (
              <p
                key={index}
                className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[12px] text-muted-foreground"
              >
                {inline(block.content)}
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={index}
                className={
                  block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"
                }
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
