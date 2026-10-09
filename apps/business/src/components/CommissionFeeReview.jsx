import { useRef, useState } from 'react';
import { Button } from './ui/button';
import { actionIdentity } from '../../../shared/action-identity';
import { commissionMoney } from './MyCommissions';

export const canReviewCommissionFee = payment => payment?.status === 'paid_fee_review'
  && payment.providerVerificationStatus === 'verified' && payment.fundsReceived === true
  && Number.isSafeInteger(payment.processingFeeCents) && payment.processingFeeCents >= 0
  && payment.feeEvidence === null;

function savedReview(scope) {
  try {
    const saved = JSON.parse(globalThis.localStorage.getItem(`nitewide.action.${scope}`));
    const payload = JSON.parse(saved.fingerprint);
    if (!saved.idempotencyKey || !Number.isInteger(payload.invoicingFeeCents) || payload.invoicingFeeCents < 0 || payload.invoicingFeeCents > 99_999_999
      || typeof payload.evidenceReference !== 'string' || !payload.evidenceReference || payload.evidenceReference.length > 500
      || typeof payload.reason !== 'string' || !payload.reason || payload.reason.length > 1000) return null;
    return { payload, key: saved.idempotencyKey };
  } catch { return null; }
}

export function CommissionFeeReview({ session, payment, busy, onReview, onError }) {
  const scope = `commission-fee-review.${session.user.id}.${payment.paymentId}`;
  const initial = useRef(savedReview(scope));
  const [attempt, setAttempt] = useState(initial.current);
  const [amount, setAmount] = useState(initial.current ? ((initial.current.payload.invoicingFeeCents + payment.processingFeeCents) / 100).toFixed(2) : '');
  const [reference, setReference] = useState(initial.current?.payload.evidenceReference || '');
  const [reason, setReason] = useState(initial.current?.payload.reason || '');
  const [confirmed, setConfirmed] = useState(false);
  async function submit(event) {
    event.preventDefault(); if (busy || !confirmed) return;
    let review = attempt;
    try {
      if (!review) {
        if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) throw new Error('Enter the total processing fees in dollars, with no more than two decimal places.');
        const [dollars, cents = ''] = amount.trim().split('.');
        const totalFeeCents = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
        if (!Number.isSafeInteger(totalFeeCents) || totalFeeCents < 0 || totalFeeCents > 99_999_999) throw new Error('Enter total processing fees between $0.00 and $999,999.99.');
        if (totalFeeCents < payment.processingFeeCents) throw new Error('Total processing fees cannot be less than the already-verified payment fee.');
        // The API retains its separate evidence fields. Record only the
        // additional fee so the verified charge fee is never deducted twice.
        const invoicingFeeCents = totalFeeCents - payment.processingFeeCents;
        const payload = { invoicingFeeCents, evidenceReference: reference.trim(), reason: reason.trim() };
        if (!payload.evidenceReference || !payload.reason) throw new Error('Add an evidence reference and the reason for this fee review.');
        review = { payload, key: actionIdentity(scope, payload, undefined, true) };
        setAttempt(review);
      }
    } catch (err) { onError(err.message); return; }
    await onReview({ ...review.payload, idempotencyKey: review.key });
  }
  const locked = Boolean(busy || attempt);
  return <form className="commission-fee-review" onSubmit={submit} aria-label="Merchant processing-fee review">
    <div><h3>Review processing fees</h3><p className="hint">Enter the total Stripe fees from the recipient’s fee report, including any invoice-related charges. The already-verified payment fee of {commissionMoney(payment.processingFeeCents, payment.currency)} is included in this total, not added again. This is merchant-reviewed evidence, not independent provider verification of all fees.</p></div>
    <label>Processing fees (USD)<input type="number" inputMode="decimal" min="0" max="999999.99" step="0.01" required value={amount} disabled={locked} onChange={event => setAmount(event.target.value)} /></label>
    <label>Evidence reference<input type="text" required maxLength={500} value={reference} disabled={locked} placeholder="Stripe fee report or statement reference" onChange={event => setReference(event.target.value)} /></label>
    <label>Reason for fee review<textarea required maxLength={1000} rows={3} value={reason} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
    {attempt && <p role="status" className="hint">This review is saved for recovery. Retry the same evidence without changes, or check payment status to see whether it was recorded.</p>}
    <label className="commission-pay-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the total processing-fee evidence and authorize this immutable audit record. Any residual commission requires a fresh, separately approved payment; this review authorizes no debit or top-up.</span></label>
    <div className="commission-actions"><Button type="submit" disabled={Boolean(busy) || !confirmed}>{busy === 'fee-review' ? 'Recording the same fee review…' : attempt ? 'Retry saved fee review' : 'Record merchant fee review'}</Button></div>
  </form>;
}
