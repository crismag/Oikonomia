import {
  BookOpen,
  CakeSlice,
  Church,
  HandHeart,
  MessageCircle,
  Sprout,
  UsersRound,
  UtensilsCrossed,
  Compass,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ScheduleCategory } from "@/domain/types";

/**
 * Category identity for the binder's recurring rhythms.
 *
 * The paper calendar distinguishes rhythms so a leader recognises the shape of
 * their month at a glance. Digitally that comes from icon plus a single quiet
 * accent bar — not a rainbow. Only four tones exist, shared across categories
 * by kind of activity, so the month reads as a rhythm rather than a legend.
 */

export const categoryLabel: Record<ScheduleCategory, string> = {
  "prayer-fasting": "Prayer & Fasting",
  chat: "CHAT",
  lifegroup: "Lifegroup",
  potbless: "Potbless",
  victuals: "Victuals",
  seed: "SEED",
  mentorship: "Mentorship",
  "ministry-meeting": "Ministry meeting",
  service: "Service",
  celebration: "Celebration",
  other: "Other",
};

export const categoryIcon: Record<ScheduleCategory, LucideIcon> = {
  "prayer-fasting": HandHeart,
  chat: MessageCircle,
  lifegroup: Sprout,
  potbless: UtensilsCrossed,
  victuals: UtensilsCrossed,
  seed: BookOpen,
  mentorship: Compass,
  "ministry-meeting": UsersRound,
  service: Church,
  celebration: CakeSlice,
  other: CalendarDays,
};

/**
 * Four tones, not eleven: gathering, formation, serving, and celebration.
 * Grouping keeps the month scannable and the palette disciplined.
 */
const tone: Record<ScheduleCategory, string> = {
  service: "text-status-approval",
  "prayer-fasting": "text-status-approval",
  lifegroup: "text-status-approval",
  chat: "text-status-approval",

  seed: "text-status-info",
  mentorship: "text-status-info",
  "ministry-meeting": "text-status-info",

  potbless: "text-status-waiting",
  victuals: "text-status-waiting",

  celebration: "text-status-done",
  other: "text-muted-foreground",
};

const barTone: Record<ScheduleCategory, string> = {
  service: "bg-status-approval",
  "prayer-fasting": "bg-status-approval",
  lifegroup: "bg-status-approval",
  chat: "bg-status-approval",

  seed: "bg-status-info",
  mentorship: "bg-status-info",
  "ministry-meeting": "bg-status-info",

  potbless: "bg-status-waiting",
  victuals: "bg-status-waiting",

  celebration: "bg-status-done",
  other: "bg-border-strong",
};

export function categoryTone(category: ScheduleCategory) {
  return tone[category];
}

export function categoryBar(category: ScheduleCategory) {
  return barTone[category];
}

export function CategoryIcon({
  category,
  className,
}: {
  category: ScheduleCategory;
  className?: string;
}) {
  const Icon = categoryIcon[category];
  return <Icon className={cn("size-3.5 shrink-0", tone[category], className)} aria-hidden />;
}

/** Used in pickers and legends, never as a badge on every calendar row. */
export function CategoryChip({ category }: { category: ScheduleCategory }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <CategoryIcon category={category} />
      {categoryLabel[category]}
    </span>
  );
}
