import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, Compass, LogOut, ShieldCheck } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession, useViewer } from "@/domain/session";
import { PersonAvatar } from "./person";

/**
 * The signed-in person.
 *
 * This replaced a persona switcher — a dropdown of four characters who came
 * with the product, any of whom you could become with one click. Useful for a
 * demonstration, and untrue as an account menu: it showed a name that belonged
 * to nobody and an identity that changed on a whim.
 *
 * What it shows now is the person whose record this browser is signed in as,
 * their role on that record, and the two things one does with an account.
 */
export function AccountMenu() {
  const { signOut } = useSession();
  const { persona, person } = useViewer();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 rounded-md border border-border py-1 pl-1 pr-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PersonAvatar personId={person.id} />
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-medium leading-tight">{person.name}</span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            {persona.label}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Account</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-[13px]">{person.name}</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">
            {persona.focus}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Repeatable on demand. Running it again reloads the organisation as
            it now stands; it confirms nothing on its own and duplicates
            nothing. */}
        <DropdownMenuItem asChild className="py-2">
          <Link to="/welcome" className="text-[13px]">
            <Compass className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Setup &amp; walkthrough
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild className="py-2">
          <Link to="/account-security" className="text-[13px]">
            <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Account &amp; security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            signOut();
            window.location.assign("/login");
          }}
          className="py-2 text-[13px]"
        >
          <LogOut className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
