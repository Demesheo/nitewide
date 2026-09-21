import * as React from 'react';
import { cn } from '../../lib/utils';
function Input({ className, type, ...props }) { return <input type={type} data-slot="input" className={cn('h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50', className)} {...props}/>; }
export { Input };
