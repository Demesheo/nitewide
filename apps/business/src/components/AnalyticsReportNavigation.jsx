import { Fragment } from 'react';
import { Button } from './ui/button';

export function AnalyticsReportNavigation({ breadcrumbs, categories, navigationRef, onReset }) {
  if (!breadcrumbs.length && !categories.length && !onReset) return null;
  return <div className="col-span-full w-full basis-full space-y-2" ref={navigationRef}>
    {breadcrumbs.length > 0 && <nav aria-label="Analytics report path" className="report-breadcrumb flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
      {breadcrumbs.map((step, index) => <Fragment key={`${step.label}:${index}`}>
        {index > 0 && <span aria-hidden="true">›</span>}
        {step.onClick ? <Button variant="ghost" size="sm" onClick={step.onClick} aria-label={step.actionLabel}
          aria-current={step.current ? 'page' : undefined} title={step.label} className="min-w-0 max-w-full">
          <span className="block max-w-64 truncate sm:max-w-80">{step.label}</span></Button>
          : <span aria-current={step.current ? 'page' : undefined}
            className={`min-w-0 max-w-full font-semibold ${step.wrap ? 'break-words' : 'max-w-64 truncate sm:max-w-80'}`}
            title={step.label}>{step.label}</span>}
        {step.date && <small className="text-muted-foreground">{step.date}</small>}
      </Fragment>)}
    </nav>}
    {(categories.length > 0 || onReset) && <div role="group" aria-label="Analytics report views" className="flex flex-wrap gap-2">
      {categories.map(({ id, label, active, onClick }) => <Button key={id} variant={active ? 'default' : 'outline'} size="sm"
        aria-pressed={active} onClick={onClick}>{label}</Button>)}
      {onReset && <Button variant="outline" size="sm" className="ml-auto" onClick={onReset} title="Return to the top-level report and clear filters; keep selected dates">Reset</Button>}
    </div>}
  </div>;
}
