import * as React from 'react';

import { cn } from '@repo/ui/lib/utils';

/**
 * Copy for the default fallback.
 *
 * WITHOUT THESE the boundary's copy would be hard-coded here rather than taken
 * from the app's strings table, and it is the boundary the three shells wrap around
 * `<Outlet/>`, so a render throw anywhere in the app would bypass the copy the
 * rest of the screen is written in. They are optional rather than required
 * because a consumer with no copy of its own still needs SOMETHING to render, and
 * because the boundary is also mounted in tests and stories.
 */
interface IErrorBoundaryLabels {
  // `| undefined` explicitly, not just `?`: under exactOptionalPropertyTypes
  // the boundary has to be able to FORWARD an absent label as `undefined` so
  // the fallback's own default applies.
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly retryLabel?: string | undefined;
  /**
   * Print the raw `error.message` under the description.
   *
   * OFF by default, and a prop rather than a build-time check, because this
   * package has no build environment of its own: it is consumed as source by
   * two Vite apps and by Astro, and only the consumer knows whether it is a
   * development build. The apps pass `import.meta.env.DEV`.
   */
  readonly showErrorDetail?: boolean | undefined;
}

interface IErrorBoundaryProps extends IErrorBoundaryLabels {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface IErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<IErrorBoundaryProps, IErrorBoundaryState> {
  constructor(props: IErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): IErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Spread rather than listed prop by prop: under
      // exactOptionalPropertyTypes an explicit `title={undefined}` is not the
      // same as an absent `title`, and the absent form is what lets the
      // fallback's own defaults apply.
      const { title, description, retryLabel, showErrorDetail } = this.props;

      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.reset}
          {...{ title, description, retryLabel, showErrorDetail }}
        />
      );
    }

    return this.props.children;
  }
}

const DEFAULT_LABELS = {
  title: 'Something went wrong',
  description: 'An unexpected error occurred.',
  retryLabel: 'Try again',
} as const;

/**
 * `error.message` is not rendered unless the caller asks for it.
 *
 * What reaches this boundary is a render throw, so the message is a JavaScript
 * internal ("Cannot read properties of undefined (reading 'x')") or, after a
 * deploy, the URL of an asset that 404'd. It used to be the description, which
 * put developer text in front of a user on a surface that must never
 * expose internals, and told them nothing they could act on.
 */
function ErrorFallback({
  error,
  onReset,
  className,
  title = DEFAULT_LABELS.title,
  description = DEFAULT_LABELS.description,
  retryLabel = DEFAULT_LABELS.retryLabel,
  showErrorDetail = false,
}: IErrorBoundaryLabels & {
  error?: Error | null;
  onReset?: () => void;
  className?: string;
}) {
  const detail = showErrorDetail ? error?.message : undefined;

  return (
    <div
      data-slot="error-fallback"
      className={cn('flex min-h-[200px] items-center justify-center p-4', className)}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="type-heading-h2">{title}</h2>
        <p className="mt-2 type-body-small text-muted-foreground">{description}</p>
        {detail !== undefined && detail !== '' && (
          <p className="mt-2 type-mono-small text-muted-foreground">{detail}</p>
        )}
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 type-body-medium text-primary-foreground transition-all hover:bg-primary/90"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export { ErrorBoundary, ErrorFallback };
