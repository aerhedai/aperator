"use client";

import {
  useClerk,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/nextjs";
import {
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  UserCog,
} from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function Avatar({
  imageUrl,
  label,
}: {
  imageUrl?: string | null;
  label: string;
}) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-accent-soft text-xs font-semibold text-app-accent-soft-foreground">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small avatar, same tradeoff as the sidebar's own logo image
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        label.charAt(0).toUpperCase()
      )}
    </span>
  );
}

/**
 * The single account surface, replacing the sidebar's previous three
 * separate widgets (Clerk's default OrganizationSwitcher + UserButton +
 * a settings link) — three fixed-width elements that, combined, didn't
 * reliably fit the sidebar's width on smaller windows. One compact
 * trigger here, one menu with everything: switch organisation, manage
 * account, manage organisation, app settings, sign out. "Manage" opens
 * Clerk's own UserProfile/OrganizationProfile screens (themed via
 * lib/clerk-appearance.ts) rather than reimplementing security-sensitive
 * account UI here.
 */
export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { user, isLoaded: userLoaded } = useUser();
  const { organization } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const clerk = useClerk();

  if (!userLoaded || !user) return null;

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const label = user.fullName ?? email ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-muted data-[open]:bg-muted",
          collapsed ? "justify-center" : "w-full",
        )}
        aria-label="Account and organisation menu"
      >
        <Avatar imageUrl={user.imageUrl} label={label} />
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-foreground">
                {organization?.name ?? label}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {email}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>{email}</DropdownMenuGroupLabel>
          <DropdownMenuItem onClick={() => clerk.openUserProfile()}>
            <UserCog />
            Manage account
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Organisations</DropdownMenuGroupLabel>
          {userMemberships.data?.map((membership) => (
            <DropdownMenuItem
              key={membership.organization.id}
              onClick={() =>
                setActive?.({ organization: membership.organization.id })
              }
            >
              <Building2 />
              <span className="flex-1 truncate">
                {membership.organization.name}
              </span>
              {membership.organization.id === organization?.id && (
                <Check className="text-foreground" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => clerk.openOrganizationProfile()}>
            <Building2 />
            Manage organisation
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => clerk.openCreateOrganization()}>
            <Plus />
            Create organisation
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLinkItem render={<Link href="/settings" />}>
          <SettingsIcon />
          Settings
        </DropdownMenuLinkItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => clerk.signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
