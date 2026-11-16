import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away.
import '../../Help.i18n';
import { useHelpToursSection } from './HelpToursSection.hooks';

/**
 * The settings half of replay: every tour in the app, its screen, whether it
 * has been seen, and a control to run it again.
 *
 * Every row is replayable regardless of status, which is the whole point of
 * "replayable for everyone using the app as help": a tour that can only be
 * seen once is onboarding, not help.
 */
export default function HelpToursSection() {
  const v = useHelpToursSection();

  const rows = v.rows.map((row) => (
    <TableRow key={row.id} data-slot="help-tour-row">
      <TableCell className="type-body-medium text-text">{row.name}</TableCell>
      <TableCell className="type-body-small text-text-muted">{row.route}</TableCell>
      <TableCell className="type-body-small text-text-secondary">{row.statusLabel}</TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => v.onReplay(row.id)}
          aria-label={`${v.labels.replay}: ${row.name}`}
        >
          <Play className="size-4" aria-hidden="true" />
          <span>{v.labels.replay}</span>
        </Button>
      </TableCell>
    </TableRow>
  ));

  let content;
  if (v.isLoading) {
    content = <Skeleton className="h-40 w-full" data-slot="help-tours-loading" />;
  } else if (v.hasLoadError) {
    content = <p className="type-body-medium text-text-secondary">{v.labels.loadError}</p>;
  } else {
    content = (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="type-label-overline text-text-muted">
                {v.labels.columnTour}
              </TableHead>
              <TableHead className="type-label-overline text-text-muted">
                {v.labels.columnScreen}
              </TableHead>
              <TableHead className="type-label-overline text-text-muted">
                {v.labels.columnStatus}
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={v.isResetting}
            onClick={v.onResetAll}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span>{v.labels.resetAll}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card data-slot="help-tours">
      <CardHeader>
        <CardTitle>{v.labels.title}</CardTitle>
        <CardDescription>{v.labels.description}</CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
