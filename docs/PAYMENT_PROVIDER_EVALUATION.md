# Payment provider evaluation

> September 23, 2026 pricing update: Historical pricing and financial projections below are superseded by [current fee policy](FEE_POLICY.md) and the [margin-protected pricing design](MARGIN_PROTECTED_PRICING_DESIGN.md). The demo baseline is standard 8% + $0.80 (automatic discounts and minimum-cost exceptions apply) per paid unit, Nitewide-paid processing; competitive caps remain design only. Re-run the financial model before using old projected revenue or contribution figures.

Last updated: September 21, 2026

Founder call preparation, projected volumes, commercial thresholds, compliance requirements, and the full question list are in [STAX_SALES_CALL_BRIEF.txt](STAX_SALES_CALL_BRIEF.txt).

## Decision status

**Stripe Connect is the selected MVP processor and implementation path.** This decision prioritizes launch speed, documentation, sandbox maturity, and the lowest practical integration burden for a solo founder. The implemented and published product policy remains [7.5% + $0.79 per paid order to the customer, with the organizer paying actual Stripe processing costs](FEE_POLICY.md). Nitewide does not absorb routine processing under the active roadmap.

The Stripe implementation should still preserve provider-neutral internal payment, ledger, dispute, and payout boundaries where that does not slow delivery. That keeps a later processor negotiation or migration possible without making Stax diligence a launch dependency.

The current shortlist is:

1. **Stripe Connect — selected MVP implementation.** Implement connected-seller direct charges and organizer-paid processing, subject to the final account configuration, liability ADR, legal review, and sandbox proof.
2. **Stax Connect — later commercial optimization candidate.** Retain the Orlando partnership brief and revisit after launch or when real volume supports stronger negotiated economics.
3. **PayPal Complete Payments Platform — later conversion and wallet option.** Evaluate as a secondary provider or payment-method expansion only after the Stripe launch path is stable.

Braintree Marketplace is not a preferred path because its marketplace structure can place processing, refund, and chargeback responsibilities on the master merchant. Adyen remains a later enterprise-scale option rather than an MVP dependency.

## Why Stax receives first diligence

Stax was founded in Orlando and lists its headquarters at 618 E South St., Orlando. That is strategically relevant—not a substitute for a favorable contract—because Nitewide's first design-partner market is Orlando. A local relationship could improve implementation access, risk/underwriting escalation, merchant introductions, co-marketing, and the credibility of a Florida-first pilot.

The proposed conversation is a **10–20 Orlando venue design-partner pilot**, with an evidenced path to **80 Florida venues**. Nitewide should ask Stax for a named platform owner, implementation and risk contacts, merchant onboarding support, launch SLAs, and a written scale schedule. Any merchant introductions or co-marketing are upside, not required assumptions in the financial model.

Stax publicly describes Connect capabilities including merchant enrollment, custom fees, split funding, portfolio/dispute workflows, and white-label embedded payments. Its public materials do not establish Nitewide's final all-in economics, merchant-of-record allocation, loss liability, payout timing, or contract terms. Those must be confirmed in writing.

## Commercial and risk acceptance gates

Stax could replace or supplement Stripe after launch only if the signed proposal and technical proof establish all of the following:

- The venue, organizer, or independent creator is the seller/settlement merchant for its transactions; Nitewide is the software platform and fee recipient, subject to counsel and processor approval.
- Refund principal, disputes, chargeback fees, fines, taxes, and merchant losses are debited from or recoverable against the responsible merchant—not silently shifted to Nitewide. Any residual platform liability, reserve, guarantee, indemnity, or collection exposure is quantified.
- Negative merchant balances, bank-debit recovery, failed recovery, reserves, payout holds, sales freezes, termination, and aging are documented. Automatic bank debit is treated as a recovery attempt, never guaranteed collection or zero A/R risk.
- The API supports idempotent payments, refunds, voids, webhooks, custom platform fees, immutable transaction references, reconciliation exports, dispute evidence, and the required payment-to-order-to-QR audit chain.
- Split funding can represent face-value proceeds, Nitewide fees, and promoter rewards without making accounting or reversals opaque. Funding instructions and every adjustment are exportable and reconcilable.
- Supported checkout methods and roadmap cover cards and the conversion-critical wallets approved for launch. Gaps in PayPal/Venmo, Apple Pay, or Google Pay have a documented mitigation.
- Standard payouts are scheduled promptly after funds clear, with truthful availability and bank-arrival language. No contract or customer promise says every payment reaches a bank within 24 hours.
- The written quote includes interchange/network costs, processor markup, per-transaction and authorization fees, platform/monthly minimums, merchant/KYC fees, gateway/tokenization fees, chargeback/refund fees, payout/instant-payout fees, PCI/noncompliance fees, reserves, termination terms, and revenue share.
- At the planning volume, the modeled effective processing cost is **2.6% or lower**, with **2.2%–2.4%** the preferred scale band. These are negotiation gates, not claims about Stax's published price.
- Security, PCI scope, data portability, uptime/support commitments, incident notification, migration assistance, subcontractors, and termination/export rights pass engineering and counsel review.

