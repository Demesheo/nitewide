import { ChevronDown } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';

export function MultiSelect({ label, options, selected, onChange }) {
  return <PopoverPrimitive.Root>
    <span className="multi-select-control inline-flex">
      <PopoverPrimitive.Trigger asChild>
        <Button type="button" variant="secondary" size="sm" aria-label={label} className="h-9 min-w-44 justify-between border border-border px-3">
          <span>{label}{selected.length ? ` · ${selected.length} selected` : ' · All'}</span>
          <ChevronDown size={14} aria-hidden="true"/>
        </Button>
      </PopoverPrimitive.Trigger>
    </span>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align="start" sideOffset={6} collisionPadding={12} className="z-50 max-h-[min(24rem,calc(100vh-24px))] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl">
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Clear</Button>
        </div>
        {options.map((item) => <label className="flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent" key={item.id}>
          <input type="checkbox" aria-label={item.label} checked={selected.includes(item.id)} onChange={() => onChange(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])}/>
          {item.label}
        </label>)}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
