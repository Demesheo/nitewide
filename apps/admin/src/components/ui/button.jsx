import * as React from 'react';
import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '../../lib/utils';
const buttonVariants = cva('inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90', outline: 'border border-input bg-transparent hover:bg-accent', ghost: 'hover:bg-accent', destructive: 'bg-destructive text-white hover:bg-destructive/90' }, size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3', icon: 'size-9' } }, defaultVariants: { variant: 'default', size: 'default' } });
function Button({ className, variant = 'default', size = 'default', asChild = false, ...props }) { const Comp = asChild ? Slot.Root : 'button'; return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}/>; }
export { Button, buttonVariants };
