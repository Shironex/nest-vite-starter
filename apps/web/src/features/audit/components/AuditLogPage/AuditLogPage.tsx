import { Button } from '@repo/ui/button';
import {
  ListTab,
  ListTabPanel,
  ListTabs,
  ListTabsList,
  ListTabsRow,
  ListToolbar,
  ListToolbarActions,
} from '@repo/ui/list-surface';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away, and
// without this import the screen would render bare i18n keys under test.
import '../../Audit.i18n';
import { AuditLogFilters } from '../AuditLogFilters';
import { AuditLogTable } from '../AuditLogTable';
import { useAuditLogPage } from './AuditLogPage.hooks';

/**
 * The "Audit log" screen: the trail's three slices as tabs, the structured
 * narrowing behind "Filtry", and one keyset page at a time.
 *
 * It renders no `<h1>`: the app shell's topbar owns the page heading, and a
 * second top-level heading on the same screen would compete with it.
 *
 * The toolbar's left half is empty on purpose. There is deliberately no
 * free-text search over an audit trail: the fields worth searching are ids and
 * enum keys, and a box that matched neither would be an invitation to think the
 * trail had no record of something it does.
 */
export default function AuditLogPage() {
  const v = useAuditLogPage();

  const tabItems = v.tabs.map((item) => (
    <ListTab key={item.value} value={item.value}>
      {item.label}
    </ListTab>
  ));

  return (
    <div data-slot="audit-log-page">
      <ListTabs value={v.tab} onValueChange={v.onTabChange}>
        <ListTabsRow>
          <ListTabsList>{tabItems}</ListTabsList>
        </ListTabsRow>

        <ListTabPanel value={v.tab}>
          <ListToolbar>
            <ListToolbarActions className="ml-auto">
              <AuditLogFilters {...v.filters} />
            </ListToolbarActions>
          </ListToolbar>

          <AuditLogTable
            rows={v.rows}
            state={v.state}
            isRefreshing={v.isRefreshing}
            pagination={v.pagination}
            empty={
              <>
                <p className="type-body-strong text-text">{v.labels.emptyTitle}</p>
                <p className="type-body-regular text-text-muted">{v.labels.emptyHint}</p>
              </>
            }
            error={
              <>
                <p className="type-body-regular text-danger">{v.labels.loadError}</p>
                <Button type="button" variant="outline" size="sm" onClick={v.onRetry}>
                  {v.labels.retry}
                </Button>
              </>
            }
          />
        </ListTabPanel>
      </ListTabs>
    </div>
  );
}
