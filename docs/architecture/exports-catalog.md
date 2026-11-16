---
title: 'Package Exports Catalog'
description: 'Generated catalog of every subpath exported by @repo/shared and @repo/ui, with the names each one publishes, so a helper is found instead of written twice.'
sidebar:
  order: 8
---

<!-- GENERATED FILE. Run `pnpm generate:arch-map` to refresh it; hand edits are overwritten. -->

Read this before writing a helper. The repeated failure it exists for is small and expensive: a
second currency formatter, a second date helper, a second `cn`, written because a grep missed the
one already exported and nothing failed when the duplicate shipped.

The subpaths come from each package `exports` map, so this is what another workspace can actually
import, not what happens to sit in `src`. Names come from the TypeScript AST of the entry file,
following `export *` re-exports. Regenerate with `pnpm generate:arch-map`.

## `@repo/shared`

- `@repo/shared/audit` (`packages/shared/src/audit/index.ts`): `AUDIT_ACTIONS`, `AUDIT_PII_ERASED_VALUE`, `AUDIT_PII_FIELDS`, `AuditAction`, `AuditPiiField`
- `@repo/shared/constants` (`packages/shared/src/constants/index.ts`): `APP_LOCALE`, `AUDIT_LOG_LIST_DEFAULT_LIMIT`, `AUDIT_LOG_LIST_MAX_LIMIT`, `CSRF_HEADER`, `CSRF_TOKEN_PATH`, `EMAIL_CHANGE_TOKEN_TTL_MS`, `formatTokenTtl`, `PASSWORD_RESET_TOKEN_TTL_MS`, `PRODUCT_NAME`, `PRODUCT_SLUG`, `VERIFICATION_TOKEN_TTL_MS`
- `@repo/shared/errors` (`packages/shared/src/errors/index.ts`): `AppErrorCode`, `AppErrorCodeType`
- `@repo/shared/logger` (`packages/shared/src/logger/index.ts`): `createCredentialSegmentRedactor`, `createLogger`, `CREDENTIAL_PATH_PREFIXES`, `getLogLevel`, `isSensitiveKey`, `LogEntry`, `Logger`, `LoggerOptions`, `LogLevel`, `normalizeError`, `redactCredentialPath`, `redactCredentialSegments`, `redactSensitive`, `SAFE_KEY_ALLOWLIST`, `scrubText`, `SENSITIVE_KEY_PATTERNS`, `setColorsEnabled`, `setLogLevel`, `setTimestampsEnabled`, `TraceContext`
- `@repo/shared/money` (`packages/shared/src/money/index.ts`): `asCurrencyCode`, `createMoney`, `CurrencyCode`, `formatMoney`, `isCurrencyCode`, `isMoneyAmount`, `Money`
- `@repo/shared/permissions` (`packages/shared/src/permissions/index.ts`): `ALL_ROLES`, `Role`, `ROLES`
- `@repo/shared/schemas` (`packages/shared/src/schemas/index.ts`): `accountDeletedOutput`, `AccountDeletedOutput`, `ackOutput`, `AckOutput`, `ActiveSessionItem`, `activeSessionsOutput`, `ActiveSessionsOutput`, `adminUserListPageOutput`, `AdminUserListPageOutput`, `AUDIT_LOG_LIST_DEFAULT_LIMIT`, `AUDIT_LOG_LIST_MAX_LIMIT`, `AuditLogItem`, `auditLogListInput`, `AuditLogListInput`, `auditLogListOutput`, `AuditLogListOutput`, `authAckOutput`, `AuthAckOutput`, `ChangePasswordInput`, `changePasswordSchema`, `ConfirmEmailChangeInput`, `confirmEmailChangeSchema`, `ConfirmPasswordInput`, `confirmPasswordSchema`, `DATA_EXPORT_SCHEMA_VERSION`, `DeleteAccountInput`, `deleteAccountSchema`, `emailSchema`, `ForgotPasswordInput`, `forgotPasswordSchema`, `IPasswordRequirement`, `LoginInput`, `loginOutput`, `LoginOutput`, `loginSchema`, `PASSWORD_REQUIREMENTS`, `passwordSchema`, `PingInput`, `pingInputSchema`, `PingOutput`, `pingOutputSchema`, `RegisterInput`, `registerOutput`, `RegisterOutput`, `registerSchema`, `RequestEmailChangeInput`, `requestEmailChangeSchema`, `ResendVerificationInput`, `resendVerificationSchema`, `ResetPasswordInput`, `resetPasswordSchema`, `ResetPasswordTokenStateInput`, `resetPasswordTokenStateOutput`, `ResetPasswordTokenStateOutput`, `resetPasswordTokenStateSchema`, `ResetUserTwoFactorInput`, `resetUserTwoFactorSchema`, `RevokeSessionInput`, `revokeSessionSchema`, `turnstileTokenSchema`, `TwoFactorActivateInput`, `twoFactorActivateSchema`, `TwoFactorBeginEnrollmentInput`, `twoFactorBeginEnrollmentSchema`, `TwoFactorDisableInput`, `twoFactorDisableSchema`, `twoFactorRecoveryCodesOutput`, `TwoFactorRecoveryCodesOutput`, `TwoFactorRegenerateInput`, `twoFactorRegenerateSchema`, `twoFactorSetupOutput`, `TwoFactorSetupOutput`, `twoFactorStatusOutput`, `TwoFactorStatusOutput`, `UserActionInput`, `userActionSchema`, `UserDataExport`, `userDataExportOutput`, `userProfileOutput`, `UserProfileOutput`, `VerifyEmailInput`, `verifyEmailSchema`, `VerifyTwoFactorInput`, `verifyTwoFactorSchema`
- `@repo/shared/types` (`packages/shared/src/types/index.ts`): `ErrorResponse`, `HealthCheckResponse`

