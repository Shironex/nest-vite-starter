import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AUDIT_LOG_LIST_DEFAULT_LIMIT } from '@repo/shared/constants';
import type { AuditLogItem, AuditLogListInput } from '@repo/shared/schemas';
import type { AuditAction } from '@repo/shared/audit';
import { formatDate, fromDateInputValue, APP_LOCALE } from '@/lib/i18n/format';
import { useCursorPages } from '@/features/shared/CursorPages.hooks';
// Side effect: attaches this feature's catalogs before the first t() call, so
// a hook rendered in isolation (a *.hooks.test.tsx) has the copy too.
import '../../Audit.i18n';
import {
  AUDIT_QUICK_FILTER_ACTIONS,
  auditActionLabelKey,
  auditActionTone,
  auditTargetLabelKey,
} from '../../Audit.constants';
import { changedFieldNames, diffSnapshots, metadataEntries } from '../../Audit.diff';
import { useAuditLogList } from '../../Audit.queries';
import type { AuditQuickFilter, IAuditRowView } from '../../Audit.types';
import type { AuditLogTab, IAuditLogPageView, IAuditPaginationView } from './AuditLogPage.types';

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });

const PAGE_SIZE = AUDIT_LOG_LIST_DEFAULT_LIMIT;

const TAB_ORDER: readonly AuditLogTab[] = ['all', 'failedLogins'];

/**
 * Every tab but "all" is a fixed action set. They are tabs rather than
 * toggles because a toggle beside the event-type dropdown can be engaged while
 * the dropdown silently overrides it, and a user has no way to see that. A tab
 * is a place: exactly one is current.
 */
const TAB_QUICK_FILTER: Record<AuditLogTab, AuditQuickFilter | null> = {
  all: null,
  failedLogins: 'failedLogins',
};

/** First letters of the first and last word, upper-cased, at most two. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : (parts[0]?.charAt(1) ?? '');
  return `${first}${last}`.toUpperCase();
}

/** The `to` filter is a calendar day; the wire wants its last instant. */
function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Resolves a tab id off the tab row, ignoring anything not in the union. */
function toTab(value: string): AuditLogTab | undefined {
  return TAB_ORDER.find((tab) => tab === value);
}

/** One wire item, precomputed into everything its feed row renders. */
function buildRow(item: AuditLogItem, t: TFunction<'audit'>): IAuditRowView {
  const actor = item.actor;
  const isSystem = actor === null;
  const actorName = actor === null ? t('list.systemActor') : (actor.displayName ?? actor.email);
  const targetLabel =
    item.targetType === null
      ? null
      : `${t(auditTargetLabelKey(item.targetType), { defaultValue: item.targetType })}${
          item.targetId === null ? '' : ` (${item.targetId})`
        }`;

  return {
    id: item.id,
    actorName,
    actorInitials: isSystem ? 'SY' : initialsOf(actorName),
    isSystem,
    actionLabel: t(auditActionLabelKey(item.action), { defaultValue: item.action }),
    actionTone: auditActionTone(item.action, item.success),
    changes: diffSnapshots(item.before, item.after),
    changedFields: changedFieldNames(item.metadata),
    metaEntries: metadataEntries(item.metadata),
    targetLabel,
    reason: item.reason,
    ipAddress: item.ipAddress,
    userAgent: item.userAgent,
    correlationId: item.correlationId,
    success: item.success,
    whenLabel: `${formatDate(item.createdAt)} ${timeFormatter.format(item.createdAt)}`,
  };
}

/**
 * The audit screen: the trail's three slices as tabs, the structured narrowing
 * behind "Filtry", and one keyset page at a time.
 *
 * PAGING REPLACES RATHER THAN APPENDS. Accumulating pages onto one screen is
 * the wrong shape for an append-only trail: it grows without bound and leaves
 * a position nobody can state. `useCursorPages` keeps the stack of cursors
 * already visited so "Previous" is a pop, and the footer says where the
 * reader is.
 *
 * There are no page NUMBERS and there never will be: `audit.list` carries no
 * total by design. See `packages/shared/src/schemas/audit.ts` for why, and note
 * that a degraded footer is the honest answer rather than a missing feature.
 */