These gates now control any future decision to migrate from Stripe to Stax. They do not block the Stripe MVP.

## Cost-bearing scenarios to preserve

The active MVP scenario is fixed. The alternative remains an archived sensitivity, not planned behavior:

| Scenario | Routine processing cost | Merchant loss/refund/dispute responsibility | Product status |
|---|---|---|---|
| Current approved policy | Organizer/creator | Responsible merchant, within provider and contract rules | Implemented/documented |
| Zero mandatory organizer-fee experiment | Nitewide absorbs routine processing | Responsible merchant; Nitewide does not insure merchant losses | Deferred sensitivity; not on the active roadmap |

The deferred zero-mandatory-fee sensitivity retains optional Premium at $249/month and Nitewide's configurable 10% service fee on organizer-funded promoter rewards. It must not appear in product copy, checkout, contracts, sales materials, or operating forecasts as the active policy.

## Provider scorecard

Use weighted evidence rather than brand preference. Each provider receives 0–5 points per category, a source link or contract section, an owner, and a review date.

| Category | Weight | Minimum evidence |
|---|---:|---|
| Merchant/loss-liability isolation | 25% | Contract, account structure, reserve and recovery terms |
| All-in economics at launch and scale | 20% | Written quote and sensitivity model |
| API, webhooks, ledger and dispute fit | 15% | Sandbox proof and failure-mode tests |
| Onboarding/KYC/KYB and venue UX | 10% | End-to-end test with remediation states |
| Payout speed, holds and transparency | 10% | Funds-availability and bank-arrival evidence |
| Checkout conversion/payment methods | 10% | Supported-method matrix and mobile test |
| Operations, support and portability | 5% | SLAs, escalation path, export/termination terms |
| Florida partnership leverage | 5% | Named commitments for pilot, introductions or co-marketing |

No category score may override a failed merchant-liability, compliance, security, or reconciliation gate.

## Orlando pilot exit criteria

The pilot is successful only when:

- 10–20 qualified Orlando venues can complete merchant onboarding and remediation without founder-only workarounds.
- Sandbox and limited live flows cover purchase, platform fee, promoter reward, refund, dispute, negative balance, payout, reconciliation, and QR admission evidence.
- Provider reports reconcile to Nitewide's immutable ledger and bank deposits with no unexplained variance.
- Payout status distinguishes pending, available, scheduled, in transit, paid, failed, reversed, and held.
- Venue operators receive truthful dispute tasks and can submit evidence without sensitive attachments in email.
- Actual effective cost, authorization/conversion, payout timing, support load, dispute rate, recovery rate, and venue satisfaction are reviewed against the Stripe benchmark.
- Engineering, finance, counsel, and the founder approve a written go/no-go record and rollback plan.

## Diligence questions for Stax

1. Under the proposed Stax Connect model, which legal entity is the seller/settlement merchant and which party is ultimately liable for merchant losses?
2. When a venue balance is negative, which accounts can Stax debit, what consent is required, what happens when recovery fails, and can Stax ever collect from Nitewide?
3. Can Nitewide collect a configurable platform fee and route organizer-funded promoter rewards while preserving reversible, itemized ledger entries?
4. Which card and wallet methods are supported in the embedded checkout, and are there method-specific economics or liability differences?
5. What are the complete launch and scale economics, revenue share, reserves, minimums, onboarding fees, payout fees, chargeback/refund fees, and termination costs?
6. What does same-day or next-day funding mean: transaction time, funds availability, payout initiation, or bank arrival? What holds and exceptions apply?
7. What dispute APIs, evidence formats, deadlines, webhooks, dashboards, and merchant self-service controls are available?
8. What named implementation, underwriting, risk, and incident escalation support will Stax commit to for an Orlando pilot?
9. Will Stax support local merchant introductions or a Florida co-marketing case study if pilot metrics pass?
10. How are data export, token portability, merchant migration, and service termination handled?

## Sources

- [Stax company overview and Orlando headquarters](https://staxpayments.com/about-stax/)
- [Stax Connect capabilities](https://staxpayments.com/stax-connect/)
- [Stax split-funding documentation](https://docs.staxpayments.com/docs/split-funding-1)
- [Stripe guidance on direct charges](https://support.stripe.com/questions/what-should-i-know-about-using-direct-charges)
- [Stripe Connect reserve and loss-liability behavior](https://support.stripe.com/questions/reserves-for-connect-platforms-and-connected-accounts)
- [PayPal Complete Payments Platform onboarding](https://developer.paypal.com/platforms/get-started/)
- [PayPal connected-platform dispute roles](https://developer.paypal.com/docs/disputes/)

Pricing, liability, capabilities, and payout behavior can change. Revalidate every external claim and obtain signed processor terms before implementation or publication.
