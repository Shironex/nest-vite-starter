import { CircleHelp } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/tooltip';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away.
import '../../Help.i18n';
import { useTourLauncher } from './TourLauncher.hooks';

/**
 * The "Help" control in the app shell's topbar: half of the replay ask, and
 * the half that has to be one click away from wherever somebody is stuck.
 *
 * It carries `data-tour="app-help"` so the orientation tour can point at it,
 * which is how a person learns that every screen keeps its help in this spot.
 */
export default function TourLauncher() {
  const v = useTourLauncher();

  if (!v.isAvailable) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-tour="app-help"
            data-slot="tour-launcher"
            aria-label={v.label}
            /*
             * `aria-busy` rather than `disabled` while a tour runs. The control
             * is unreachable anyway (driver.js covers the page with its
             * overlay) and a second start is already refused in the hook, so
             * disabling buys nothing, and it costs the thing that matters: a
             * disabled button is BLURRED, which throws away the element focus
             * has to return to when the tour ends.
             */
            aria-busy={v.isRunning}
            onClick={v.onStart}
          >
            <CircleHelp className="size-5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{v.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
