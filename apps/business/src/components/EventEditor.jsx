import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  MapPin,
  Ticket,
  CalendarDays,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { editorDraft, eventPayload } from "../lib/business";
import { api } from "../lib/api";
import { useRecoverableEventDraft } from '../hooks/useRecoverableEventDraft';
import { readEventTemplates, removeEventTemplate, reusableDraft } from '../lib/event-reuse';
import { EventEssentialsStep } from './event-editor/EventEssentialsStep';
import { EventLocationStep } from './event-editor/EventLocationStep';
import { EventOfferingsStep } from './event-editor/EventOfferingsStep';

export function EventEditor({
  event,
  duplicateSource = null,
  copyChoices = null,
  presetDraft = null,
  initialStep = 0,
  organizations,
  venues = [],
  canCreateIndependent = false,
  defaultOrganization,
  session,
  onClose,
  onReloadLatest,
  onSaved,
  audience = 'business',
  request = api,
  organizationPicker = null,
  beforeSave = null,
}) {
  const [initialDraft] = useState(() => { const initial = presetDraft || editorDraft(event, defaultOrganization, organizations, venues); initial.offerings = initial.offerings.map((t) => ({ ...t, clientKey: t.clientKey || t.id || crypto.randomUUID() })); return initial; });
  const { draft, setDraft, dirty, recovery, restore, discardRecovery, clear, persistNow } = useRecoverableEventDraft({ session, event, identity: duplicateSource ? `duplicate:${duplicateSource.id}` : null, initialDraft });
  function restoreDraft() {
    const recovered = recovery?.draft;
    restore();
    // Pre-fix recovery copies may label this event-only address as a saved
    // venue. Retain their edits while correcting only the confirmed bad ID.
    if (event?.isManagedVenue === false && recovered?.locationId && recovered.locationId === event.locationId) {
      setDraft({ ...recovered, locationId: null, locationMode: 'address' });
    }
  }
  const [step, setStep] = useState(event ? initialStep : 0);
  const [addedTierKey, setAddedTierKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkingStripeReadiness, setCheckingStripeReadiness] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [conflictError, setConflictError] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [createdDraftId, setCreatedDraftId] = useState(null);
  const [copyFailure, setCopyFailure] = useState(false);
  const [templates, setTemplates] = useState(() => event || duplicateSource ? [] : readEventTemplates(session.user.id));
  const [publishChecks, setPublishChecks] = useState({ schedule: false, venue: false, inventory: false, access: false });
  const [adminReason, setAdminReason] = useState('');
  const organization = organizations.find((o) => o.id === draft.organizationId);
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const loc = (key, value) =>
    setDraft((d) => ({ ...d, location: { ...d.location, [key]: value } }));
  const tier = (index, key, value) =>
    setDraft((d) => ({
      ...d,
      offerings: d.offerings.map((t, i) =>
        i === index ? { ...t, [key]: value } : t,
      ),
    }));
  const addTier = (kind) => {
    const clientKey = crypto.randomUUID();
    setAddedTierKey(clientKey);
    setDraft((d) => ({
      ...d,
      offerings: [...d.offerings, {
        clientKey, name: "", kind, feeMode: 'inherit',
        price: Math.max(0, ...d.offerings.filter((t) => t.kind === kind).map((t) => Number(t.price) || 0)) + 10,
        quantityTotal: 50, inventoryMode: "finite", entriesPerUnit: kind === "package" ? 4 : 1,
        minPerOrder: 1, maxPerOrder: 10, isActive: true, visibility: "public", description: "",
        releaseAfterKey: "", salesStartAt: "", salesEndAt: "",
      }],
    }));
  };
  function requestClose() {
    if (busy || uploading) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  async function save(status = draft.status) {
    if (busy || uploading) return;
    setError("");
    setConflictError(false);
    if ((draft.locationMode === 'saved' || organization?.canCreateEvents && !organization?.canManage && audience !== 'admin') && !draft.locationId) { setError('Choose a saved business venue before saving.'); setStep(1); return; }
    if (!draft.locationId && !draft.location.city.trim()) { setError('Add the event city before saving a draft.'); setStep(1); return; }
    if (audience === 'admin' && adminReason.trim().length < 10) { setError('Explain this administrative change in at least 10 characters.'); setStep(0); return; }
    setCheckingStripeReadiness(!duplicateSource && status === 'published' &&
      draft.offerings.some((offering) => offering.isActive !== false && Math.round(Number(offering.price) * 100) > 0));
    setBusy(true);
    let savedIdThisAttempt = null;
    try {
      let saved = { id: createdDraftId };
      if (!createdDraftId) {
        const payload = eventPayload({ ...draft, status: duplicateSource ? 'draft' : status }, event?.version);
        if (duplicateSource && copyChoices?.copyImage) payload.reusedImageFromEventId = duplicateSource.id;
        delete payload.slug;
        delete payload.category;
        if (audience === 'admin') payload.adminReason = adminReason.trim();
        if (beforeSave && await beforeSave(draft, payload) === false) return;
        saved = await request(`/${audience}/events${event ? `/${event.id}` : ""}`, session, {
          method: event ? "PUT" : "POST", body: JSON.stringify(payload),
        });
        savedIdThisAttempt = saved.id;
        if (duplicateSource && copyChoices?.copyTeam) setCreatedDraftId(saved.id);
      }
      if (duplicateSource && copyChoices?.copyTeam) await request(`/business/events/${saved.id}/copy-access`, session, {
        method: 'POST', body: JSON.stringify({ sourceEventId: duplicateSource.id, copyTeam: true,
          copyAllocations: Boolean(copyChoices.copyAllocations) }),
      });
      clear();
      setCopyFailure(false);
      onSaved(
        event
          ? "Event updated. Your changes are live."
          : `${!duplicateSource && status === "published" ? "Event published" : "Draft saved"}. You’re ready for what’s next.`,
      );
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && (!err.code || err.code === 'CONFLICT')) setConflictError(true);
      if (createdDraftId || (duplicateSource && copyChoices?.copyTeam && savedIdThisAttempt)) setCopyFailure(true);
    } finally {
      setBusy(false);
      setCheckingStripeReadiness(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (step < 2) { setStep(step + 1); return; }
    await save();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        className="event-editor"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <span className="eyebrow">YOUR NEXT GREAT EXPERIENCE</span>
          <DialogTitle>{event ? "Edit event" : duplicateSource ? "Duplicate event as draft" : "Create an event"}</DialogTitle>
          <DialogDescription>
            From first impression to the last guest. Make every detail count.
          </DialogDescription>
        </DialogHeader>
        {copyFailure && createdDraftId ? <div className="editor-recovery" role="alert"><p>The new draft was saved, but team copying failed: {error}. Retry that step, or open the saved draft without copied team access. Further edits here have not been saved.</p>
          <Button type="button" disabled={busy} onClick={() => save('draft')}>Retry team copy</Button>
          <Button type="button" variant="outline" onClick={() => { clear(); onSaved('Draft saved. Team assignments were not copied.'); }}>Open draft without team copy</Button></div> : <>
        {recovery && <div className="editor-recovery" role="status"><p>Unsaved event changes from this tab are available{recovery.eventVersion !== (event?.version ?? null) ? '. The saved event has changed, so review before saving' : ''}.</p><Button type="button" variant="outline" onClick={restoreDraft}>Restore draft</Button><Button type="button" variant="ghost" onClick={discardRecovery}>Discard saved copy</Button></div>}
        {duplicateSource && <p className="editor-recovery" role="status">This is a new draft with fresh dates and inventory. Review its local event times, absolute sales windows, commission terms and publication checklist before publishing.</p>}
        {!event && !duplicateSource && templates.length > 0 && <div className="editor-templates"><strong>Start from a template saved on this device</strong><p>Templates contain event setup only, not attendees, messages or sales.</p>
          {templates.map((template) => <div key={template.id}><span>{template.name}</span><Button type="button" variant="outline" size="sm" onClick={() => { setDraft(reusableDraft(template.source, { copyOfferings: true }, organizations, venues)); setStep(0); }}>Use template</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { removeEventTemplate(session.user.id, template.id); setTemplates(readEventTemplates(session.user.id)); }}>Delete</Button></div>)}</div>}
        {confirmClose && <div className="editor-recovery" role="alert"><p>Close this editor? Your unsaved event draft is kept in this tab.</p><Button type="button" variant="outline" onClick={() => setConfirmClose(false)}>Keep editing</Button><Button type="button" onClick={() => { persistNow(); onClose(); }}>Close and keep draft</Button></div>}
        <div className="steps">
          {[
            [CalendarDays, "The essentials"],
            [MapPin, "Place & access"],
            [Ticket, "Tickets & packages"],
          ].map(([Icon, title], i) => (
            <div
              className={step === i ? "active" : step > i ? "complete" : ""}
              key={title}
            >
              <span>
                <Icon size={15} />
              </span>
              {title}
            </div>
          ))}
        </div>
        <form onSubmit={submit}>
          <div className="editor-body">
            {step === 0 && <EventEssentialsStep draft={draft} event={event} session={session} organizations={organizations}
              venues={venues} canCreateIndependent={canCreateIndependent} setDraft={setDraft} set={set} onUploading={setUploading}
              request={request} organizationPicker={organizationPicker}/>}
            {step === 0 && audience === 'admin' && <label className="field full" htmlFor="admin-event-reason"><span>Reason for this change</span><textarea id="admin-event-reason" name="adminReason" minLength={10} maxLength={500} required value={adminReason} onChange={(e) => setAdminReason(e.target.value)} rows={2}/></label>}
            {step === 1 && <EventLocationStep draft={draft} organization={organization}
              setDraft={setDraft} set={set} loc={loc} session={session} request={request} audience={audience}/>}
            {step === 2 && <EventOfferingsStep draft={draft} event={event} duplicateSource={duplicateSource}
              addedTierKey={addedTierKey} publishChecks={publishChecks} setPublishChecks={setPublishChecks}
              addTier={addTier} tier={tier} setDraft={setDraft} set={set}/>}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
              {conflictError && <Button type="button" variant="outline" onClick={() => { persistNow(); onReloadLatest(); }}>Reload latest; keep my draft</Button>}
            </p>
          )}
          {busy && checkingStripeReadiness && <p className="hint" role="status">Checking Stripe readiness and saving your event…</p>}
          <footer className="editor-footer">
            <Button
              type="button"
              variant="ghost"
              disabled={busy || uploading}
              onClick={() => (step ? setStep(step - 1) : requestClose())}
            >
              <ArrowLeft />
              {step ? "Back" : "Cancel"}
            </Button>
            <span>{step + 1} of 3</span>
            {step < 2 && <Button type="button" variant="outline" disabled={busy || uploading || draft.title.trim().length < 2} onClick={() => save('draft')}>Save draft</Button>}
            <Button type="submit" disabled={busy || uploading || (step === 2 && !duplicateSource && draft.status === 'published' && event?.status !== 'published' && !Object.values(publishChecks).every(Boolean))}>
              {busy
                ? "Saving…"
                : step < 2
                  ? "Continue"
                  : event
                    ? "Save changes"
                    : draft.status === "published"
                      ? "Publish event"
                      : "Save draft"}
              {step < 2 ? <ArrowRight /> : <Save />}
            </Button>
          </footer>
        </form>
        </>}
      </DialogContent>
    </Dialog>
  );
}
