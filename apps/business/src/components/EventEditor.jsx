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
import { editorDraft, eventPayload, slugify } from "@/lib/business";
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
  const [draft, setDraft] = useState(() =>
    editorDraft(event, defaultOrganization),
  );
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
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
  async function submit(e) {
    e.preventDefault();
    if (uploading) return;
    setError("");
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const payload = eventPayload(draft, event?.version);
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
                    onChange={(v) =>
                      set("organizationId", v === "independent" ? null : v)
                    }
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
                      if (!event) set("slug", slugify(e.target.value));
                    }}
                  />
                </div>
                <Field
                  id="event-slug"
                  label="URL slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={200}
                  value={draft.slug}
                  onChange={(e) => set("slug", e.target.value)}
                />
                <Field
                  id="event-category"
                  label="Category"
                  required
                  maxLength={80}
                  value={draft.category}
                  onChange={(e) => set("category", e.target.value)}
                />
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
                  Times use the location’s time zone, set in the next step.
                  Overnight events should end on the following day.
                </p>
              </div>
            )}
            {step === 1 && (
              <div className="form-grid">
                <Field
                  id="venue-name"
                  label="Venue / location name"
                  value={draft.location.name || ""}
                  onChange={(e) => loc("name", e.target.value)}
                  maxLength={180}
                />
                <Field
                  id="venue-timezone"
                  label="Time zone"
                  required
                  placeholder="America/New_York"
                  value={draft.location.timezone}
                  onChange={(e) => loc("timezone", e.target.value)}
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
                    <h3>Build your offering</h3>
                    <p>Flexible tiers. One seamless checkout. Prices in USD.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={draft.offerings.length >= 50}
                    onClick={() =>
                      set("offerings", [
                        ...draft.offerings,
                        {
                          name: "",
                          kind: "ticket",
                          price: 10,
                          quantityTotal: 100,
                          inventoryMode: "finite",
                          entriesPerUnit: 1,
                          minPerOrder: 1,
                          maxPerOrder: 10,
                          isActive: true,
                          visibility: "public",
                          description: "",
                        },
                      ])
                    }
                  >
                    <Plus />
                    Add tier
                  </Button>
                </div>
                {draft.offerings.map((t, i) => (
                  <fieldset className="tier-card" key={t.id || i}>
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
                        onChange={(v) => tier(i, "kind", v)}
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
                      <Field
                        id={`tier-sales-start-${i}`}
                        label="Sales open (venue time, optional)"
                        type="datetime-local"
                        value={t.salesStartAt || ""}
                        onChange={(e) =>
                          tier(i, "salesStartAt", e.target.value)
                        }
                      />
                      <Field
                        id={`tier-sales-end-${i}`}
                        label="Sales close (venue time, optional)"
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
                        Available for sale
                      </label>
                    </div>
                    {!t.id && draft.offerings.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          set(
                            "offerings",
                            draft.offerings.filter((_, index) => i !== index),
                          )
                        }
                      >
                        <Trash2 />
                        Remove tier
                      </Button>
                    )}
                    {t.id && (
                      <p className="hint">
                        Disable this tier to stop future sales; historical
                        orders stay intact.
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
                            ["completed", "Completed"],
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
