import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "./controls";
import { money, releaseOptions } from "@/lib/business";

// Reveal collapsed settings before the browser focuses an invalid input.
function revealInvalidField(event) {
  for (let parent = event.target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS") parent.open = true;
  }
}

export function TierEditor({ tier: t, index: i, offerings, newlyAdded, onChange, onKindChange, onRemove }) {
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const cardRef = useRef(null);
  useEffect(() => {
    if (!newlyAdded || !cardRef.current) return;
    const card = cardRef.current;
    card.open = true;
    const body = card.closest(".editor-body");
    // Scroll only the editor, never the underlying page or viewport.
    if (body) {
      const top = card.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    card.querySelector("input")?.focus({ preventScroll: true });
  }, [newlyAdded]);
  const dependents = offerings.filter((item) => item.releaseAfterKey === (t.clientKey || t.id));
  const earlierTiers = releaseOptions(offerings, i);
  const previous = offerings.find((item) => (item.clientKey || item.id) === t.releaseAfterKey);
  const invalidRelease = t.releaseAfterKey && !earlierTiers.some((item) => item.key === t.releaseAfterKey);
  const canLink = ["ticket", "package"].includes(t.kind);
  const releaseLabel = t.releaseAfterKey
    ? `After ${previous?.name || "earlier tier"}`
    : t.salesStartAt || t.salesEndAt ? "Custom sales schedule" : "No earlier tier required";
  return (
    <details ref={cardRef} className="tier-editor-card" open={Boolean(newlyAdded)} onInvalidCapture={revealInvalidField}>
      <summary className="tier-editor-summary">
        <span className="tier-editor-summary-copy">
          <span className="tier-editor-kicker">{t.kind} {i + 1}{t.quantitySold > 0 ? ` · ${t.quantitySold} sold` : ""}{!t.isActive ? " · Sales paused" : ""}</span>
          <strong>{t.name || "Untitled tier"}</strong>
          <span>{money(Math.round((Number(t.price) || 0) * 100))} · {t.inventoryMode === "unlimited" ? "Unlimited quantity" : `${t.quantityTotal || 0} units`}</span>
          <span className={invalidRelease ? "tier-release-warning" : "tier-editor-release-summary"}>{invalidRelease ? "Review opening rule" : releaseLabel}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="tier-editor-content">
        <div className="form-grid tier-basics-grid">
          <div className="full"><Field id={`tier-name-${i}`} label="Tier name" placeholder="e.g. Early bird or VIP table" required maxLength={160} value={t.name} onChange={(e) => onChange("name", e.target.value)} /></div>
          <SelectField id={`tier-kind-${i}`} label="Type" disabled={t.quantitySold > 0} value={t.kind} onChange={onKindChange} options={[["ticket", "Ticket"], ["package", "Package"], ["reservation", "Reservation"]]} />
          <Field id={`tier-price-${i}`} label="Price per unit ($)" type="number" min={0} max={1000000} step="0.01" required value={t.price} onChange={(e) => onChange("price", e.target.value)} />
          <SelectField id={`tier-inventory-${i}`} label="Quantity available" value={t.inventoryMode} onChange={(v) => onChange("inventoryMode", v)} options={[["finite", "Limited"], ["unlimited", "Unlimited"]]} />
          {t.inventoryMode === "finite" && <Field id={`tier-quantity-${i}`} label="Total units" type="number" min={t.quantitySold || 0} max={1000000} required value={t.quantityTotal ?? ""} onChange={(e) => onChange("quantityTotal", e.target.value)} />}
          <Field id={`tier-admissions-${i}`} label="Guests per unit" type="number" min={1} max={100} required disabled={t.quantitySold > 0} value={t.entriesPerUnit} onChange={(e) => onChange("entriesPerUnit", e.target.value)} />
        </div>
        <p className="hint">One unit is one ticket, package, or reservation.{t.inventoryMode === "finite" ? " Total units includes those already sold." : ""}{t.quantitySold > 0 ? " Type and guests per unit are locked after a sale." : ""}</p>

        <section className="tier-editor-section" aria-labelledby={`tier-opening-heading-${i}`}>
          <h4 id={`tier-opening-heading-${i}`}>When can customers buy?</h4>
          {canLink && <SelectField id={`tier-release-${i}`} label="Open after" value={t.releaseAfterKey || "immediate"} onChange={(v) => onChange("releaseAfterKey", v === "immediate" ? "" : v)} options={[
            ["immediate", "No earlier tier · sell independently"],
            ...earlierTiers.map((p) => {
              const prior = offerings.find((item) => (item.clientKey || item.id) === p.key);
              return [p.key, `${p.name} · ${money(Math.round(Number(prior.price) * 100))}`];
            }),
            ...(invalidRelease ? [[t.releaseAfterKey, `${previous?.name || "Earlier tier"} · needs review`]] : []),
          ]} />}
          {invalidRelease ? <p role="alert" className="tier-release-warning">This opening rule is no longer valid. Choose an earlier {t.kind} with a lower price and limited quantity, or choose to sell independently.</p>
            : t.releaseAfterKey ? <p className="tier-release-explanation"><strong>{t.name || "This tier"}</strong> opens automatically when <strong>{previous?.name || "the selected tier"}</strong> sells out, reaches its stop time, or has sales turned off. Any start and stop times below still apply.</p>
            : <p className="hint">{canLink ? "This tier does not wait for another tier. " : ""}It can sell once the event is published and sales are enabled, within any times you set below.</p>}
          {canLink && earlierTiers.length === 0 && !t.releaseAfterKey && <p className="hint tier-release-help">{i === 0 ? "Start your ladder here: use limited quantity, then add a higher-priced tier of the same type and choose this one in “Open after.”" : `Only earlier ${t.kind} tiers with a lower price and limited quantity appear here. Adjust an earlier tier to link it, or sell this one independently.`}</p>}
          <details className="tier-editor-options" open={Boolean(t.salesStartAt || t.salesEndAt)}>
            <summary>Sales schedule <span>Optional</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="form-grid">
              <Field id={`tier-sales-start-${i}`} label="Start selling" type="datetime-local" value={t.salesStartAt || ""} onChange={(e) => onChange("salesStartAt", e.target.value)} />
              <Field id={`tier-sales-end-${i}`} label="Stop selling" type="datetime-local" value={t.salesEndAt || ""} onChange={(e) => onChange("salesEndAt", e.target.value)} />
            </div>
            <p className="hint">Venue time. Leave blank for no additional time restriction. An “Open after” rule must also be satisfied.</p>
          </details>
        </section>

        <details className="tier-editor-options">
          <summary>Order limits & visibility<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="form-grid tier-basics-grid">
            <Field id={`tier-min-${i}`} label="Minimum per order" type="number" min={1} max={100} required value={t.minPerOrder} onChange={(e) => onChange("minPerOrder", e.target.value)} />
            <Field id={`tier-max-${i}`} label="Maximum per order" type="number" min={t.minPerOrder} max={100} required value={t.maxPerOrder} onChange={(e) => onChange("maxPerOrder", e.target.value)} />
            <div className="full"><SelectField id={`tier-visibility-${i}`} label="Visibility" value={t.visibility} onChange={(v) => onChange("visibility", v)} options={[["public", "Public"], ["hidden", "Hidden"], ...(t.visibility === "password" ? [["password", "Password (existing)"]] : [])]} /></div>
          </div>
        </details>
        <div className="tier-editor-sales">
          <label className="check-field"><input type="checkbox" checked={t.isActive} onChange={(e) => onChange("isActive", e.target.checked)} />Sales enabled</label>
          <p className="hint">{t.isActive ? "Turn off to stop sales. A linked next tier can then open." : "Sales are paused. A linked next tier can open if its schedule allows."}{t.id ? " Existing orders stay intact." : ""}</p>
        </div>
        {onRemove && (confirmRemoval ? <div className="tier-remove-confirmation" role="group" aria-label="Confirm tier removal">
          <p>Remove <strong>{t.name || "this tier"}</strong>? This takes effect when you save changes.</p>
          {dependents.length > 0 && <p>{dependents.map((item) => item.name || "Untitled tier").join(", ")} will no longer wait for this tier and will sell independently within their own schedules.</p>}
          <div><Button type="button" variant="outline" size="sm" onClick={() => setConfirmRemoval(false)}>Cancel</Button><Button type="button" variant="destructive" size="sm" onClick={onRemove}>Remove tier</Button></div>
        </div> : <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemoval(true)}><Trash2 />Remove tier</Button>)}
      </div>
    </details>
  );
}
