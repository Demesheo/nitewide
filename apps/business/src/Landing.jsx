import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Command,
  Layers3,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { features, pricing, questions, roadmap } from "./lib/landing-content";
import { customerLink } from "./lib/customer-link";
import FeeComparison from "./components/fee-comparison";
import "./landing.css";

const icons = {
  calendar: CalendarDays,
  chart: BarChart3,
  users: Users,
  shield: ShieldCheck,
};
const customerUrl = customerLink(
  import.meta.env.VITE_CUSTOMER_URL,
  window.location,
);

function Brand() {
  return (
    <a className="lp-brand" href="/" aria-label="Nitewide Business home">
      <span className="lp-brand-icon">
        <Command size={21} />
      </span>
      <span>
        nitewide<small>BUSINESS</small>
      </span>
    </a>
  );
}

function ProductPreview() {
  return (
    <div
      className="lp-preview"
      aria-label="Interactive business preview with illustrative data"
    >
      <div className="lp-preview-top">
        <span>
          <Command size={15} /> Your workspace
        </span>
        <span className="lp-sample">SAMPLE DATA</span>
      </div>
      <div className="lp-preview-body">
        <div className="lp-preview-heading">
          <div>
            <small>THE BIG PICTURE</small>
            <h2>A good night, in numbers.</h2>
          </div>
          <span className="lp-date">Last 7 days</span>
        </div>
        <Tabs defaultValue="sales">
          <TabsList aria-label="Product preview">
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="guestlists">Guestlists</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
          <TabsContent value="sales">
            <div className="lp-preview-metrics">
              <div>
                <small>Gross sales</small>
                <strong>
                  $12,840<span>USD</span>
                </strong>
              </div>
              <div>
                <small>Paid orders</small>
                <strong>186</strong>
              </div>
            </div>
            <div
              className="lp-chart"
              role="img"
              aria-label="Illustrative daily gross sales, Monday through Sunday: 640, 850, 1100, 1350, 2700, 3800, and 2400 dollars."
            >
              {[
                ["M", 640],
                ["T", 850],
                ["W", 1100],
                ["T", 1350],
                ["F", 2700],
                ["S", 3800],
                ["S", 2400],
              ].map(([day, sales], index) => (
                <div key={index}>
                  <span style={{ height: `${sales / 38}%` }} />
                  <small>{day}</small>
                </div>
              ))}
            </div>
            <div className="lp-preview-row">
              <span>
                <span className="lp-dot" /> VIP packages
              </span>
              <strong>$8,400</strong>
            </div>
            <div className="lp-preview-row">
              <span>
                <span className="lp-dot lp-dot-muted" /> General admission
              </span>
              <strong>$4,440</strong>
            </div>
          </TabsContent>
          <TabsContent value="guestlists">
            <div className="lp-preview-metrics">
              <div>
                <small>Approved entries</small>
                <strong>
                  64<span>/ 90</span>
                </strong>
              </div>
              <div>
                <small>Awaiting review</small>
                <strong>8</strong>
              </div>
            </div>
            <div className="lp-allocation">
              <span>
                Venue guestlist <b>36 / 50</b>
              </span>
              <progress
                value="36"
                max="50"
                aria-label="Venue guestlist: 36 of 50"
              />
            </div>
            <div className="lp-allocation">
              <span>
                Alex’s allocation <b>16 / 20</b>
              </span>
              <progress
                value="16"
                max="20"
                aria-label="Alex’s guestlist: 16 of 20"
              />
            </div>
            <div className="lp-allocation">
              <span>
                Jordan’s allocation <b>12 / 20</b>
              </span>
              <progress
                value="12"
                max="20"
                aria-label="Jordan’s guestlist: 12 of 20"
              />
            </div>
            <p className="lp-preview-note">
              <ShieldCheck size={15} /> Separate limits. Intentional approvals.
            </p>
          </TabsContent>
          <TabsContent value="events">
            <div className="lp-preview-metrics">
              <div>
                <small>Your upcoming events</small>
                <strong>3</strong>
              </div>
              <div>
                <small>Custom tiers</small>
                <strong>12</strong>
              </div>
            </div>
            {[
              ["FRI", "After Hours", "Tickets + VIP packages"],
              ["SAT", "The Late Session", "Tickets + VIP packages"],
              ["SUN", "Sunday Social", "Tickets + guestlist"],
            ].map(([day, name, type]) => (
              <div className="lp-demo-event" key={day}>
                <span>{day}</span>
                <div>
                  <strong>{name}</strong>
                  <small>{type}</small>
                </div>
                <Badge variant="secondary">Published</Badge>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </div>
      <div className="lp-preview-footer">
        <span>
          <Layers3 size={14} /> Events. Packages. People.
        </span>
        <span>
          One clear view <ArrowUpRight size={14} />
        </span>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="business-landing">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Brand />
          <nav aria-label="Business navigation">
            <a href="#features">Features</a>
            <a href="#compare">Why Nitewide</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="lp-header-actions">
            <a className="lp-explore" href={customerUrl}>
              Explore events <ArrowUpRight size={13} />
            </a>
            <Button asChild size="sm" variant="outline">
              <a href="/sign-in">
                Sign in <ArrowRight />
              </a>
            </Button>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="lp-hero lp-container">
          <div className="lp-hero-copy">
            <Badge variant="outline" className="lp-status">
              <span /> BUILT FOR THE PEOPLE BEHIND THE NIGHT
            </Badge>
            <h1>
              Make the night.
              <br />
              <em>Own the business.</em>
            </h1>
            <p>
              Your events, your team, your entire picture. Bring tickets,
              packages, guestlists, and sales insights into one beautifully
              connected workspace.
            </p>
            <div className="lp-actions">
              <Button asChild size="lg">
                <a href="/sign-in">
                  Enter your workspace <ArrowRight />
                </a>
              </Button>
              <a className="lp-text-link" href="#features">
                See what’s inside <ChevronDown size={16} />
              </a>
            </div>
            <p className="lp-demo-disclosure">
              <span className="lp-dot" /> Working demo available. Live payments
              coming next.
            </p>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-orbit" aria-hidden="true" />
            <ProductPreview />
            <div className="lp-preview-caption">
              <Sparkles size={13} /> Explore the preview. Numbers are
              illustrative, not customer results.
            </div>
          </div>
        </section>
        <div className="lp-audiences lp-container">
          <span>YOUR AMBITION. YOUR FORMAT.</span>
          <div>
            <span>Venues & lounges</span>
            <span>Independent creators</span>
            <span>Organizations & teams</span>
            <span>Promoters</span>
          </div>
        </div>

        <section id="features" className="lp-section lp-container">
          <div className="lp-section-heading">
            <div>
              <span className="lp-kicker">LESS FRICTION. MORE CLARITY.</span>
              <h2>
                Everything connected.
                <br />
                Nothing lost in the crowd.
              </h2>
            </div>
            <p>
              From the first published flyer to the last approved guest, give
              every person on your team a clearer way to work.
            </p>
          </div>
          <div className="lp-feature-grid">
            {features.map(({ icon, title, description, label }, index) => {
              const Icon = icons[icon];
              return (
                <article className="lp-feature" key={label}>
                  <div className="lp-feature-top">
                    <span className="lp-feature-icon">
                      <Icon size={23} />
                    </span>
                    <span>0{index + 1}</span>
                  </div>
                  <small>{label}</small>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="lp-available">
                    <Check size={13} /> Available in the demo
                  </span>
                </article>
              );
            })}
          </div>
        </section>

        <section className="lp-workflow lp-container">
          <div>
            <span className="lp-kicker">BUILT AROUND YOUR WORKFLOW</span>
            <h2>
              One account.
              <br />
              Every side of your business.
            </h2>
            <p>
              Create your own experience. Manage a venue’s calendar. Promote
              events across organizations. Your identity stays the same; your
              permissions follow your role.
            </p>
            <a className="lp-text-link" href="/sign-in">
              Find your workspace <ArrowRight size={16} />
            </a>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Set the scene</h3>
                <p>
                  Start with a flyer, schedule, and the ticket or package tiers
                  that fit your event.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Bring your people</h3>
                <p>
                  Work within assigned team roles and review guestlist requests
                  with clear limits.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>See what worked</h3>
                <p>
                  Compare recorded sales across your events, offerings, and
                  attributed team members.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section id="compare" className="lp-section lp-container">
          <div className="lp-section-heading">
            <div>
              <span className="lp-kicker">COMPARE THE FULL PICTURE</span>
              <h2>
                Your platform. Their platforms.
                <br />
                Every detail, side by side.
              </h2>
            </div>
            <p>
              Compare pricing, working features, and our next chapter with Posh,
              Eventbrite, Discotech, Tabler, and Sections. Published rates where available.
              Clear labels where we are still building.
            </p>
          </div>
          <FeeComparison />
          <p className="lp-fine-print">
            Based on linked official product information reviewed September 23,
            2026. Features overlap; unverified does not mean unavailable.
            Upcoming capabilities are not live. Nitewide is a working demo, not
            yet a live-payment alternative.
          </p>
        </section>

        <section id="pricing" className="lp-section lp-container">
          <div className="lp-section-heading">
            <div>
              <span className="lp-kicker">ROOM TO START. ROOM TO GROW.</span>
              <h2>
                Free to run your business.
                <br />
                Premium only if you want more.
              </h2>
            </div>
            <p>
              No organizer listing fees or standard platform transaction fees.
              Standard customer fees are 8% + $0.80 per paid ticket or package, with automatic competitive discounts and minimum-cost adjustments. Nitewide pays Stripe
              processing fees. Your only core software charge is the optional
              $249/month Premium subscription.
            </p>
          </div>
          <div className="lp-pricing-grid">
            <article className="lp-price">
              <Badge variant="outline">PLANNED LAUNCH PLAN</Badge>
              <h3>Free</h3>
              <p>Build your next experience.</p>
              <div className="lp-price-number">
                ${pricing.freeMonthly}
                <span>/ month</span>
              </div>
              <ul>
                {[
                  "Custom ticket & package tiers",
                  "Event and organization workspace",
                  "Guestlist requests & approvals",
                  "Core sales reporting",
                ].map((text) => (
                  <li key={text}>
                    <Check size={16} />
                    {text}
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline">
                <a href="/sign-in">
                  Explore the demo <ArrowRight />
                </a>
              </Button>
            </article>
            <article className="lp-price lp-premium">
              <Badge variant="secondary">
                <Sparkles size={12} /> ON THE ROADMAP
              </Badge>
              <h3>Premium</h3>
              <p>A deeper understanding of your business.</p>
              <div className="lp-price-number">
                ${pricing.premiumMonthly}
                <span>/ month</span>
              </div>
              <ul>
                {[
                  "Everything in Free",
                  "Advanced analytics & promoter ROI",
                  "Consent-based CRM & outreach",
                  "Advanced business management",
                ].map((text) => (
                  <li key={text}>
                    <Check size={16} />
                    {text}
                  </li>
                ))}
              </ul>
              <Button asChild>
                <a href="#roadmap">
                  See what’s coming <ArrowRight />
                </a>
              </Button>
            </article>
          </div>
          <div className="lp-fee">
            <Ticket size={23} />
            <div>
              <strong>
                {pricing.feePercent}% + ${pricing.feeFixed.toFixed(2)} per paid
                ticket/package. Both plans.
              </strong>
              <p>
                Customers pay Nitewide’s service fee; Nitewide covers routine
                Stripe processing from that fee, not your venue proceeds.
                Free has no subscription; Premium is optional and does not
                reduce checkout fees. Demo checkout collects no money; billing
                is not live.
              </p>
            </div>
          </div>
          <p className="lp-fine-print">
            “Free” describes core platform use—not an exemption from taxes,
            refunds, chargebacks, provider-specific exceptional charges, or
            venue-funded promoter rewards. Separate promoter arrangements are
            not customer checkout fees. Payment-provider terms and fee
            presentation will be confirmed before launch.
          </p>
        </section>

        <section id="roadmap" className="lp-section lp-container">
          <div className="lp-section-heading">
            <div>
              <span className="lp-kicker">THE NEXT CHAPTER</span>
              <h2>
                Built for tonight.
                <br />
                Thinking much further.
              </h2>
            </div>
            <p>
              Our direction is clear. These features are planned—not available
              today—and timing may change as we validate and launch.
            </p>
          </div>
          <div className="lp-roadmap">
            {roadmap.map((item) => (
              <article key={item.phase}>
                <span className="lp-phase">
                  {item.phase}
                  <span>UPCOMING</span>
                </span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
          <p className="lp-fine-print">
            Launch focus: Orlando, Miami, Fort Lauderdale, and Tampa. These are
            target markets, not a claim of current city coverage. Payouts will
            depend on provider eligibility, cleared funds, and risk checks.
          </p>
        </section>

        <section className="lp-faq lp-container">
          <div>
            <span className="lp-kicker">A FEW THINGS TO KNOW</span>
            <h2>Clear from the start.</h2>
          </div>
          <div>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={17} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-final lp-container">
          <span className="lp-kicker">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>
            Great nights deserve
            <br />
            <em>great business tools.</em>
          </h2>
          <p>Make more room for the experience. Give the operations a home.</p>
          <Button asChild size="lg">
            <a href="/sign-in">
              Sign in to Nitewide Business <ArrowRight />
            </a>
          </Button>
          <a href={customerUrl} className="lp-text-link">
            Just looking for a night out? Explore events{" "}
            <ArrowUpRight size={14} />
          </a>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <Brand />
        <p>Made for the people who make it happen.</p>
        <a href="#main">Back to top ↑</a>
      </footer>
    </div>
  );
}
