import { useRef, useState } from 'react';
import { Button } from './ui/button';
import { actionIdentity } from '../../../shared/action-identity';

export const canReviewCommissionFee = payment => payment?.status === 'paid_fee_review'
  && payment.providerVerificationStatus === 'verified' && payment.fundsReceived === true
  && payment.processingFeeCents != null && payment.feeEvidence === null;

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
  const [amount, setAmount] = useState(initial.current ? (initial.current.payload.invoicingFeeCents / 100).toFixed(2) : '');
  const [reference, setReference] = useState(initial.current?.payload.evidenceReference || '');
  const [reason, setReason] = useState(initial.current?.payload.reason || '');
  const [confirmed, setConfirmed] = useState(false);
  async function submit(event) {
    event.preventDefault(); if (busy || !confirmed) return;
    let review = attempt;
    try {
      if (!review) {
        if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) throw new Error('Enter the invoicing fee in dollars, with no more than two decimal places.');
        const [dollars, cents = ''] = amount.trim().split('.');
        const invoicingFeeCents = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
        if (!Number.isSafeInteger(invoicingFeeCents) || invoicingFeeCents < 0 || invoicingFeeCents > 99_999_999) throw new Error('Enter an invoicing fee between $0.00 and $999,999.99.');
        const payload = { invoicingFeeCents, evidenceReference: reference.trim(), reason: reason.trim() };
        if (!payload.evidenceReference || !payload.reason) throw new Error('Add an evidence reference and the reason for this fee review.');
        review = { payload, key: actionIdentity(scope, payload, undefined, true) };
        setAttempt(review);
      }
    } catch (err) { onError(err.message); return; }
    await onReview({ ...review.payload, idempotencyKey: review.key });
  }
  const locked = Boolean(busy || attempt);
  return <form className="commission-fee-review" onSubmit={submit} aria-label="Merchant invoicing-fee review">
    <div><h3>Review Stripe invoicing fee</h3><p className="hint">Stripe independently verified the payment and processing fee. An authorized business reviewer must document the additional invoicing fee, including a documented $0.00 fee. This is merchant-reviewed evidence, not independent provider verification of the invoicing fee.</p></div>
    <label>Invoicing fee (USD)<input type="number" inputMode="decimal" min="0" max="999999.99" step="0.01" required value={amount} disabled={locked} onChange={event => setAmount(event.target.value)} /></label>
    <label>Evidence reference<input type="text" required maxLength={500} value={reference} disabled={locked} placeholder="Stripe fee report or statement reference" onChange={event => setReference(event.target.value)} /></label>
    <label>Reason for fee review<textarea required maxLength={1000} rows={3} value={reason} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
    {attempt && <p role="status" className="hint">This review is saved for recovery. Retry the same evidence without changes, or check payment status to see whether it was recorded.</p>}
    <label className="commission-pay-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the invoicing-fee evidence and authorize this immutable audit record. Any residual commission requires a fresh, separately approved payment; this review authorizes no debit or top-up.</span></label>
    <div className="commission-actions"><Button type="submit" disabled={Boolean(busy) || !confirmed}>{busy === 'fee-review' ? 'Recording the same fee review…' : attempt ? 'Retry saved fee review' : 'Record merchant fee review'}</Button></div>
  </form>;
}
