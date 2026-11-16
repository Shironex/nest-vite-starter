import * as React from 'react';

import { cn } from '@repo/ui/lib/utils';

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom type-body-regular text-text', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('sticky top-0 z-10 border-b border-border bg-subtle', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 type-body-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border transition-colors hover:bg-hover data-[state=selected]:bg-brand-50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * `type-label-overline text-text-muted` is the DEFAULT, not an opt-in.
 *
 * The design draws ONE head treatment for every list, so the primitive carries
 * it and no consumer has to opt in. A surface that overrides this class is
 * forking the head vocabulary: the previous fork gave the same column heading a
 * different size, weight and token family depending on which screen you were
 * on. `text-text-muted` is the design token; `text-muted-foreground` is the
 * shadcn leftover and is not the same color.
 */
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-12 px-4 text-left align-middle type-label-overline text-text-muted [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell };
