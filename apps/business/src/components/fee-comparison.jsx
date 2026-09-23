import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { comparePosh, comparisonSources, matrixColumns, matrixRows } from "../lib/comparison";
const savingsLabel = cents => cents >= 0 ? `save ${dollars(cents)}` : `pay ${dollars(-cents)} more`;
const dollars = cents => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(cents / 100);

export default function FeeComparison() {
  const [price, setPrice] = useState("20");
  const [quantity, setQuantity] = useState("1");
  const [orders, setOrders] = useState("1000");
  const result = comparePosh({ticketPrice:Number(price),quantity:Number(quantity),orders:Number(orders)});
  return <>
    <p className="lp-grid-hint" id="comparison-help">Nitewide: Yes = working demo. In dev = planned or in progress. A dash means no equivalent verified in reviewed public materials, not proof of absence.</p>
    <div className="lp-matrix-scroll" role="region" aria-label="Nitewide and competitor comparison" aria-describedby="comparison-help" tabIndex={0}>
      <table className="lp-matrix lp-deck-matrix">
        <caption>Features at a glance · reviewed September 23, 2026</caption>
        <thead><tr>{matrixColumns.map((name,i)=><th scope="col" key={name} className={i===1?'lp-nitewide-cell':''}>{name}</th>)}</tr></thead>
        <tbody>{matrixRows.map(([label,...values])=><tr key={label}>
          <th scope="row">{label}</th>
          {values.map((value,i)=><td key={matrixColumns[i+1]} className={i===0?'lp-nitewide-cell':''}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="lp-fine-print">Yes does not imply exact feature parity. Pricing safeguards run in the demo using modeled US rates. Live payments, contracted costs and settlement reconciliation remain in development.</p>
    <div className="lp-comparison-note">
      <strong>Lower buyer fees. Full venue face value.</strong>
      <p>Our standard fee is 8% + $0.80 per paid ticket/package. We automatically target 2% lower total buyer fees than the lower modeled Posh or Eventbrite standard rate. A minimum-cost adjustment takes priority when necessary, so the final fee can exceed that standard rate or a competitor. This is a discount on fees, not the entire ticket price. Lower fees leave guests more room for drinks and upgrades, but additional in-venue spending is not guaranteed. Nitewide covers routine processing.</p>
    </div>
    <details className="lp-sources"><summary>Sources & comparison limits</summary>
      <ul>{[...comparisonSources,
        {name:"Eventbrite pricing",url:"https://www.eventbrite.com/organizer/pricing/"},
        {name:"Posh individualized commissions",url:"https://support.posh.vip/en/articles/15077378-the-ultimate-guide-to-kickback-affiliates"}
      ].map(source=><li key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a></li>)}</ul>
      <p>Standard US/USD estimates for equal face value and quantity, before taxes. Eventbrite includes service and processing. Provider discounts, private contracts and actual checkout rounding may change the comparison. No universal lowest-price guarantee. Some providers serve different booking scopes.</p>
    </details>
    <div className="lp-fee-calculator">
      <div><span className="lp-kicker">COMPARE CHECKOUT COSTS</span><h3>What could your customers save?</h3>
        <p>Automatic fee discounts, with minimum-cost adjustments. Compare customer totals and venue proceeds before taxes.</p></div>
      <div className="lp-calculator-presets"><span>Try an example</span>
        {[[20,1,"One $20 ticket"],[25,3,"Three $25 tickets"],[300,1,"One $300 package"]].map(([p,q,label])=><Button key={label} variant="outline" size="sm" onClick={()=>{setPrice(String(p));setQuantity(String(q));}}>{label}</Button>)}
      </div>
      <div className="lp-calculator-inputs">
        <label htmlFor="compare-price">Face value per ticket / package ($)<Input id="compare-price" type="number" min=".01" max="10000" step=".01" value={price} onChange={e=>setPrice(e.target.value)}/></label>
        <label htmlFor="compare-quantity">Tickets / packages per order<Input id="compare-quantity" type="number" min="1" max="100" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <label htmlFor="compare-orders">Orders to compare<Input id="compare-orders" type="number" min="1" max="100000" step="1" value={orders} onChange={e=>setOrders(e.target.value)}/></label>
      </div>
      {!result ? <p role="alert">Enter a price from $0.01–$10,000, 1–100 whole items, and 1–100,000 whole orders.</p> :
      <div aria-live="polite" aria-atomic="true">
        <div className="lp-calculator-results">
          <div><span>Nitewide · estimated customer total</span>
            <strong>{result.eligible ? dollars(result.nitewideTotalCents) : "Unavailable"}</strong>
            {result.eligible ? <>
              <small>{dollars(result.subtotalCents)} face value + {dollars(result.platformCents)} service fee. Processing included.</small>
              {result.floorAdjusted && <small>A minimum-cost adjustment applies. The final fee may exceed our standard rate or competitor pricing.</small>}
              {result.discountCents > 0 && <small>{dollars(result.discountCents)} automatic fee discount from our ceiling.</small>}
              <small>Venue net: {dollars(result.organizerNetCents)}</small>
            </> : <small role="status">This combination does not qualify under our current pricing safeguards. Try another offering or quantity.</small>}
          </div>
          <div><span>Posh · published-rate customer total</span><strong>{dollars(result.poshTotalCents)}</strong>
            <small>{dollars(result.poshFeeCents)} fees · 10% + $0.99 per paid ticket, processing included.</small>
            <small>Venue net: {dollars(result.poshOrganizerNetCents)}</small></div>
          <div><span>Eventbrite · estimated customer total</span><strong>{dollars(result.eventbriteTotalCents)}</strong>
            <small>{dollars(result.eventbriteServiceCents)} service + {dollars(result.eventbriteProcessingCents)} processing.</small>
            <small>Venue net: {dollars(result.eventbriteOrganizerNetCents)}</small></div>
        </div>
        {result.eligible && <>
          <p className="lp-savings-result">Customers {savingsLabel(result.savingsCents)} per order versus Posh and {savingsLabel(result.eventbriteSavingsCents)} versus Eventbrite.</p>
          <p>{Number(orders).toLocaleString("en-US")} identical orders: customers {savingsLabel(result.aggregateSavingsCents)} versus Posh. This is customer savings, not organizer savings.</p>
        </>}
        <p>Venue net assumes buyer-paid checkout fees and excludes commissions, taxes, refunds and other obligations. Optional Premium is $249/month separately.</p>
      </div>}
      <p className="lp-fine-print">Nitewide standard rate: 8% + $0.80 per paid ticket/package, rounded per unit. Automatic discounts use 98% of the lowest modeled total buyer fee, rounded down. Minimum-cost adjustments override the standard rate and discount target when needed. Purchases are not rejected solely for missing these targets. Demo calculations use Stripe domestic-card processing of 2.9% + $0.30 on the full charge and excludes uncontracted Connect/payout costs and reserves; production cost coverage is not established. Eventbrite: 3.7% + $1.79 per ticket plus 2.9% of face value and service fees per order. Estimates exclude taxes, refunds, disputes, special contracts and international cards. Free guestlists stay free. Live payments are not yet enabled.</p>
    </div>
  </>;
}
