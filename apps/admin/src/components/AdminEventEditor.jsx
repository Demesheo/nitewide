import { useState } from 'react';
import { EventEditor } from '../../../business/src/components/EventEditor';
import { api } from '../lib/api';
import { useAdminResource } from '../hooks/useAdminResource';
import { ResourceState } from './ResourceState';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { requiresEventNotice } from '../lib/event-notice';

export default function AdminEventEditor({ id, businessId, session, onClose, onSaved }) {
  const [refresh, setRefresh] = useState(0); const [confirmation, setConfirmation] = useState(null);
  const state = useAdminResource(id ? `/admin/events/${id}/editor` : `/admin/businesses/${businessId}/editor-options`, refresh);
  const request = (path, _session, options) => api(path, options);
  async function beforeSave(_draft, payload) {
    const event = state.data.event;
    if (!event) return true;
    if (!requiresEventNotice(event, payload)) return true;
    const preview = await api(`/admin/events/${id}/notification-preview`);
    return new Promise((resolve) => setConfirmation({ preview, resolve }));
  }
  return <><ResourceState {...state} onRetry={() => setRefresh((value) => value + 1)}>{state.data && <EventEditor key={refresh} event={state.data.event} defaultOrganization={state.data.defaultOrganization} organizations={state.data.organizations} venues={state.data.venues} session={session} audience="admin" request={request} beforeSave={beforeSave} onClose={onClose} onSaved={onSaved} onReloadLatest={() => setRefresh((value) => value + 1)}/>}</ResourceState>{confirmation && <Dialog open onOpenChange={(open) => { if (!open) { confirmation.resolve(false); setConfirmation(null); } }}><DialogContent className="dialog"><DialogHeader><DialogTitle>Confirm significant event change</DialogTitle><DialogDescription>{confirmation.preview.recipients} affected attendees will be notified.</DialogDescription></DialogHeader><p className="notice">This changes the published event’s schedule, location or cancellation state. Existing purchase and admission history is retained.</p><div className="management-dialog-actions"><Button variant="outline" onClick={() => { confirmation.resolve(false); setConfirmation(null); }}>Keep editing</Button><Button onClick={() => { confirmation.resolve(true); setConfirmation(null); }}>Confirm change and notify</Button></div></DialogContent></Dialog>}</>;
}