## `@repo/ui`

- `@repo/ui/alert-dialog` (`packages/ui/src/components/alert-dialog.tsx`): `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogOverlay`, `AlertDialogPortal`, `AlertDialogTitle`, `AlertDialogTrigger`
- `@repo/ui/animations` (`packages/ui/src/animations/index.ts`): `AnimationVariant`, `animationVariants`, `distances`, `durations`, `MOTION_ANCHORED_CLASS`, `MOTION_CROSSFADE_CLASS`, `MOTION_DIALOG_CLASS`, `MOTION_FADE_CLASS`, `MOTION_LAYOUT_CLASS`, `MOTION_PANEL_CLASS`, `MOTION_PRESS_CLASS`, `MOTION_ROW_ENTER_CLASS`, `stagger`, `staggerDelay`, `TransitionPreset`, `transitions`
- `@repo/ui/avatar` (`packages/ui/src/components/avatar.tsx`): `Avatar`, `AvatarBadge`, `AvatarFallback`, `AvatarGroup`, `AvatarGroupCount`, `AvatarImage`
- `@repo/ui/badge` (`packages/ui/src/components/badge.tsx`): `Badge`, `badgeVariants`
- `@repo/ui/breadcrumb` (`packages/ui/src/components/breadcrumb.tsx`): `Breadcrumb`, `BreadcrumbEllipsis`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbList`, `BreadcrumbPage`, `BreadcrumbSeparator`
- `@repo/ui/button` (`packages/ui/src/components/button.tsx`): `Button`, `buttonVariants`
- `@repo/ui/card` (`packages/ui/src/components/card.tsx`): `Card`, `CardAction`, `CardContent`, `CardDescription`, `CardFooter`, `CardHeader`, `CardTitle`
- `@repo/ui/checkbox` (`packages/ui/src/components/checkbox.tsx`): `Checkbox`
- `@repo/ui/collapsible` (`packages/ui/src/components/collapsible.tsx`): `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger`
- `@repo/ui/color-picker` (`packages/ui/src/components/color-picker.tsx`): `ColorPicker`, `ColorPickerContent`, `ColorPickerTrigger`, `IColorPickerProps`
- `@repo/ui/combobox` (`packages/ui/src/components/combobox.tsx`): `Combobox`, `groupOptions`, `IComboboxOption`, `IComboboxProps`
- `@repo/ui/command` (`packages/ui/src/components/command.tsx`): `Command`, `CommandDialog`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList`, `CommandSeparator`, `CommandShortcut`
- `@repo/ui/confirm-dialog` (`packages/ui/src/components/confirm-dialog.tsx`): `ConfirmDialog`, `ConfirmDialogTone`, `IConfirmDialogProps`
- `@repo/ui/container` (`packages/ui/src/primitives/container.tsx`): `Container`
- `@repo/ui/date-field` (`packages/ui/src/components/date-field.tsx`): `DateField`, `IDateFieldLabels`, `IDateFieldProps`
- `@repo/ui/detail-drawer` (`packages/ui/src/components/detail-drawer.tsx`): `DetailDrawer`, `DetailDrawerBody`, `DetailDrawerCard`, `DetailDrawerClose`, `DetailDrawerContent`, `detailDrawerContentVariants`, `DetailDrawerField`, `DetailDrawerFields`, `DetailDrawerFooter`, `DetailDrawerHeader`, `DetailDrawerSection`, `DetailDrawerSummary`, `DetailDrawerTab`, `DetailDrawerTabPanel`, `DetailDrawerTabs`, `DetailDrawerTabsList`, `DetailDrawerTitle`, `DetailDrawerTrigger`, `IDetailDrawerCloseProps`, `IDetailDrawerContentProps`, `IDetailDrawerFieldProps`, `IDetailDrawerProps`, `IDetailDrawerSectionProps`
- `@repo/ui/dialog` (`packages/ui/src/components/dialog.tsx`): `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`
- `@repo/ui/double-sheet` (`packages/ui/src/components/double-sheet.tsx`): `DoubleSheet`, `DoubleSheetBody`, `DoubleSheetClose`, `DoubleSheetClosePrimitive`, `DoubleSheetContent`, `doubleSheetContentVariants`, `DoubleSheetFooter`, `DoubleSheetHeader`, `DoubleSheetSection`, `DoubleSheetTitle`, `DoubleSheetTrigger`, `IDoubleSheetCloseProps`, `IDoubleSheetContentProps`, `IDoubleSheetProps`, `IDoubleSheetSectionProps`
- `@repo/ui/dropdown-menu` (`packages/ui/src/components/dropdown-menu.tsx`): `DropdownMenu`, `DropdownMenuCheckboxItem`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuPortal`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubContent`, `DropdownMenuSubTrigger`, `DropdownMenuTrigger`
- `@repo/ui/dropzone` (`packages/ui/src/components/dropzone.tsx`): `Dropzone`, `DropzoneContent`, `FileList`, `FileListItem`
- `@repo/ui/editor` (`packages/ui/src/components/editor.tsx`): `Editor`, `EditorBubbleMenu`, `EditorContent`, `EditorToolbar`
- `@repo/ui/error-boundary` (`packages/ui/src/components/error-boundary.tsx`): `ErrorBoundary`, `ErrorFallback`
- `@repo/ui/form` (`packages/ui/src/components/form.tsx`): `Form`, `FormControl`, `FormDescription`, `FormField`, `FormItem`, `FormLabel`, `FormMessage`, `useFormField`
- `@repo/ui/gantt` (`packages/ui/src/components/gantt.tsx`): `GanttBar`, `GanttChart`, `GanttHeader`, `GanttMilestone`, `GanttRow`, `IGanttTask`
- `@repo/ui/hooks/use-mobile` (`packages/ui/src/hooks/use-mobile.ts`): `useIsMobile`
- `@repo/ui/input` (`packages/ui/src/components/input.tsx`): `Input`
- `@repo/ui/kanban` (`packages/ui/src/components/kanban.tsx`): `KanbanBoard`, `KanbanCard`, `KanbanCardType`, `KanbanColumn`, `KanbanColumnHeader`, `KanbanColumnType`
- `@repo/ui/label` (`packages/ui/src/components/label.tsx`): `Label`
- `@repo/ui/lib/calendar` (`packages/ui/src/lib/calendar.ts`): `addUtcDays`, `addUtcMonths`, `dateEntryPattern`, `DatePart`, `DAYS_PER_WEEK`, `daysBetweenUtc`, `endOfUtcMonth`, `fromIsoDate`, `IDateEntryPattern`, `isSameUtcDay`, `isSameUtcMonth`, `isWeekend`, `makeUtcDate`, `mondayFirstIndex`, `monthGridDays`, `monthGridWeeks`, `startOfUtcDay`, `startOfUtcMonth`, `todayUtc`, `toIsoDate`, `weekdayNames`, `WEEKS_PER_MONTH_GRID`
- `@repo/ui/lib/overlay` (`packages/ui/src/lib/overlay.ts`): `IOverlayDockLayerState`, `IOverlayDockPresenceProps`, `OVERLAY_FADE_CLASS`, `OVERLAY_SCRIM_CLASS`, `OVERLAY_SLIDE_RIGHT_CLASS`, `OverlayDockKind`, `OverlayDockPresence`, `useOverlayDockLayer`, `useOverlayDockScrimActive`
- `@repo/ui/lib/utils` (`packages/ui/src/lib/utils.ts`): `cn`
- `@repo/ui/list-surface` (`packages/ui/src/components/list-surface.tsx`): `IListSurfaceProps`, `IListTabProps`, `ListSurface`, `ListSurfaceFooter`, `ListSurfaceState`, `ListTab`, `ListTabPanel`, `ListTabs`, `ListTabsActions`, `ListTabsList`, `ListTabsRow`, `ListToolbar`, `ListToolbarActions`, `ListToolbarSearch`
- `@repo/ui/nav-rail` (`packages/ui/src/components/nav-rail.tsx`): `NavRailBrand`, `NavRailDensity`, `NavRailFooter`, `NavRailGroupLabel`, `navRailGroupLabelClass`, `NavRailIdentity`, `navRailItemClass`
- `@repo/ui/page-skeleton` (`packages/ui/src/components/page-skeleton.tsx`): `PageSkeleton`, `PageSkeletonVariant`
- `@repo/ui/pagination` (`packages/ui/src/components/pagination.tsx`): `IPaginationLabels`, `IPaginationProps`, `Pagination`
- `@repo/ui/popover` (`packages/ui/src/components/popover.tsx`): `Popover`, `PopoverAnchor`, `PopoverContent`, `PopoverTrigger`
- `@repo/ui/radio-group` (`packages/ui/src/components/radio-group.tsx`): `RadioGroup`, `RadioGroupItem`
- `@repo/ui/rating` (`packages/ui/src/components/rating.tsx`): `IRatingProps`, `Rating`, `ratingVariants`
- `@repo/ui/relative-time` (`packages/ui/src/components/relative-time.tsx`): `IRelativeTimeProps`, `RelativeTime`
- `@repo/ui/section` (`packages/ui/src/primitives/section.tsx`): `Section`
- `@repo/ui/select` (`packages/ui/src/components/select.tsx`): `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue`
- `@repo/ui/separator` (`packages/ui/src/components/separator.tsx`): `Separator`
- `@repo/ui/sheet` (`packages/ui/src/components/sheet.tsx`): `Sheet`, `SheetClose`, `SheetContent`, `SheetDescription`, `SheetFooter`, `SheetHeader`, `SheetTitle`, `SheetTrigger`
- `@repo/ui/sidebar` (`packages/ui/src/components/sidebar.tsx`): `Sidebar`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarGroupLabel`, `SidebarHeader`, `SidebarInput`, `SidebarInset`, `SidebarMenu`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuButton`, `SidebarMenuItem`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubButton`, `SidebarMenuSubItem`, `SidebarProvider`, `SidebarRail`, `SidebarSeparator`, `SidebarTrigger`, `useSidebar`
- `@repo/ui/skeleton` (`packages/ui/src/components/skeleton.tsx`): `Skeleton`
- `@repo/ui/sonner` (`packages/ui/src/components/sonner.tsx`): `toast`, `Toaster`
- `@repo/ui/spinner` (`packages/ui/src/components/spinner.tsx`): `ISpinnerProps`, `Spinner`, `spinnerVariants`
- `@repo/ui/stat-tile` (`packages/ui/src/components/stat-tile.tsx`): `IStatTileProps`, `statFigureVariants`, `StatTile`
- `@repo/ui/status-pill` (`packages/ui/src/components/status-pill.tsx`): `IStatusPillProps`, `StatusPill`, `statusPillVariants`, `StatusTone`
- `@repo/ui/switch` (`packages/ui/src/components/switch.tsx`): `Switch`
- `@repo/ui/table` (`packages/ui/src/components/table.tsx`): `Table`, `TableBody`, `TableCell`, `TableFooter`, `TableHead`, `TableHeader`, `TableRow`
- `@repo/ui/tabs` (`packages/ui/src/components/tabs.tsx`): `Tabs`, `TabsContent`, `TabsList`, `tabsListVariants`, `TabsTrigger`
- `@repo/ui/tags-input` (`packages/ui/src/components/tags-input.tsx`): `ITagsInputProps`, `Tag`, `TagsInput`
- `@repo/ui/textarea` (`packages/ui/src/components/textarea.tsx`): `Textarea`
- `@repo/ui/theme` (`packages/ui/src/theme/index.ts`): `COLOR_THEMES`, `ColorTheme`, `DEFAULT_COLOR_THEME`, `IColorThemeDefinition`, `IThemePreviewColors`, `ThemeMode`
- `@repo/ui/theme-selector` (`packages/ui/src/components/theme-selector.tsx`): `IThemeSelectorProps`, `ThemeSelector`
- `@repo/ui/toolbar` (`packages/ui/src/components/toolbar.tsx`): `IToolbarProps`, `Toolbar`, `ToolbarButton`, `ToolbarGroup`, `ToolbarSeparator`, `ToolbarToggle`, `toolbarVariants`
- `@repo/ui/tooltip` (`packages/ui/src/components/tooltip.tsx`): `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger`
- `@repo/ui/tree` (`packages/ui/src/components/tree.tsx`): `ITreeItemProps`, `ITreeNode`, `ITreeProps`, `Tree`, `TreeIndicator`, `TreeItem`
- `@repo/ui/ui-labels` (`packages/ui/src/components/ui-labels.tsx`): `DEFAULT_UI_LABELS`, `IUiLabels`, `UiLabelsProvider`, `useUiLabels`