export function useAuditLogPage(): IAuditLogPageView {
  const { t } = useTranslation('audit');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [tab, setTab] = useState<AuditLogTab>('all');
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const pages = useCursorPages();

  /**
   * The tab and the event-type dropdown drive the same wire field, so engaging
   * one clears the other; the tab would otherwise look current while the
   * dropdown silently overrode it.
   */
  const quickFilter = TAB_QUICK_FILTER[tab];
  const actions: readonly AuditAction[] | undefined =
    quickFilter !== null
      ? AUDIT_QUICK_FILTER_ACTIONS[quickFilter]
      : action !== ''
        ? [action as AuditAction]
        : undefined;

  const fromDate = fromDateInputValue(fromValue);
  const toDate = fromDateInputValue(toValue);

  const listInput: AuditLogListInput = {
    limit: PAGE_SIZE,
    ...(pages.cursor !== undefined ? { cursor: pages.cursor } : {}),
    ...(actorId !== '' ? { actorId } : {}),
    ...(actions !== undefined ? { actions: [...actions] } : {}),
    ...(fromDate !== null ? { from: fromDate } : {}),
    ...(toDate !== null ? { to: endOfDay(toDate) } : {}),
  };

  const query = useAuditLogList(listInput);

  /**
   * The tab is NOT counted as an active filter: it is where the reader is, not
   * a narrowing they might have forgotten setting. The date range counts as one
   * filter rather than two, because "od 1 marca" with no end is still one
   * period.
   */
  const activeFilters = [actorId !== '', action !== '', fromValue !== '' || toValue !== ''].filter(
    Boolean,
  ).length;
  const hasActiveFilters = activeFilters > 0 || tab !== 'all';

  const rows = (query.data?.items ?? []).map((item) => buildRow(item, t));

  /*
   * `isPending` is the FIRST load and only the first load, because the query
   * keeps the previous page: five filters, the tab and the cursor are all in
   * the key, so without that every date-input keystroke replaced the rows with
   * skeleton bars and unmounted the pager.
   */
  const state = query.isError
    ? 'error'
    : query.isPending
      ? 'loading'
      : rows.length === 0
        ? 'empty'
        : 'ready';
  /** A filter or page change is in flight over rows that are still on screen. */
  const isRefreshing = query.isFetching && query.isPlaceholderData;

  const from = (pages.page - 1) * PAGE_SIZE + 1;
  const pagination: IAuditPaginationView | null =
    state !== 'ready'
      ? null
      : {
          summary: t('pagination.summary', { from, to: from + rows.length - 1 }),
          label: t('pagination.label'),
          hasPrevious: pages.hasPrevious,
          hasNext: (query.data?.nextCursor ?? null) !== null,
          isBusy: isRefreshing,
          onPrevious: pages.onPrevious,
          onNext: () => pages.onNext(query.data?.nextCursor ?? null),
        };

  /** A cursor addresses rows under one filter set only; both die together. */
  const reset = pages.reset;

  function onTabChange(next: string) {
    const resolved = toTab(next);
    if (resolved === undefined) return;
    setTab(resolved);
    setAction('');
    reset();
  }

  return {
    filters: {
      actorId,
      action,
      fromValue,
      toValue,
      activeFilters,
      onActorChange: (value) => {
        setActorId(value);
        reset();
      },
      onActionChange: (value) => {
        setAction(value);
        setTab('all');
        reset();
      },
      onFromChange: (value) => {
        setFromValue(value);
        reset();
      },
      onToChange: (value) => {
        setToValue(value);
        reset();
      },
      onClear: () => {
        setActorId('');
        setAction('');
        setFromValue('');
        setToValue('');
        reset();
      },
    },
    rows,
    state,
    isRefreshing,
    tab,
    tabs: TAB_ORDER.map((value) => ({ value, label: t(`tabs.${value}`) })),
    onTabChange,
    pagination,
    onRetry: () => {
      void query.refetch();
    },
    labels: {
      loadError: t('list.loadError'),
      retry: t('actions.retry', { ns: 'common' }),
      emptyTitle: hasActiveFilters ? t('list.emptyFiltered') : t('list.empty'),
      emptyHint: hasActiveFilters ? t('list.emptyFilteredHint') : t('list.emptyHint'),
    },
  };
}
