# Recipe: in-app notifications

**When you need it:** users should see events inside the app (a bell, an unread count), not only in
their mailbox. The starter sends mail through the queue and has no notification model.

## Shape of the change

- **Model.** A `Notification` table: `id`, `userId`, `type`, a small `payload` JSON, `readAt`,
  `createdAt`, indexed on `(userId, readAt, createdAt)`. Add it in its own Prisma file and a
  migration, and include it in the account purge and the data export.
- **Producing.** A `NotificationService.create(userId, type, payload)` that other services call
  after their own write commits. Keep the payload to ids and short labels, never copy content
  that the user may later delete, and never put secrets in it.
- **Reading.** A `notifications` router behind `AuthMiddleware`: `list` (cursor pagination, the
  pattern in `audit.router.ts` and `features/shared/CursorPages.hooks.ts`), `unreadCount`,
  `markRead` and `markAllRead`. Every query is scoped by `ctx.user.id`.
- **Web.** A bell in the topbar that polls `unreadCount` with TanStack Query (a refetch interval
  of 30 to 60 seconds is plenty), and a page or popover for the list. Invalidate by path key
  after marking read, as the cache-invalidation note in `features/README.md` says.
- **Retention.** A `@Cron` sweep that deletes read notifications after N days, idempotent by
  predicate.

## Pitfalls

- Polling is enough until it is not. If you need instant delivery, add the
  [websockets](websockets.md) recipe and push a "refetch" signal rather than the notification
  itself, so the data path stays the one procedure.
- Write notifications outside the transaction that caused them when losing one is acceptable, and
  inside it when it must match the write; decide per type.
- Mail and in-app are separate channels with separate preferences. If users can opt out, store the
  preference and check it in the producer, not in the reader.
