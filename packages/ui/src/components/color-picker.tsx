'use client';

import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@repo/ui/lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

interface IColorPickerProps {
  value?: string;
  onValueChange?: (value: string) => void;
  presets?: string[];
  showAlpha?: boolean;
  className?: string;
}

interface IColorPickerTriggerProps extends React.ComponentPropsWithoutRef<typeof Button> {
  value?: string;
}

interface IColorPickerContentProps {
  value?: string;
  onValueChange?: (value: string) => void;
  presets?: string[];
  showAlpha?: boolean;
}

interface IHSL {
  h: number;
  s: number;
  l: number;
  a?: number;
}

interface IRGB {
  r: number;
  g: number;
  b: number;
  a?: number;
}

// Color conversion utilities
const hexToRgb = (hex: string): IRGB | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1]!, 16),
        g: parseInt(result[2]!, 16),
        b: parseInt(result[3]!, 16),
        a: result[4] ? parseInt(result[4], 16) / 255 : 1,
      }
    : null;
};

const rgbToHex = (rgb: IRGB): string => {
  const toHex = (n: number) => {
    const hex = n.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  const alpha = rgb.a !== undefined ? toHex(Math.round(rgb.a * 255)) : 'ff';
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}${alpha}`;
};

const rgbToHsl = (rgb: IRGB): IHSL => {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    a: rgb.a ?? 1,
  };
};

const hslToRgb = (hsl: IHSL): IRGB => {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: hsl.a ?? 1,
  };
};

function SaturationPanel({
  hue,
  saturation,
  lightness,
  onChange,
}: {
  hue: number;
  saturation: number;
  lightness: number;
  onChange: (s: number, l: number) => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  const handlePointer = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
      const s = Math.round((x / rect.width) * 100);
      const l = Math.round(100 - (y / rect.height) * 100);
      onChange(s, Math.max(0, Math.min(100, l)));
    },
    [onChange],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    handlePointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    handlePointer(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  return (
    /*
     * `role="group"` + a span, not a `<label>`: a label promises an associated
     * form control, and the saturation panel below is a pointer-driven div with
     * no control to point at. A label bound to nothing is worse than none,
     * because assistive tech may attach it to whatever focusable element comes
     * next. The group carries the name instead.
     */
    <div className="space-y-2" role="group" aria-label="Color">
      <span className="text-xs font-medium">Color</span>
      <div
        ref={panelRef}
        className="relative h-40 w-full cursor-crosshair overflow-hidden rounded border border-input"
        style={{
          background: `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, hsl(${hue}, 100%, 50%))
          `,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="absolute h-4 w-4 rounded-full border-2 border-brand-fg shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{
            left: `${saturation}%`,
            top: `${100 - lightness}%`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

const ColorPicker = React.forwardRef<HTMLDivElement, IColorPickerProps>(
  (
    {
      value = '#ff0000ff',
      onValueChange,
      presets = [
        '#ff0000ff',
        '#00ff00ff',
        '#0000ffff',
        '#ffff00ff',
        '#ff00ffff',
        '#00ffffff',
        '#000000ff',
        '#ffffffff',
      ],
      showAlpha = true,
      className,
    },
    _ref,
  ) => {
    const [open, setOpen] = React.useState(false);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ColorPickerTrigger value={value} className={className} />
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4" align="start">
          <ColorPickerContent
            value={value}
            onValueChange={(v) => {
              onValueChange?.(v);
            }}
            presets={presets}
            showAlpha={showAlpha}
          />
        </PopoverContent>
      </Popover>
    );
  },
);

ColorPicker.displayName = 'ColorPicker';

const ColorPickerTrigger = React.forwardRef<HTMLButtonElement, IColorPickerTriggerProps>(
  ({ value = '#ff0000ff', className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="outline"
        className={cn('w-full justify-start gap-2', className)}
        data-slot="color-picker-trigger"
        {...props}
      >
        <div className="h-6 w-6 rounded border border-border" style={{ backgroundColor: value }} />
        <span className="flex-1 text-left font-mono text-sm">{value.toUpperCase()}</span>
        <ChevronDownIcon className="h-4 w-4 opacity-50" />
      </Button>
    );
  },
);

ColorPickerTrigger.displayName = 'ColorPickerTrigger';

const ColorPickerContent = React.forwardRef<HTMLDivElement, IColorPickerContentProps>(
  ({ value = '#ff0000ff', onValueChange, presets = [], showAlpha = true }, ref) => {
    // Derive initial HSL from the incoming `value` prop and resync during render
    // when the parent-controlled prop changes. This is React's recommended
    // pattern for "adjusting state when a prop changes", preferred over a
    // setState-in-useEffect, which the v7 react-hooks compiler rules flag as a
    // cascading-render hazard. See https://react.dev/learn/you-might-not-need-an-effect.
    const initialHsl = React.useMemo(() => {
      const rgb = hexToRgb(value);
      return rgb ? rgbToHsl(rgb) : { h: 0, s: 100, l: 50, a: 1 };
    }, [value]);

    const [hue, setHue] = React.useState(initialHsl.h);
    const [saturation, setSaturation] = React.useState(initialHsl.s);
    const [lightness, setLightness] = React.useState(initialHsl.l);
    const [alpha, setAlpha] = React.useState(initialHsl.a ?? 1);
    const [hexInput, setHexInput] = React.useState(value);
    const [prevValue, setPrevValue] = React.useState(value);
    const hueInputId = React.useId();
    const alphaInputId = React.useId();
    const hexInputId = React.useId();

    if (value !== prevValue) {
      setPrevValue(value);
      setHue(initialHsl.h);
      setSaturation(initialHsl.s);
      setLightness(initialHsl.l);
      setAlpha(initialHsl.a ?? 1);
      setHexInput(value);
    }

    const updateColor = (h: number, s: number, l: number, a: number = alpha) => {
      setHue(h);
      setSaturation(s);
      setLightness(l);
      setAlpha(a);

      const rgb = hslToRgb({ h, s, l, a });
      const hex = rgbToHex(rgb);
      setHexInput(hex);
      onValueChange?.(hex);
    };

    const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const hex = e.target.value;
      setHexInput(hex);

      if (/^#[0-9A-F]{8}$/i.test(hex)) {
        const rgb = hexToRgb(hex);
        if (rgb) {
          const hsl = rgbToHsl(rgb);
          setHue(hsl.h);
          setSaturation(hsl.s);
          setLightness(hsl.l);
          setAlpha(rgb.a ?? 1);
          onValueChange?.(hex);
        }
      }
    };

    return (
      <div ref={ref} className="space-y-4" data-slot="color-picker-content">
        {/* Saturation/Brightness Area */}
        <SaturationPanel
          hue={hue}
          saturation={saturation}
          lightness={lightness}
          onChange={(s, l) => updateColor(hue, s, l)}
        />

        {/* Hue Slider */}
        <div className="space-y-2">
          <label htmlFor={hueInputId} className="text-xs font-medium">
            Hue ({hue}°)
          </label>
          <div className="relative">
            <input
              id={hueInputId}
              type="range"
              min="0"
              max="360"
              value={hue}
              onChange={(e) => updateColor(Number(e.target.value), saturation, lightness)}
              className="h-4 w-full cursor-pointer appearance-none rounded [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-fg [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
              style={{
                background:
                  'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
                borderRadius: '4px',
              }}
            />
          </div>
        </div>

        {/* Alpha Slider */}
        {showAlpha && (
          <div className="space-y-2">
            <label htmlFor={alphaInputId} className="text-xs font-medium">
              Alpha
            </label>
            <input
              id={alphaInputId}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={alpha}
              onChange={(e) => updateColor(hue, saturation, lightness, Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground">{Math.round(alpha * 100)}%</div>
          </div>
        )}

        {/* Hex Input */}
        <div className="space-y-2">
          <label htmlFor={hexInputId} className="text-xs font-medium">
            Hex
          </label>
          <Input
            id={hexInputId}
            value={hexInput}
            onChange={handleHexChange}
            placeholder="#RRGGBBAA"
            maxLength={9}
            className="font-mono text-sm"
          />
        </div>

        {/* Preset Colors */}
        {presets.length > 0 && (
          <div className="space-y-2" role="group" aria-label="Presets">
            {/* A span, not a label: this names a grid of buttons, not a control. */}
            <span className="text-xs font-medium">Presets</span>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={value === preset}
                  className={cn(
                    'h-8 w-full rounded border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    value === preset ? 'border-ring ring-2 ring-ring' : 'border-input',
                  )}
                  style={{ backgroundColor: preset }}
                  onClick={() => {
                    setHexInput(preset);
                    const rgb = hexToRgb(preset);
                    if (rgb) {
                      const hsl = rgbToHsl(rgb);
                      setHue(hsl.h);
                      setSaturation(hsl.s);
                      setLightness(hsl.l);
                      setAlpha(rgb.a ?? 1);
                      onValueChange?.(preset);
                    }
                  }}
                  title={preset}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

ColorPickerContent.displayName = 'ColorPickerContent';

export { ColorPicker, ColorPickerTrigger, ColorPickerContent, type IColorPickerProps };
