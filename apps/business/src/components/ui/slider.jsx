import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
export function Slider({ className, value, min = 0, max = 100, ...props }) {
  return <SliderPrimitive.Root data-slot="slider" className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50', className)} value={value} min={min} max={max} {...props}>
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track>
    {(value || [min]).map((_, i) => <SliderPrimitive.Thumb key={i} aria-label={props['aria-label']} className="block size-4 rounded-full border border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50 disabled:pointer-events-none" />)}
  </SliderPrimitive.Root>;
}
