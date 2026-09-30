import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { browserReportTimezone } from '@/lib/report-client';
import { Button } from './ui/button';
import { LoadingState } from './LoadingState';
import { OverviewPresentation } from './OverviewPresentation';
import { OverviewNeedsAttention } from './OverviewNeedsAttention';
import { BusinessTeamPerformance } from './BusinessTeamPerformance';
import { PersonalOverview } from './PersonalOverview';
import { PersonalActivityTable } from './PersonalActivityTable';

function queryFor({ days, organizationIds, venueIds, timezone }) {
  const params = new URLSearchParams({ days: String(days), timezone });
  organizationIds.forEach((id) => params.append('organizationIds', id));
  venueIds.forEach((id) => params.append('venueIds', id));
  return params.toString();
}

export function BusinessOverview({ session, days, organizationIds, venueIds, ownOnly, revision, onNavigate, onUnauthorized }) {
  const [timezone] = useState(browserReportTimezone);
  const [overview, setOverview] = useState(null);
  const [attention, setAttention] = useState(null);
  const [error, setError] = useState('');
  const [attentionError, setAttentionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [attentionRetry, setAttentionRetry] = useState(0);
  const query = useMemo(() => queryFor({ days, organizationIds, venueIds, timezone }), [days, organizationIds, venueIds, timezone]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/business/reports/summary?${query}`, session, { signal: controller.signal })
      .then(setOverview)
      .catch((err) => { if (err.name === 'AbortError') return; if (err.status === 401) onUnauthorized(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, query, revision, summaryRetry, onUnauthorized]);
  useEffect(() => {
    const controller = new AbortController();
    setAttentionLoading(true); setAttentionError('');
    api(`/business/overview/needs-attention?${query}`, session, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setAttention(data); })
      .catch((err) => { if (controller.signal.aborted || err.name === 'AbortError') return; if (err.status === 401) onUnauthorized(); else setAttentionError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setAttentionLoading(false); });
    return () => controller.abort();
  }, [session, query, revision, attentionRetry, onUnauthorized]);
  const summary = overview?.summary;
  const presentation = summary && { range: { ...overview.range, days: overview.daily.length }, events: overview.eventMix.filter((row) => row.startsAt).map((row) => ({ id: row.id, startsAt: row.startsAt, location: { timezone: row.venueTimezone } })), report: { summary, daily: overview.daily, packages: overview.offerings.map((row) => ({ ...row, id: row.kind === 'other' ? 'other' : row.kind + ':' + row.label, name: row.label })), events: overview.eventMix.map((row) => ({ ...row, name: row.label })) } };
  const attentionSection = <OverviewNeedsAttention attention={attention} loading={attentionLoading} error={attentionError} onRetry={() => setAttentionRetry((value) => value + 1)} onNavigate={onNavigate}/>;
  return <div className="business-overview" aria-busy={loading}>
    {loading && <LoadingState>{overview ? 'Updating your overview…' : 'Opening your overview…'}</LoadingState>}
    {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={() => setSummaryRetry((value) => value + 1)}>Try again</Button></div>}
    {summary && (ownOnly ? <PersonalOverview data={presentation} activeEvents={summary.activeEvents || 0} onEvents={(id) => onNavigate('events', id)} onAnalytics={() => onNavigate('analytics')} onGuestlists={() => onNavigate('events')}
      beforeActivity={attentionSection} eventTable={<PersonalActivityTable session={session} query={query} revision={revision} onUnauthorized={onUnauthorized} onEvent={(id) => onNavigate('events', id)}/>}/> : <><OverviewPresentation data={presentation} beforeCharts={attentionSection}/>
    <BusinessTeamPerformance session={session} query={query} totalSales={summary.salesCents} directSalesCents={summary.directSalesCents} revision={revision} onUnauthorized={onUnauthorized} onEvents={() => onNavigate('events')}/></>)}
    {!summary && attentionSection}
  </div>;
}
