import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

function Input({ className, type, visibilityLabel = 'password', ...props }) {
  const [visible, setVisible] = React.useState(false);
  const generatedId = React.useId();
  const toggle = type === 'password';
  const id = props.id || (toggle ? generatedId : undefined);
  const input = (
    <input
      type={toggle && visible ? 'text' : type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--nw-control-radius)] border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
      id={id}
      style={toggle ? { ...props.style, paddingRight: 48 } : props.style}
    />
  );
  if (!toggle) return input;
  return <span data-slot="password-input" style={{ position: 'relative', display: 'block', width: '100%', minWidth: 0 }}>
    {input}
    <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`} aria-controls={id} aria-pressed={visible} disabled={props.disabled}
      className="rounded-md focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      style={{ position: 'absolute', right: 4, top: 0, bottom: 0, margin: 'auto', width: 40, minWidth: 40, height: '100%', maxHeight: 44, minHeight: 0, padding: 0, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', boxShadow: 'none', color: 'inherit', cursor: props.disabled ? 'not-allowed' : 'pointer' }}
      onMouseDown={(event) => event.preventDefault()} onClick={() => setVisible((value) => !value)}>
      {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
    </button>
  </span>;
}

export { Input };
