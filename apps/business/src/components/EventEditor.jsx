import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Save,
  Trash2,
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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "./controls";
import { editorDraft, eventPayload, releaseOptions } from "@/lib/business";
import { api } from "@/lib/api";
import { ImageUpload } from "./ImageUpload";

export function EventEditor({
  event,
  organizations,
  defaultOrganization,
  session,
  onClose,
  onSaved,
}) {
  const [draft, setDraft] = useState(() => { const initial = editorDraft(event, defaultOrganization, organizations); initial.offerings = initial.offerings.map((t) => ({ ...t, clientKey: t.id || crypto.randomUUID() })); return initial; });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
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
  const addTier = (kind) => setDraft((d) => ({
    ...d,
    offerings: [...d.offerings, {
      clientKey: crypto.randomUUID(), name: "", kind,
      price: Math.max(0, ...d.offerings.filter((t) => t.kind === kind).map((t) => Number(t.price) || 0)) + 10,
      quantityTotal: 50, inventoryMode: "finite", entriesPerUnit: kind === "package" ? 4 : 1,
      minPerOrder: 1, maxPerOrder: 10, isActive: true, visibility: "public", description: "",
      releaseAfterKey: "", salesStartAt: "", salesEndAt: "",
    }],
  }));
  async function submit(e) {
    e.preventDefault();
    if (uploading) return;
    setError("");
    if (draft.organizationId && !(event?.location || organization?.location)) { setError('This organization needs a saved venue address before creating an event.'); return; }
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const payload = eventPayload(draft, event?.version);
      delete payload.slug;
      delete payload.category;
      await api(`/business/events${event ? `/${event.id}` : ""}`, session, {
        method: event ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(
        event
          ? "Event updated. Your changes are live."
          : `${draft.status === "published" ? "Event published" : "Draft saved"}. You’re ready for what’s next.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uploading) onClose();
      }}
    >
      <DialogContent
        className="event-editor"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <span className="eyebrow">YOUR NEXT GREAT EXPERIENCE</span>
          <DialogTitle>{event ? "Edit event" : "Create an event"}</DialogTitle>
          <DialogDescription>
            From first impression to the last guest. Make every detail count.
          </DialogDescription>
        </DialogHeader>
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
            {step === 0 && (
              <div className="form-grid">
                <div className="full">
                  <ImageUpload
                    value={draft.imageUrl}
                    session={session}
                    onBusy={setUploading}
                    onChange={(asset) =>
                      setDraft((d) => ({
                        ...d,
                        imageAssetId: asset?.id || null,
                        imageUrl: asset?.url || null,
                      }))
                    }
                  />
                </div>
                <div className="full">
                  <SelectField
                    id="event-organization"
                    label="Organization"
                    disabled={Boolean(event)}
                    value={draft.organizationId || "independent"}
                    onChange={(v) => {
                      const organizationId = v === 'independent' ? null : v;
                      const location = organizations.find((o) => o.id === organizationId)?.location;
                      setDraft((d) => ({ ...d, organizationId, location: location ? {...location} : { name:'', addressLine1:'', city:'', region:'FL', postalCode:'', countryCode:'US', timezone:'America/New_York', privacy:'public' } }));
                    }}
                    options={[
                      ["independent", "Independent event · owned by you"],
                      ...organizations
                        .filter(
                          (o) => o.canManage || o.id === event?.organizationId,
                        )
                        .map((o) => [o.id, o.name]),
                    ]}
                  />
                </div>
                <div className="full">
                  <Field
                    id="event-title"
                    label="Event name"
                    placeholder="Give your next night a name"
                    required
                    minLength={2}
                    maxLength={180}
                    value={draft.title}
                    onChange={(e) => {
                      set("title", e.target.value);
                    }}
                  />
                </div>
                <div className="full">
                  <Field
                    id="event-summary"
                    label="Short description"
                    maxLength={500}
                    placeholder="The one-line invitation"
                    value={draft.summary}
                    onChange={(e) => set("summary", e.target.value)}
                  />
                </div>
                <label className="field full">
                  <span>About this experience</span>
                  <textarea
                    aria-label="About this experience"
                    rows={4}
                    maxLength={20000}
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>
                <Field
                  id="event-start"
                  label="Starts at (venue time)"
                  type="datetime-local"
                  required
                  value={draft.startsAt}
                  onChange={(e) => set("startsAt", e.target.value)}
                />
                <Field
                  id="event-end"
                  label="Ends at (venue time)"
                  type="datetime-local"
                  required
                  value={draft.endsAt}
                  onChange={(e) => set("endsAt", e.target.value)}
                />
                <p className="hint full">
                  Enter the event’s local start and end times.
                  Overnight events should end on the following day.
                </p>
              </div>
            )}
            {step === 1 && (
              <div className="form-grid">
                {draft.organizationId && <div className="venue-address-card full"><MapPin size={22}/><div><strong>{draft.location.name || organization?.name}</strong><p>{draft.location.addressLine1}</p><p>{[draft.location.city,draft.location.region,draft.location.postalCode].filter(Boolean).join(', ')}</p><small>Uses venue’s saved address</small></div></div>}
                {!draft.organizationId && <>
                <Field
                  id="venue-name"
                  label="Venue / location name"
                  value={draft.location.name || ""}
                  onChange={(e) => loc("name", e.target.value)}
                  maxLength={180}
                />
                <div className="full">
                  <Field
                    id="venue-address"
                    label="Street address"
                    maxLength={180}
                    value={draft.location.addressLine1 || ""}
                    onChange={(e) => loc("addressLine1", e.target.value)}
                  />
                </div>
                <Field
                  id="venue-city"
                  label="City"
                  required
                  maxLength={100}
                  value={draft.location.city}
                  onChange={(e) => loc("city", e.target.value)}
                />
                <Field
                  id="venue-region"
                  label="State / region"
                  maxLength={100}
                  value={draft.location.region || ""}
                  onChange={(e) => loc("region", e.target.value)}
                />
                <Field
                  id="venue-postal"
                  label="ZIP / postal code"
                  maxLength={24}
                  value={draft.location.postalCode || ""}
                  onChange={(e) => loc("postalCode", e.target.value)}
                />
                <Field
                  id="venue-country"
                  label="Country code"
                  minLength={2}
                  maxLength={2}
                  required
                  value={draft.location.countryCode}
                  onChange={(e) =>
                    loc("countryCode", e.target.value.toUpperCase())
                  }
                />
                <SelectField
                  id="venue-privacy"
                  label="Location visibility"
                  value={draft.location.privacy}
                  onChange={(v) => loc("privacy", v)}
                  options={[
                    ["public", "Public address"],
                    ["attendees_only", "Attendees only"],
                    ["private", "Private"],
                  ]}
                />
                </>}
                <Field
                  id="guestlist-capacity"
                  label="Direct guestlist limit (people)"
                  type="number"
                  min={0}
                  max={1000000}
                  required
                  value={draft.guestlistCapacity}
                  onChange={(e) => set("guestlistCapacity", e.target.value)}
                />
                <Field
                  id="event-capacity"
                  label="Reference venue capacity (optional)"
                  type="number"
                  min={0}
                  max={1000000}
                  value={draft.capacity}
                  onChange={(e) => set("capacity", e.target.value)}
                />
                <p className="hint full">
                  Direct guestlist and promoter allocations are separate pools.
                  Venue capacity is informational; paid inventory is controlled
                  per tier. Keep their combined admissions within your venue’s
                  safe occupancy.
                </p>
              </div>
            )}
            {step === 2 && (
              <>
                <div className="section-heading">
                  <div>
                    <h3>Build your ticket ladder</h3>
                    <p>Set a quantity and price for each tier. Later tiers can open after an earlier tier sells out, its sales window ends, or you close it manually.</p>
                  </div>
                  <div className="tier-add-actions">
                    <Button type="button" variant="outline" size="sm" disabled={draft.offerings.length >= 50} onClick={() => addTier("ticket")}><Plus /> Add ticket tier</Button>
                    <Button type="button" variant="outline" size="sm" disabled={draft.offerings.length >= 50} onClick={() => addTier("package")}><Plus /> Add package tier</Button>
                  </div>
                </div>
                {draft.offerings.map((t, i) => (
                  <fieldset className="tier-card" key={t.clientKey}>
                    <legend>
                      Tier {i + 1}
                      {t.quantitySold > 0 ? ` · ${t.quantitySold} sold` : ""}
                    </legend>
                    <div className="form-grid">
                      <Field
                        id={`tier-name-${i}`}
                        label="Name"
                        required
                        maxLength={160}
                        value={t.name}
                        onChange={(e) => tier(i, "name", e.target.value)}
                      />
                      <SelectField
                        id={`tier-kind-${i}`}
                        label="Type"
                        disabled={t.quantitySold > 0}
                        value={t.kind}
                        onChange={(v) => setDraft((d) => ({ ...d, offerings: d.offerings.map((item, index) => index === i ? { ...item, kind: v, releaseAfterKey: "" } : item) }))}
                        options={[
                          ["ticket", "Ticket"],
                          ["package", "Package"],
                          ["reservation", "Reservation"],
                        ]}
                      />
                      <Field
                        id={`tier-price-${i}`}
                        label="Price ($)"
                        type="number"
                        min={0}
                        max={1000000}
                        step="0.01"
                        required
                        value={t.price}
                        onChange={(e) => tier(i, "price", e.target.value)}
                      />
                      <Field
                        id={`tier-admissions-${i}`}
                        label="Admissions per unit"
                        type="number"
                        min={1}
                        max={100}
                        required
                        disabled={t.quantitySold > 0}
                        value={t.entriesPerUnit}
                        onChange={(e) =>
                          tier(i, "entriesPerUnit", e.target.value)
                        }
                      />
                      <SelectField
                        id={`tier-inventory-${i}`}
                        label="Inventory"
                        value={t.inventoryMode}
                        onChange={(v) => tier(i, "inventoryMode", v)}
                        options={[
                          ["finite", "Limited inventory"],
                          ["unlimited", "Unlimited"],
                        ]}
                      />
                      {t.inventoryMode === "finite" && (
                        <Field
                          id={`tier-quantity-${i}`}
                          label="Total inventory (including sold)"
                          type="number"
                          min={t.quantitySold || 0}
                          max={1000000}
                          required
                          value={t.quantityTotal ?? ""}
                          onChange={(e) =>
                            tier(i, "quantityTotal", e.target.value)
                          }
                        />
                      )}
                      <Field
                        id={`tier-min-${i}`}
                        label="Minimum per order"
                        type="number"
                        min={1}
                        max={100}
                        required
                        value={t.minPerOrder}
                        onChange={(e) => tier(i, "minPerOrder", e.target.value)}
                      />
                      <Field
                        id={`tier-max-${i}`}
                        label="Maximum per order"
                        type="number"
                        min={t.minPerOrder}
                        max={100}
                        required
                        value={t.maxPerOrder}
                        onChange={(e) => tier(i, "maxPerOrder", e.target.value)}
                      />
                      {['ticket', 'package'].includes(t.kind) && <div className="full"><SelectField id={`tier-release-${i}`} label="Open after (optional)" value={t.releaseAfterKey || 'immediate'} onChange={(v) => tier(i, 'releaseAfterKey', v === 'immediate' ? '' : v)} options={[
                        ['immediate', 'No earlier tier required'],
                        ...releaseOptions(draft.offerings, i).map((p) => [p.key, p.name]),
                      ]}/></div>}
                      <Field
                        id={`tier-sales-start-${i}`}
                        label="Start selling (venue time, optional)"
                        type="datetime-local"
                        value={t.salesStartAt || ""}
                        onChange={(e) =>
                          tier(i, "salesStartAt", e.target.value)
                        }
                      />
                      <Field
                        id={`tier-sales-end-${i}`}
                        label="Stop selling (venue time, optional)"
                        type="datetime-local"
                        value={t.salesEndAt || ""}
                        onChange={(e) => tier(i, "salesEndAt", e.target.value)}
                      />
                      <SelectField
                        id={`tier-visibility-${i}`}
                        label="Visibility"
                        value={t.visibility}
                        onChange={(v) => tier(i, "visibility", v)}
                        options={[
                          ["public", "Public"],
                          ["hidden", "Hidden"],
                          ...(t.visibility === "password"
                            ? [["password", "Password (existing)"]]
                            : []),
                        ]}
                      />
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={t.isActive}
                          onChange={(e) =>
                            tier(i, "isActive", e.target.checked)
                          }
                        />
                        Sales enabled
                      </label>
                      {t.releaseAfterKey && <p className="hint full">This tier opens when the selected tier sells out, reaches its stop time, or is closed manually. Its own start time must also have arrived.</p>}
                      {!t.isActive && <p className="hint full">Closed manually. A linked next tier may open now if its own start time has arrived. Re-enable sales to reopen this tier.</p>}
                    </div>
                    {!t.id && draft.offerings.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          set(
                            "offerings",
                            draft.offerings.filter((_, index) => i !== index).map((p) => p.releaseAfterKey === t.clientKey ? { ...p, releaseAfterKey: '' } : p),
                          )
                        }
                      >
                        <Trash2 />
                        Remove tier
                      </Button>
                    )}
                    {t.id && (
                      <p className="hint">
                        Uncheck Sales enabled to close this tier manually. A linked next tier opens automatically. Historical orders stay intact.
                      </p>
                    )}
                  </fieldset>
                ))}
                <div className="publish-box">
                  <SelectField
                    id="event-status"
                    label="Event status"
                    value={draft.status}
                    onChange={(v) => set("status", v)}
                    options={[
                      ["draft", "Draft · only visible to your team"],
                      ["published", "Published · available to customers"],
                      ...(event
                        ? [
                            ["cancelled", "Cancelled"],
                          ]
                        : []),
                    ]}
                  />
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={draft.isDiscoverable}
                      onChange={(e) => set("isDiscoverable", e.target.checked)}
                    />
                    Show published event in discovery
                  </label>
                  <p className="hint">
                    Cancellation stops sales but does not refund existing
                    orders. Coordinate refunds separately.
                  </p>
                </div>
              </>
            )}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <footer className="editor-footer">
            <Button
              type="button"
              variant="ghost"
              disabled={busy || uploading}
              onClick={() => (step ? setStep(step - 1) : onClose())}
            >
              <ArrowLeft />
              {step ? "Back" : "Cancel"}
            </Button>
            <span>{step + 1} of 3</span>
            <Button type="submit" disabled={busy || uploading}>
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
      </DialogContent>
    </Dialog>
  );
}
