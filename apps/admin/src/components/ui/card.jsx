import * as React from 'react';
import { cn } from '../../lib/utils';
const make = (slot, base) => function Component({ className, ...props }) { return <div data-slot={slot} className={cn(base, className)} {...props}/>; };
const Card = make('card', 'rounded-xl border bg-card text-card-foreground shadow-sm');
const CardHeader = make('card-header', 'grid gap-1.5 p-6');
const CardTitle = make('card-title', 'font-semibold leading-none');
const CardDescription = make('card-description', 'text-sm text-muted-foreground');
const CardContent = make('card-content', 'p-6 pt-0');
export { Card, CardHeader, CardTitle, CardDescription, CardContent };
