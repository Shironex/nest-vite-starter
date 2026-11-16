import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner';
import { useUiLabels } from '@repo/ui/ui-labels';

/**
 * The toaster.
 *
 * WHY THIS FILE CARRIES A `style` BLOCK RATHER THAN JUST CLASSES.
 *
 * Sonner paints its toast from CSS custom properties it declares on the
 * `[data-sonner-toaster]` element, and it injects that stylesheet at runtime
 * with `head.appendChild`, so it always lands AFTER the app's own stylesheet.
 * Its `[data-sonner-toaster][data-sonner-theme='light'] { --normal-bg: #fff }`
 * rule beats any same-specificity override the app ships, because source order
 * decides the tie and sonner is always last. A dark-mode session therefore gets
 * a white toast from a class-only fix: the cause is a library default, not a
 * missing `dark:` variant and not a hardcoded color in this repo.
 *
 * Setting sonner's own variables INLINE on the toaster element beats every
 * stylesheet rule outright, so the tie disappears. And because each one is a
 * `var()` onto a design token rather than a literal, the toast re-resolves the
 * moment `.dark` flips on `<html>`: it follows the theme in both directions
 * with no React state and no re-render.
 *
 * Only the `--normal-*` group and the greys behind the close button are set,
 * which is everything this app renders: sonner reaches for `--success-bg` and
 * friends only under `richColors`, which we do not enable. Those two names
 * would also COLLIDE with the `--success-bg` / `--warning-bg` tokens,
 * making `--success-bg: var(--success-bg)` a self-reference that CSS discards.
 *
 * `theme` is still worth passing from the app (see `__root.tsx`) so that
 * `data-sonner-theme` is honest for the handful of rules sonner keys off the
 * attribute directly. It is belt to this braces, not the load-bearing half.
 */
const TOASTER_STYLE = {
  '--normal-bg': 'var(--surface)',
  '--normal-bg-hover': 'var(--surface-hover)',
  '--normal-border': 'var(--border)',
  '--normal-border-hover': 'var(--border-strong)',
  '--normal-text': 'var(--text-primary)',
  // The close button reads the gray ramp directly rather than `--normal-*`.
  '--gray2': 'var(--surface-hover)',
  '--gray4': 'var(--border)',
  '--gray5': 'var(--border-strong)',
  '--gray12': 'var(--text-primary)',
  // 8px in sonner, 10px in the `lg` radius that every card uses.
  '--border-radius': 'var(--radius)',
} as React.CSSProperties;

function Toaster({ style, containerAriaLabel, ...props }: ToasterProps) {
  const labels = useUiLabels();

  return (
    <SonnerToaster
      className="toaster group"
      // sonner's own default is the hard-coded "Notifications alt+T"; the
      // label comes from the app's strings like every other primitive's name.
      containerAriaLabel={containerAriaLabel ?? labels.notifications}
      style={{ ...TOASTER_STYLE, ...style }}
      toastOptions={{
        classNames: {
          toast: 'group toast group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-text-muted',
          actionButton: 'group-[.toast]:bg-brand group-[.toast]:text-brand-fg',
          cancelButton: 'group-[.toast]:bg-subtle group-[.toast]:text-text-secondary',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
