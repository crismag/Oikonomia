import { Check, Monitor, Moon, Sun } from "lucide-react";

import { themes, type Mode } from "@/domain/appearance";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance";

const modes: { id: Mode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "Match this device", icon: Monitor },
];

/**
 * Choose how Oikonomia looks on this browser.
 *
 * Each theme is shown as a small picture of itself — its sidebar, its page and
 * its area colours — rather than described, because a theme is chosen by eye.
 */
export function AppearancePicker() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <div className="space-y-5 px-4 py-4">
      <fieldset>
        <legend className="mb-2.5 text-[13px] font-semibold">Theme</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {themes.map((theme) => {
            const chosen = appearance.theme === theme.id;
            const [sidebar, ...colours] = theme.swatches;
            return (
              <label
                key={theme.id}
                className={cn(
                  "group relative cursor-pointer overflow-hidden rounded-2xl border bg-surface p-3 transition-shadow focus-within:ring-2 focus-within:ring-ring",
                  chosen ? "border-primary shadow-raised" : "border-border hover:shadow-card",
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={theme.id}
                  checked={chosen}
                  onChange={() => setAppearance({ theme: theme.id })}
                  className="sr-only"
                />
                {/* A miniature of the theme: sidebar, a hero band, two rows. */}
                <span
                  className="flex h-20 overflow-hidden rounded-xl border border-border"
                  aria-hidden
                >
                  <span className="w-1/4" style={{ background: sidebar }} />
                  <span className="flex flex-1 flex-col gap-1.5 bg-white p-2">
                    <span
                      className="h-5 rounded-md"
                      style={{
                        background: `linear-gradient(110deg, ${colours[0]}33, ${colours[2]}33)`,
                      }}
                    />
                    <span className="flex gap-1">
                      {colours.map((colour) => (
                        <span
                          key={colour}
                          className="h-3 flex-1 rounded-sm"
                          style={{ background: colour }}
                        />
                      ))}
                    </span>
                    <span className="h-1.5 w-2/3 rounded-full bg-slate-200" />
                  </span>
                </span>
                <span className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold">{theme.label}</span>
                  {chosen ? (
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" aria-hidden />
                      <span className="sr-only">Chosen</span>
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {theme.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-[13px] font-semibold">Light or dark</legend>
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {modes.map(({ id, label, icon: Icon }) => {
            const chosen = appearance.mode === id;
            return (
              <label
                key={id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-within:ring-2 focus-within:ring-ring",
                  chosen
                    ? "bg-surface font-semibold text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  value={id}
                  checked={chosen}
                  onChange={() => setAppearance({ mode: id })}
                  className="sr-only"
                />
                <Icon className="size-3.5" aria-hidden />
                {label}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Kept on this browser only. Other people using Oikonomia choose their own.
        </p>
      </fieldset>
    </div>
  );
}
