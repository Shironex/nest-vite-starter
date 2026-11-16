import { LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/dropdown-menu';
import { useUserMenu } from './UserMenu.hooks';

export default function UserMenu() {
  const view = useUserMenu();

  if (!view) return null;

  const {
    displayName,
    email,
    initials,
    avatarUrl,
    isLogoutPending,
    labels,
    onLogout,
    onNavigateToSettings,
  } = view;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.trigger}
        className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Avatar size="sm" className="size-8">
          {/* Decorative: the trigger's aria-label already names the user. */}
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-brand-100 type-label-caption font-semibold text-brand-ink">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 rounded-lg" align="end" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex flex-col gap-px px-1 py-1.5 text-left">
            <span className="truncate type-body-medium text-text">{displayName}</span>
            <span className="truncate type-body-small text-text-tertiary">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNavigateToSettings}>
          <Settings className="size-4" />
          {labels.settings}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} disabled={isLogoutPending}>
          <LogOut className="size-4" />
          {labels.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
