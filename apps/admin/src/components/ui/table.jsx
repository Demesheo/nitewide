import * as React from 'react';
import { cn } from '../../lib/utils';
const Table = ({ className, ...props }) => <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props}/>;
const TableHeader = ({ className, ...props }) => <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props}/>;
const TableBody = ({ className, ...props }) => <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props}/>;
const TableRow = ({ className, ...props }) => <tr data-slot="table-row" className={cn('border-b transition-colors hover:bg-muted/30', className)} {...props}/>;
const TableHead = ({ className, ...props }) => <th data-slot="table-head" className={cn('text-left font-medium', className)} {...props}/>;
const TableCell = ({ className, ...props }) => <td data-slot="table-cell" className={cn('align-middle', className)} {...props}/>;
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
