import { Button } from '@/components/ui/button';

export function MultiSelect({ label, options, selected, onChange }) {
  return <details className="relative">
    <summary className="list-none cursor-pointer rounded-lg border border-border bg-secondary px-3 py-2 text-sm min-w-44">
      {label}{selected.length ? ` · ${selected.length} selected` : ' · All'} ⌄
    </summary>
    <div className="absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl">
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Clear</Button>
      {options.map((item) => <label className="flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent" key={item.id}>
        <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onChange(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])}/>
        {item.label}
      </label>)}
    </div>
  </details>;
}
