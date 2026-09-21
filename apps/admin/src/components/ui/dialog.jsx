import * as React from 'react';
import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';
const Dialog = Primitive.Root;
const DialogClose = Primitive.Close;
function DialogContent({ className, children, ...props }) { return <Primitive.Portal><Primitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"/><Primitive.Content className={cn('fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[min(720px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl outline-none', className)} {...props}>{children}<Primitive.Close className="absolute right-4 top-4 rounded-md p-1 opacity-70 hover:opacity-100"><X size={18}/><span className="sr-only">Close</span></Primitive.Close></Primitive.Content></Primitive.Portal>; }
const DialogHeader = ({ className, ...props }) => <div className={cn('grid gap-2', className)} {...props}/>;
const DialogFooter = ({ className, ...props }) => <div className={cn('flex justify-end gap-2', className)} {...props}/>;
const DialogTitle = Primitive.Title;
const DialogDescription = Primitive.Description;
export { Dialog, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
