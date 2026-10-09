import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { commissionMoney, commissionPaymentLabel } from './MyCommissions';
import { CommissionFeeReview, canReviewCommissionFee } from './CommissionFeeReview';
import { actionIdentity } from '../../../shared/action-identity';
import './commissions.css';

const invoiceUrl = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'invoice.stripe.com' || url.username || url.password || url.port) throw new Error('Stripe returned an invalid payment link. Refresh the payment before continuing.');
  return url.href;
};

const canPayInvoice = payment => payment?.providerVerificationStatus === 'verified' && ['awaiting_payment', 'payment_failed'].includes(payment.status);
const installmentFingerprint = (quote, statements) => quote.installmentFingerprint ?? statements.map(row => ({ id: row.id, paymentId: row.latestPaymentAttempt?.paymentId || row.payment?.paymentId || null })).sort((a, b) => a.id.localeCompare(b.id));

function CommissionPaymentDialog({ session, organization, statements, existingPaymentId, request, onClose, onChanged }) {
  const [method, setMethod] = useState('card'), [quote, setQuote] = useState(null), [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const lock = useRef(false), identity = useRef(null);
  const base = `/business/organizations/${organization.id}/commission-payments`;
  const statementIds = statements.map(row => row.id).sort(), ids = statementIds.join(',');
  useEffect(() => {
    const controller = new AbortController(); setQuote(null); setConfirmed(false); setError('');
    if (existingPaymentId) {
      request(`${base}/${existingPaymentId}`, session, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setPayment(result); }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
      return () => controller.abort();
    }
    request(`${base}/quote`, session, { method: 'POST', body: JSON.stringify({ statementIds, paymentMethod: method }), signal: controller.signal }).then(result => { if (!controller.signal.aborted) setQuote(result); }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, ids, method, revision, existingPaymentId]);
  async function submit(event) {
    event.preventDefault(); if (lock.current || !quote || !confirmed) return;
    const payload = { statementIds, paymentMethod: method, approvedTotalCents: quote.totalCents, feeEstimateAcknowledged: true };
    const scope = `commission-payment.${session.user.id}.${organization.id}.${statementIds.join('.')}`;
    const attempt = { ...payload, installmentFingerprint: installmentFingerprint(quote, statements) };
    try { if (identity.current?.payload !== JSON.stringify(attempt)) identity.current = { payload: JSON.stringify(attempt), key: actionIdentity(scope, attempt, undefined, true) }; }
    catch (err) { setError(err.message); return; }
    lock.current = true; setBusy('create'); setError('');
    try { const result = await request(base, session, { method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: identity.current.key }) }); setPayment(result); onChanged(); }
    catch (err) { setError(err.message); } finally { lock.current = false; setBusy(''); }
  }
  async function check(reconcile = false) {
    if (lock.current) return; lock.current = true; setBusy('check'); setError('');
    try { const result = await request(`${base}/${payment.paymentId}${reconcile ? '/reconcile' : ''}`, session, reconcile ? { method: 'POST' } : {}); setPayment(result); onChanged(); }
    catch (err) { setError(err.message); } finally { lock.current = false; setBusy(''); }
  }
  async function reviewFee(body) {
    if (lock.current) return; lock.current = true; setBusy('fee-review'); setError('');
    try { const result = await request(`${base}/${payment.paymentId}/invoicing-fee-review`, session, { method: 'POST', body: JSON.stringify(body) }); setPayment(result); onChanged(); }
    catch (err) { setError(err.message); } finally { lock.current = false; setBusy(''); }
  }
  let url;
  if (canPayInvoice(payment) && payment?.hostedInvoiceUrl) { try { url = invoiceUrl(payment.hostedInvoiceUrl); } catch { /* Report below without rendering an untrusted URL. */ } }
  const currency = payment?.currency || quote?.currency || statements[0]?.currency;
  const verifiedFunds = payment?.providerVerificationStatus === 'verified' && payment.fundsReceived === true;
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="commission-payment-dialog" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }} aria-busy={Boolean(busy)}><DialogHeader><DialogTitle>{payment ? 'Commission payment' : 'Confirm commission payment'}</DialogTitle><DialogDescription>{organization.name} pays {statements[0].recipientDisplayName || 'this individual'} directly. {statements.length} explicitly selected, separately approved {statements.length === 1 ? 'statement' : 'statements'}.</DialogDescription></DialogHeader>{error && <p role="alert" className="error">{error}</p>}
    <div className="commission-quote-statements">{(payment?.statements || quote?.statements || statements).map(row => <div key={row.id}><strong>{row.eventTitle}</strong><span>{commissionMoney(row.amountCents ?? row.payableCommissionCents, row.currency || currency)}</span></div>)}</div>
    {!payment && quote?.feeEstimateBasis === 'sandbox_estimate' && <p className="hint">Sandbox payment · Test funds only.</p>}
    {payment ? <>
      <p role="status">{commissionPaymentLabel(payment)}</p>
      <dl className="commission-amounts"><div><dt>Commission net owed</dt><dd>{commissionMoney(payment.commissionCents, currency)}</dd></div><div><dt>Approved gross</dt><dd>{commissionMoney(payment.totalCents, currency)}</dd></div><div><dt>{payment.feeEvidence === 'merchant_reviewed' ? 'Stripe fee · merchant reviewed' : 'Actual Stripe fee'}</dt><dd>{payment.actualFeeCents == null ? 'Awaiting fee evidence' : commissionMoney(payment.actualFeeCents, currency)}</dd></div><div><dt>{payment.feeEvidence === 'merchant_reviewed' ? 'Stripe net · merchant reviewed' : 'Provider-verified Stripe net'}</dt><dd>{!verifiedFunds || !payment.feeEvidence || payment.verifiedNetCents == null ? 'Not verified' : commissionMoney(payment.verifiedNetCents, currency)}</dd></div></dl>
      <p className="hint">The business covers Stripe’s processing cost. The approved amount is an allowance based on estimated fees. Invoice payment alone is not evidence of full net receipt, and Stripe credit is separate from a bank payout.</p>
      {payment.feeEvidence === 'merchant_reviewed' && <div className="commission-fee-evidence"><p className="hint">The charge and processing fee are provider-verified. The invoicing fee and resulting net amount use an audited merchant review, not independent provider fee proof.</p>{payment.feeReview && <><p>Evidence reference: {payment.feeReview.evidenceReference}</p><p>Review reason: {payment.feeReview.reason}</p><small>Reviewed {new Date(payment.feeReview.reviewedAt).toLocaleString()}</small></>}</div>}
      {payment.residualCents > 0 && <p className="error">Fee reconciliation found {commissionMoney(payment.residualCents, currency)} still owed. Close this payment, refresh statements and select the unreserved payable balance for a fresh quote and separate approval. No automatic top-up or debit will occur.</p>}
      {url && <a className="payment-setup-link" href={url} target="_blank" rel="noopener noreferrer">Pay from business bank account or card in Stripe ↗</a>}
      {canPayInvoice(payment) && payment.hostedInvoiceUrl && !url && <p role="alert" className="error">Stripe returned an invalid payment link. Check payment status to retry.</p>}
      {canReviewCommissionFee(payment) && <CommissionFeeReview key={payment.paymentId} session={session} payment={payment} busy={busy} onReview={reviewFee} onError={setError} />}
      <div className="commission-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={() => check(false)}>{busy === 'check' ? 'Checking payment…' : 'Check payment status'}</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => check(true)}>Reconcile Stripe fees</Button></div>
      <DialogFooter><Button onClick={onClose} disabled={Boolean(busy)}>Done</Button></DialogFooter>
    </>
      : <form onSubmit={submit}><label>Business payment method<select value={method} disabled={Boolean(busy)} onChange={event => setMethod(event.target.value)}><option value="card">Business card</option><option value="us_bank_account">Business US bank account</option></select></label>{quote ? <><dl className="commission-amounts"><div><dt>Commission net owed</dt><dd>{commissionMoney(quote.commissionCents, quote.currency)}</dd></div><div><dt>Estimated Stripe fee</dt><dd>{commissionMoney(quote.estimatedFeeCents, quote.currency)}</dd></div><div><dt>Business fee allowance</dt><dd>{commissionMoney(quote.totalCents - quote.commissionCents, quote.currency)}</dd></div><div><dt>Approved gross</dt><dd>{commissionMoney(quote.totalCents, quote.currency)}</dd></div></dl><p className="hint">The business covers the processing fee so the individual receives the commission owed. This is an estimate, subject to Stripe fee reconciliation. Nitewide takes no commission application fee and makes no transfers. Customer order payments remain separate.</p><label className="commission-pay-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} /><span>I approve each listed statement and the gross amount, including the business-funded fee allowance. I will explicitly pay through Stripe; this does not authorize automatic debits or top-ups.</span></label></> : !error && <p role="status">Estimating business-funded Stripe fees…</p>}<DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>Cancel</Button>{error && <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}>Refresh estimate</Button>}<Button type="submit" disabled={Boolean(busy) || !quote || !confirmed}>{busy ? 'Preparing the same payment…' : 'Create approved Stripe payment'}</Button></DialogFooter></form>}
  </DialogContent></Dialog>;
}

export function CommissionStatements({ session, organization, request = api }) {
  const [data, setData] = useState(null), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [selected, setSelected] = useState([]);
  const [approval, setApproval] = useState(null), [payment, setPayment] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const base = `/business/organizations/${organization.id}/commission-statements`;
  useEffect(() => {
    const controller = new AbortController(); setError('');
    request(`${base}?page=${page}&pageSize=10`, session, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, session.accessToken, page, revision]);
  async function approve() {
    if (busy) return; setBusy(true); setError('');
    try { await request(`${base}/${approval.id}/approve`, session, { method: 'POST', body: JSON.stringify({}) }); setApproval(null); setNotice('This statement is approved. Select it explicitly when you are ready to fund its payment.'); setRevision(value => value + 1); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function toggle(row) {
    if (selected.some(item => item.id === row.id)) return setSelected(items => items.filter(item => item.id !== row.id));
    if (selected.length >= 100) { setError('Select at most 100 approved statements for one payment.'); return; }
    if (selected.length && (selected[0].recipientUserId !== row.recipientUserId || selected[0].currency.toLowerCase() !== row.currency.toLowerCase())) { setError('Combine only statements for the same business, individual and currency. Clear your selection to choose another individual.'); return; }
    setError(''); setSelected(items => [...items, row]);
  }
  return <section className="panel commission-statements"><div className="section-heading"><div><span className="eyebrow">BUSINESS-FUNDED COMMISSIONS</span><h2>Commission statements</h2><p>Review and approve each event’s statement after the event ends plus 48 hours. Select approved statements explicitly to pay an individual.</p></div><Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh statements</Button></div>{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}<p className="hint">Small balances may be combined only after separate approval, for the same business, recipient and currency. No automatic debits or top-ups.</p>{!data && !error && <p role="status">Loading commission statements…</p>}{data && <><div className="commission-statement-list">{data.items.map(row => <article className="commission-statement" key={row.id}><div className="commission-statement-header"><input type="checkbox" aria-label={`Select approved statement for ${row.recipientDisplayName || 'individual'} at ${row.eventTitle}`} checked={selected.some(item => item.id === row.id)} disabled={row.status !== 'approved' || !row.payableCommissionCents || row.reservedCommissionCents > 0 || busy} onChange={() => toggle(row)} /><div><h3>{row.eventTitle}</h3><p>{row.recipientDisplayName || 'Individual'} · {row.status}</p><small>Available {new Date(row.availableAt).toLocaleString()}</small></div></div><dl className="commission-amounts">{[['Earned', row.originalCommissionCents], ['Held', row.heldCommissionCents], ['Payable', row.payableCommissionCents], ['Commission credited', row.paidCommissionCents]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{commissionMoney(amount, row.currency)}</dd></div>)}</dl>{row.payment && <div className="commission-actions"><p className="hint">{commissionPaymentLabel(row.payment)}</p><Button variant="outline" disabled={busy} onClick={() => setPayment({ statements: [row], existingPaymentId: row.payment.paymentId })}>View payment for {row.eventTitle}</Button></div>}{row.status !== 'approved' && <div className="commission-actions"><Button variant="outline" disabled={!row.canApprove || busy} onClick={() => { setApproval(row); setError(''); }}>Review approval for {row.eventTitle}</Button>{!row.canApprove && <span className="hint">{row.approvalBlocker || 'Available after event end + 48 hours and all holds are resolved.'}</span>}</div>}</article>)}</div>{!data.items.length && <p>No commission statements yet.</p>}<div className="commission-actions"><Button disabled={!selected.length || busy} onClick={() => { setPayment({ statements: [...selected] }); setError(''); }}>Pay {selected.length ? `${selected.length} selected ${selected.length === 1 ? 'statement' : 'statements'}` : 'selected statements'}</Button>{selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Clear selected statements</Button>}</div>{data.total > 10 && <div className="commission-actions"><Button variant="outline" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>Previous statements</Button><span>Page {page}</span><Button variant="outline" disabled={page * 10 >= data.total || busy} onClick={() => setPage(value => value + 1)}>Next statements</Button></div>}</>}
    {approval && <Dialog open onOpenChange={value => { if (!value && !busy) setApproval(null); }}><DialogContent className="commission-payment-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>Approve this statement?</DialogTitle><DialogDescription>{approval.eventTitle} · {approval.recipientDisplayName || 'Individual'}</DialogDescription></DialogHeader><p>{commissionMoney(approval.payableCommissionCents, approval.currency)} payable. The server rechecks the 48-hour release period, refund requests, disputes and recipient eligibility.</p><p className="hint">Approval records this one statement. You will choose and confirm a separate business-funded payment afterward.</p>{error && <p className="error" role="alert">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setApproval(null)}>Keep pending</Button><Button disabled={busy} onClick={approve}>{busy ? 'Approving…' : 'Approve this statement'}</Button></DialogFooter></DialogContent></Dialog>}
    {payment && <CommissionPaymentDialog session={session} organization={organization} statements={payment.statements} existingPaymentId={payment.existingPaymentId} request={request} onClose={() => { setPayment(null); setSelected([]); }} onChanged={() => setRevision(value => value + 1)} />}
  </section>;
}
