import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  CalendarDays,
  Search,
  Heart,
  Ticket,
  Sparkles,
  Wine,
  Music2,
  Users,
  SlidersHorizontal,
  Minus,
  Plus,
  Check,
  LogOut,
  LoaderCircle,
  Compass,
  X,
  LocateFixed,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { AuthDialog } from "./components/auth-dialog";
import { detectCurrentCity, localDateInputValue } from "./discovery-defaults";
import { api } from "./lib/api";
import {
  availableQuantity,
  checkoutTotal,
  cityName,
  filterEvents,
  money,
  readStorage,
  writeStorage,
} from "./lib/discovery";

const photos = [
  "photo-1470229722913-7c0e2dbbafd3",
  "photo-1514525253161-7a46d19cd819",
  "photo-1516450360452-9312f5e86fc7",
  "photo-1506157786151-b8491531f063",
  "photo-1492684223066-81342ee5ff30",
  "photo-1501386761578-eac5c94b800a",
];
const photo = (index, width = 900) =>
  `https://images.unsplash.com/${photos[Math.abs(index) % photos.length]}?auto=format&fit=crop&w=${width}&q=85`;
const artIndex = (event) =>
  [...(event.organization?.name || event.title)].reduce(
    (n, char) => n + char.charCodeAt(0),
    0,
  );
const eventDate = (event) =>
  new Date(event.startsAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: event.location?.timezone,
  });
const eventTime = (event) =>
  new Date(event.startsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.location?.timezone,
  });
const categories = [
  ["all", Compass, "All experiences"],
  ["vip", Wine, "VIP & tables"],
  ["music", Music2, "Live music"],
  ["guestlist", Users, "Guestlists"],
];
const Brand = () => (
  <a href="/" aria-label="Nitewide home" className="brand">
    nitewide<span>✳</span>
  </a>
);
function validSession() {
  const session = readStorage("nitewide.session", null);
  return session?.user?.id &&
    session.accessToken &&
    new Date(session.expiresAt) > new Date()
    ? session
    : null;
}

function EventCard({ event, saved, onSave, onOpen }) {
  const offerings =
    event.offerings?.filter((o) => availableQuantity(o) > 0) || [];
  const lowest = offerings.length
    ? Math.min(...offerings.map((o) => o.priceCents))
    : null;
  return (
    <article className="event-card">
      <div className="card-image">
        <button
          className="image-link"
          onClick={onOpen}
          aria-label={`Explore ${event.title}`}
        >
          <img src={photo(artIndex(event), 720)} alt="" loading="lazy" />
        </button>
        <Badge className="photo-badge">
          {event.category === "nightlife"
            ? "AFTER DARK"
            : event.category.replaceAll("_", " ").toUpperCase()}
        </Badge>
        <button
          className={`save-button ${saved ? "saved" : ""}`}
          aria-label={`${saved ? "Unsave" : "Save"} ${event.title}`}
          aria-pressed={saved}
          onClick={onSave}
        >
          <Heart size={17} fill={saved ? "currentColor" : "none"} />
        </button>
        <span className="image-date">
          {eventDate(event)} <span>· {eventTime(event)}</span>
        </span>
      </div>
      <div className="card-copy">
        <p className="venue-name">
          {event.organization?.name || "Independent experience"}
        </p>
        <button className="card-title" onClick={onOpen}>
          {event.title}
        </button>
        <p className="card-location">
          <MapPin size={13} />
          {cityName(event)}
          {event.location?.region ? `, ${event.location.region}` : ""}
        </p>
        <div className="card-bottom">
          <span>
            {lowest === null ? (
              "Explore guestlist"
            ) : lowest === 0 ? (
              "Free admission"
            ) : (
              <>
                <small>From</small> {money(lowest)} <small>+ fees</small>
              </>
            )}
          </span>
          <button onClick={onOpen} aria-label={`Book ${event.title}`}>
            <ArrowUpRight size={21} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [events, setEvents] = useState([]),
    [loadState, setLoadState] = useState("loading");
  const [city, setCity] = useState(""),
    [date, setDate] = useState(localDateInputValue),
    [query, setQuery] = useState("");
  const [category, setCategory] = useState("all"),
    [sort, setSort] = useState("date"),
    [priceCap, setPriceCap] = useState("any");
  const [saved, setSaved] = useState(() => readStorage("nitewide.saved", [])),
    [view, setView] = useState("discover");
  const [session, setSession] = useState(validSession),
    [authOpen, setAuthOpen] = useState(false),
    [walletOpen, setWalletOpen] = useState(false);
  const [selected, setSelected] = useState(null),
    [offeringId, setOfferingId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [stage, setStage] = useState("details");
  const [booking, setBooking] = useState(null),
    [bookings, setBookings] = useState(() =>
      readStorage("nitewide.demo-bookings", []),
    );
  const [guestState, setGuestState] = useState(""),
    [guestBusy, setGuestBusy] = useState(false),
    [guestError, setGuestError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false),
    [limit, setLimit] = useState(9),
    [notice, setNotice] = useState("");
  const locationEdited = useRef(false),
    pendingAuth = useRef(null);
  const [locationState, setLocationState] = useState("finding");
  async function loadEvents() {
    setLoadState("loading");
    try {
      const loaded = await api("/events?limit=100");
      setEvents(
        loaded.map((event) => ({
          ...event,
          offerings: [...(event.offerings || [])].sort(
            (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
          ),
        })),
      );
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }
  useEffect(() => {
    loadEvents();
  }, []);
  useEffect(() => {
    let active = true;
    detectCurrentCity().then((value) => {
      if (active) {
        if (!locationEdited.current) setCity(value || "Orlando, FL");
        setLocationState(value ? "detected" : "fallback");
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    api("/auth/me", {
      token: session.accessToken,
      signal: controller.signal,
    }).catch((error) => {
      if (error.status === 401) {
        setSession(null);
        writeStorage("nitewide.session", null);
        setNotice("Your session expired. Please sign in again.");
      }
    });
    const timer = setTimeout(
      () => {
        setSession(null);
        writeStorage("nitewide.session", null);
      },
      Math.max(0, new Date(session.expiresAt) - new Date()),
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [session?.accessToken]);
  useEffect(() => {
    setLimit(9);
  }, [city, date, query, category, sort, priceCap, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const results = filterEvents(events, {
    city,
    date,
    query,
    category,
    savedIds: view === "saved" ? saved : null,
  }).filter(
    (event) =>
      priceCap === "any" ||
      event.offerings?.some(
        (o) => availableQuantity(o) && o.priceCents <= Number(priceCap),
      ),
  );
  const minimum = (event) =>
    Math.min(
      ...(event.offerings || [])
        .filter((o) => availableQuantity(o))
        .map((o) => o.priceCents),
      Infinity,
    );
  results.sort((a, b) =>
    sort === "price"
      ? minimum(a) - minimum(b)
      : new Date(a.startsAt) - new Date(b.startsAt),
  );
  const upcoming = filterEvents(events, { city }).sort(
    (a, b) => new Date(a.startsAt) - new Date(b.startsAt),
  );
  const featured = upcoming[0];
  const offering = selected?.offerings?.find((o) => o.id === offeringId);
  const totals = checkoutTotal(offering?.priceCents || 0, quantity);
  function browse(nextCategory = "all") {
    setCategory(nextCategory);
    setView("discover");
    setDate("");
    setQuery("");
    setPriceCap("any");
    document.getElementById("discover")?.scrollIntoView({ behavior: "smooth" });
  }
  function openEvent(event) {
    setSelected(event);
    const first = event.offerings?.find((o) => availableQuantity(o));
    setOfferingId(first?.id || "");
    setQuantity(first?.minPerOrder || 1);
    setStage("details");
    setGuestState("");
    setGuestError("");
  }
  function selectOffering(id) {
    setOfferingId(id);
    const item = selected.offerings.find((o) => o.id === id);
    setQuantity(item.minPerOrder || 1);
  }
  function save(event) {
    const next = saved.includes(event.id)
      ? saved.filter((id) => id !== event.id)
      : [...saved, event.id];
    setSaved(next);
    writeStorage("nitewide.saved", next);
  }
  function authSuccess(data) {
    setSession(data);
    writeStorage("nitewide.session", data);
    setNotice(`You're in, ${data.user.displayName.split(" ")[0]}.`);
    const next = pendingAuth.current;
    pendingAuth.current = null;
    if (next === "checkout") setStage("checkout");
    if (next === "wallet") setWalletOpen(true);
  }
  function checkout() {
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
    } else setStage("checkout");
  }
  function completeDemo() {
    if (!session) {
      pendingAuth.current = "checkout";
      setAuthOpen(true);
      return;
    }
    if (!offering || availableQuantity(offering) < quantity) return;
    const receipt = {
      id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      userId: session.user.id,
      event: {
        title: selected.title,
        startsAt: selected.startsAt,
        location: selected.location,
      },
      offering: offering.name,
      quantity,
      total: totals.total,
      currency: offering.currency,
      createdAt: new Date().toISOString(),
    };
    const next = [receipt, ...bookings];
    setBookings(next);
    writeStorage("nitewide.demo-bookings", next);
    setBooking(receipt);
    setStage("complete");
  }
  async function requestGuestlist() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setGuestBusy(true);
    setGuestError("");
    try {
      await api(`/events/${selected.id}/guestlist`, {
        token: session.accessToken,
        body: { partySize: 1 },
      });
      setGuestState("pending");
    } catch (error) {
      if (error.status === 401) {
        setSession(null);
        setAuthOpen(true);
      }
      setGuestError(
        error.status === 409
          ? "You already have a guestlist request for this event."
          : error.message,
      );
    } finally {
      setGuestBusy(false);
    }
  }
  const myBookings = bookings.filter(
    (item) => item.userId === session?.user.id,
  );
  return (
    <>
      <a className="skip-link" href="#discover">
        Skip to events
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <button
              className={view === "discover" ? "active" : ""}
              onClick={() => {
                setView("discover");
                document
                  .getElementById("discover")
                  .scrollIntoView({ behavior: "smooth" });
              }}
            >
              Discover
            </button>
            <button onClick={() => browse("vip")}>VIP & tables</button>
            <button
              onClick={() => {
                setView("saved");
                setDate("");
                setCity("");
                setQuery("");
                setCategory("all");
                setPriceCap("any");
                locationEdited.current = true;
                document
                  .getElementById("discover")
                  .scrollIntoView({ behavior: "smooth" });
              }}
            >
              Saved <span>{saved.length || ""}</span>
            </button>
          </nav>
          <div className="header-actions">
            <button
              className="ticket-nav"
              aria-label="My bookings"
              onClick={() => {
                if (session) setWalletOpen(true);
                else {
                  pendingAuth.current = "wallet";
                  setAuthOpen(true);
                }
              }}
            >
              <Ticket size={20} />
            </button>
            {session ? (
              <>
                <Button
                  variant="outline"
                  className="account-button"
                  onClick={() => setWalletOpen(true)}
                >
                  {session.user.displayName.split(" ")[0]}
                </Button>
                <button
                  aria-label="Sign out"
                  onClick={() => {
                    setSession(null);
                    writeStorage("nitewide.session", null);
                    setNotice("You’re signed out.");
                  }}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <Button
                className="signin-button"
                onClick={() => setAuthOpen(true)}
              >
                Sign in <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </div>
      </header>
      <main>
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="live-dot" />
              YOUR CITY. AFTER DARK.
            </p>
            <h1>
              Good nights.
              <br />
              Great <span>stories.</span>
            </h1>
            <p className="hero-description">
              The dance floor. The rooftop. Your favorite table.
              <br className="desktop-break" /> Find your people. Make it a
              night.
            </p>
            <div className="hero-tags">
              <span>
                <Ticket size={15} />
                Tickets
              </span>
              <i />
              <span>
                <Wine size={15} />
                VIP tables
              </span>
              <i />
              <span>
                <Users size={15} />
                Guestlists
              </span>
            </div>
            <a className="text-link" href="#discover">
              Find your next night <ArrowDown />
            </a>
          </div>
          <div className="hero-art">
            <img
              className="hero-photo"
              src={photo(0, 1400)}
              alt="Lights over a packed dance floor"
              fetchPriority="high"
            />
            <div className="hero-grain" />
            <span className="hero-stamp">
              LESS SCROLLING.
              <br />
              MORE LIVING.
            </span>
            <div className="hero-feature">
              <Badge variant="outline">ON OUR RADAR</Badge>
              <h2>{featured?.organization?.name || "A little louder."}</h2>
              <p>
                {featured
                  ? `${cityName(featured)} · ${eventDate(featured)}`
                  : "A little later. A night to remember."}
              </p>
              <button
                aria-label={
                  featured
                    ? `Explore ${featured.title}`
                    : "Explore upcoming events"
                }
                onClick={() => (featured ? openEvent(featured) : browse())}
              >
                <ArrowUpRight size={26} />
              </button>
            </div>
            <div className="floating-label">
              <Sparkles size={14} /> MAKE TONIGHT A STORY
            </div>
          </div>
        </section>
        <div className="wrap search-wrap">
          <form
            className="search-bar"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setDate(form.get("date") || "");
              setCity(form.get("city") || "");
              setQuery(form.get("query") || "");
              setView("discover");
              document
                .getElementById("discover")
                .scrollIntoView({ behavior: "smooth" });
            }}
          >
            <label className="search-field">
              <MapPin />
              <span>
                <b>WHERE TO?</b>
                <input
                  aria-label="City"
                  name="city"
                  list="cities"
                  value={city}
                  placeholder={
                    locationState === "finding"
                      ? "Finding your city…"
                      : "All cities"
                  }
                  onChange={(event) => {
                    locationEdited.current = true;
                    setCity(event.target.value);
                  }}
                />
              </span>
            </label>
            <datalist id="cities">
              {[
                ...new Set([
                  "Orlando, FL",
                  "Miami, FL",
                  "Fort Lauderdale, FL",
                  "Tampa, FL",
                  ...events.map(
                    (e) => `${cityName(e)}, ${e.location?.region || ""}`,
                  ),
                ]),
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <label className="search-field date-field">
              <CalendarDays />
              <span>
                <b>WHEN?</b>
                <input
                  aria-label="Event date"
                  name="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </span>
              {date && (
                <button
                  type="button"
                  aria-label="Clear date for all upcoming events"
                  onClick={() => setDate("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <label className="search-field keyword-field">
              <Search />
              <span>
                <b>WHAT’S YOUR VIBE?</b>
                <input
                  aria-label="Search events or venues"
                  name="query"
                  value={query}
                  placeholder="Event, venue, or artist"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </span>
            </label>
            <Button className="search-submit" type="submit">
              Find my night
              <ArrowRight size={19} />
            </Button>
          </form>
          <div className="search-caption">
            <span>
              <LocateFixed size={12} />
              {locationState === "fallback"
                ? "Showing Orlando. Choose any city to explore."
                : "Your plans start here."}
            </span>
            <span>Book on the web. Be there in real life.</span>
          </div>
        </div>
        <section id="discover" className="discovery wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GO WHERE THE NIGHT TAKES YOU</p>
              <h2>
                {view === "saved"
                  ? "Your shortlist."
                  : "Find your kind of night."}
              </h2>
            </div>
            <button
              className="text-link"
              onClick={() => {
                setDate("");
                setQuery("");
                setPriceCap("any");
                setCategory("all");
              }}
            >
              All upcoming <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="filter-row">
            <div className="category-list" aria-label="Experience type">
              {categories.map(([id, Icon, label]) => (
                <Button
                  key={id}
                  variant={category === id ? "default" : "outline"}
                  aria-pressed={category === id}
                  onClick={() => setCategory(id)}
                >
                  <Icon size={16} />
                  {label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              className="filter-button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal size={15} />
              Filters{priceCap !== "any" && <span className="live-dot" />}
            </Button>
          </div>
          {filtersOpen && (
            <div className="expanded-filters">
              <label>
                Sort by
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger aria-label="Sort events">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date: soonest first</SelectItem>
                    <SelectItem value="price">Price: low to high</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label>
                Starting price
                <Select value={priceCap} onValueChange={setPriceCap}>
                  <SelectTrigger aria-label="Maximum starting price">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any price</SelectItem>
                    <SelectItem value="0">Free</SelectItem>
                    <SelectItem value="2500">Up to $25</SelectItem>
                    <SelectItem value="10000">Up to $100</SelectItem>
                    <SelectItem value="40000">Up to $400</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <p>Prices before service fees. Availability may change.</p>
            </div>
          )}
          <div aria-live="polite" className="results-summary">
            {loadState === "ready" && (
              <>
                {results.length}{" "}
                {results.length === 1 ? "experience" : "experiences"}
                {city ? ` in ${city.split(",")[0]}` : ""} ·{" "}
                {date
                  ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "All upcoming dates"}
              </>
            )}
          </div>
          {loadState === "loading" ? (
            <div className="event-grid" aria-label="Loading events">
              {[1, 2, 3].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : loadState === "error" ? (
            <div className="empty-state">
              <Compass />
              <h3>The night’s still out there.</h3>
              <p>
                We couldn’t load events. Check your connection and try again.
              </p>
              <Button onClick={loadEvents}>Try again</Button>
            </div>
          ) : results.length ? (
            <>
              <div className="event-grid">
                {results.slice(0, limit).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    saved={saved.includes(event.id)}
                    onSave={() => save(event)}
                    onOpen={() => openEvent(event)}
                  />
                ))}
              </div>
              {results.length > limit && (
                <Button
                  variant="outline"
                  className="load-more"
                  onClick={() => setLimit(limit + 9)}
                >
                  More nights, more possibilities <Plus size={17} />
                </Button>
              )}
            </>
          ) : (
            <div className="empty-state">
              <Search />
              <h3>
                {view === "saved" && !saved.length
                  ? "Your next night, saved."
                  : "A different date. A new possibility."}
              </h3>
              <p>
                {view === "saved" && !saved.length
                  ? "Tap the heart on any experience to keep it here."
                  : "No experiences match these filters. Try upcoming dates or explore another city."}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setDate("");
                  setQuery("");
                  setCity("");
                  locationEdited.current = true;
                  setCategory("all");
                  setPriceCap("any");
                  setView("discover");
                }}
              >
                Explore all upcoming events <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </section>
        {loadState === "ready" &&
          date &&
          !results.length &&
          upcoming.length > 0 &&
          view === "discover" && (
            <section className="upcoming-preview wrap">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LOOK A LITTLE FURTHER AHEAD</p>
                  <h2>On the horizon.</h2>
                </div>
                <button
                  className="text-link"
                  onClick={() => {
                    setDate("");
                    setQuery("");
                    setCategory("all");
                    setPriceCap("any");
                  }}
                >
                  Explore upcoming <ArrowUpRight size={16} />
                </button>
              </div>
              <p className="results-summary">
                Other upcoming dates in {city.split(",")[0] || "all cities"}
              </p>
              <div className="event-grid">
                {upcoming.slice(0, 3).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    saved={saved.includes(event.id)}
                    onSave={() => save(event)}
                    onOpen={() => openEvent(event)}
                  />
                ))}
              </div>
            </section>
          )}
        <section className="vip-banner wrap">
          <div className="vip-visual">
            <img
              src={photo(2)}
              alt="Atmospheric lights at a night out"
              loading="lazy"
            />
            <span>THE GOOD LIFE, RESERVED.</span>
          </div>
          <div className="vip-copy">
            <p className="eyebrow">
              <Wine size={15} /> A LITTLE EXTRA NEVER HURT
            </p>
            <h2>
              Your people.
              <br />
              Your own space.
            </h2>
            <p>
              Make it a table kind of night. Explore bottle packages and
              reserved spots for the whole crew.
            </p>
            <Button onClick={() => browse("vip")}>
              Find your table <ArrowUpRight size={18} />
            </Button>
            <span className="vip-note">
              Full prices upfront. All payments in full.
            </span>
          </div>
        </section>
        <section className="how-section wrap">
          <div>
            <p className="eyebrow">LESS PLANNING. MORE DANCING.</p>
            <h2>
              From “what’s the plan?”
              <br />
              to “see you there.”
            </h2>
          </div>
          <div className="how-steps">
            {[
              [
                Compass,
                "01",
                "Find your scene",
                "Discover the nights, venues, and people that feel like you.",
              ],
              [
                Ticket,
                "02",
                "Make it official",
                "Choose your ticket or table. Everything in one place.",
              ],
              [
                ArrowUpRight,
                "03",
                "Own the night",
                "Keep your plans close. Make the rest a memory.",
              ],
            ].map(([Icon, num, title, description]) => (
              <div key={num}>
                <span className="step-icon">
                  <Icon size={20} />
                </span>
                <div>
                  <small>{num}</small>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer wrap">
        <div>
          <Brand />
          <p>For nights worth being there.</p>
        </div>
        <div>
          <span>STARTING IN FLORIDA. GOING EVERYWHERE.</span>
          <p>Orlando · Miami · Fort Lauderdale · Tampa</p>
          <small>Event availability varies by city.</small>
        </div>
        <p className="copyright">© {new Date().getFullYear()} Nitewide</p>
      </footer>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !guestBusy) setSelected(null);
        }}
      >
        <DialogContent className="event-modal">
          <DialogHeader>
            <p className="eyebrow">
              {stage === "complete"
                ? "DEMO BOOKING"
                : stage === "checkout"
                  ? "REVIEW YOUR NIGHT"
                  : "YOUR NIGHT STARTS HERE"}
            </p>
            <DialogTitle>
              {stage === "complete"
                ? "Consider the plan made."
                : selected?.title}
            </DialogTitle>
            <DialogDescription>
              {selected &&
                `${eventDate(selected)} · ${eventTime(selected)} · ${cityName(selected)}`}
            </DialogDescription>
          </DialogHeader>
          {selected && stage === "details" && (
            <>
              <div className="detail-art">
                <img src={photo(artIndex(selected))} alt="" />
                <small>Nightlife imagery for inspiration</small>
              </div>
              <p className="detail-description">
                {selected.description ||
                  selected.summary ||
                  "Make room for a memorable night."}
              </p>
              <div className="detail-location">
                <MapPin size={17} />
                <span>
                  {selected.location?.name || "Location shared with attendees"}
                  <small>
                    {selected.location?.privacy === "public"
                      ? selected.location?.addressLine1
                      : "Exact address shared with confirmed attendees"}
                  </small>
                </span>
              </div>
              <Tabs defaultValue="tickets">
                <TabsList className="booking-tabs">
                  <TabsTrigger value="tickets">Tickets & tables</TabsTrigger>
                  <TabsTrigger value="guestlist">Guestlist</TabsTrigger>
                </TabsList>
                <TabsContent value="tickets">
                  <div className="offerings">
                    {selected.offerings?.map((item) => (
                      <button
                        disabled={!availableQuantity(item)}
                        key={item.id}
                        className={`offering ${offeringId === item.id ? "selected" : ""}`}
                        aria-pressed={offeringId === item.id}
                        onClick={() => selectOffering(item.id)}
                      >
                        <span className="radio-indicator">
                          {offeringId === item.id && <span />}
                        </span>
                        <span>
                          <b>{item.name}</b>
                          <small>
                            {item.description ||
                              `Admission for ${item.entriesPerUnit} per ${item.kind}`}
                          </small>
                        </span>
                        <strong>
                          {money(item.priceCents, item.currency)}
                          <small>
                            {availableQuantity(item) ? "+ fees" : "Unavailable"}
                          </small>
                        </strong>
                      </button>
                    ))}
                  </div>
                  {offering && (
                    <>
                      <div className="quantity-row">
                        <span>Quantity</span>
                        <div>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Decrease quantity"
                            disabled={quantity <= (offering.minPerOrder || 1)}
                            onClick={() => setQuantity(quantity - 1)}
                          >
                            <Minus />
                          </Button>
                          <span aria-live="polite">{quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Increase quantity"
                            disabled={quantity >= availableQuantity(offering)}
                            onClick={() => setQuantity(quantity + 1)}
                          >
                            <Plus />
                          </Button>
                        </div>
                      </div>
                      <Button
                        className="primary-action"
                        onClick={checkout}
                        disabled={!availableQuantity(offering)}
                      >
                        Continue · {money(totals.total, offering.currency)}
                        <ArrowRight />
                      </Button>
                    </>
                  )}
                  <p className="demo-note">
                    Demo checkout · No payment will be collected.
                  </p>
                </TabsContent>
                <TabsContent value="guestlist">
                  <div className="guestlist-panel">
                    <Users />
                    <h3>
                      {guestState === "pending"
                        ? "You’re on their radar."
                        : "Get on the guestlist."}
                    </h3>
                    <p>
                      {guestState === "pending"
                        ? "Your request has been sent to the host. Entry is only confirmed after approval."
                        : "Request a spot for yourself. The venue or promoter will review it before confirming your entry."}
                    </p>
                    {guestError && (
                      <p className="error-message" role="alert">
                        {guestError}
                      </p>
                    )}
                    <Button
                      disabled={
                        guestBusy ||
                        guestState === "pending" ||
                        !selected.guestlistCapacity
                      }
                      onClick={requestGuestlist}
                    >
                      {guestBusy ? (
                        <LoaderCircle className="animate-spin" />
                      ) : guestState === "pending" ? (
                        "Awaiting approval"
                      ) : !selected.guestlistCapacity ? (
                        "Guestlist not available"
                      ) : session ? (
                        "Request guestlist approval"
                      ) : (
                        "Sign in to request"
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
          {selected && stage === "checkout" && offering && (
            <div className="checkout-review">
              <Badge variant="outline">DEMO CHECKOUT</Badge>
              <p>
                This is a preview of your booking. No card details, charge, or
                real reservation.
              </p>
              <div className="order-summary">
                <h3>{offering.name}</h3>
                <p>
                  {quantity} × {money(offering.priceCents, offering.currency)}
                </p>
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{money(totals.subtotal, offering.currency)}</dd>
                  </div>
                  <div>
                    <dt>
                      Service fee <small>(8% + $0.89 / order)</small>
                    </dt>
                    <dd>{money(totals.fee, offering.currency)}</dd>
                  </div>
                  <div className="order-total">
                    <dt>Total paid in full</dt>
                    <dd>{money(totals.total, offering.currency)}</dd>
                  </div>
                </dl>
              </div>
              <p className="fine-print">
                Booking as {session?.user.email}. Taxes and any additional
                charges must be finalized before live payments launch.
              </p>
              <Button className="primary-action" onClick={completeDemo}>
                Confirm demo booking <ArrowRight />
              </Button>
              <Button variant="ghost" onClick={() => setStage("details")}>
                Back to tickets & tables
              </Button>
            </div>
          )}
          {stage === "complete" && booking && (
            <div className="confirmation">
              <div className="confirmation-icon">
                <Check size={32} />
              </div>
              <h3>Your demo night is booked.</h3>
              <p>
                {booking.offering} · {booking.quantity}{" "}
                {booking.quantity === 1
                  ? "package / ticket"
                  : "packages / tickets"}
              </p>
              <div className="demo-ticket">
                <Ticket size={30} />
                <b>{booking.id}</b>
                <span>DEMO ONLY · NOT VALID FOR ENTRY</span>
              </div>
              <p>
                No charge was made. This preview is saved in My bookings on this
                device.
              </p>
              <Button
                className="primary-action"
                onClick={() => {
                  setSelected(null);
                  setWalletOpen(true);
                }}
              >
                View my bookings <ArrowRight />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AuthDialog
        open={authOpen}
        onOpenChange={(value) => {
          setAuthOpen(value);
          if (!value) pendingAuth.current = null;
        }}
        onSuccess={authSuccess}
      />
      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent className="wallet-modal">
          <DialogHeader>
            <p className="eyebrow">YOUR PLANS, IN ONE PLACE</p>
            <DialogTitle>My bookings</DialogTitle>
            <DialogDescription>
              Demo bookings saved on this device. These are not admission
              tickets.
            </DialogDescription>
          </DialogHeader>
          {myBookings.length ? (
            myBookings.map((item) => (
              <article className="wallet-booking" key={item.id}>
                <Badge variant="outline">DEMO</Badge>
                <h3>{item.event.title}</h3>
                <p>
                  {eventDate(item.event)} · {item.offering} × {item.quantity}
                </p>
                <div>
                  <span>{item.id}</span>
                  <b>{money(item.total, item.currency)}</b>
                </div>
                <small>Not valid for entry · No payment collected</small>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Ticket />
              <h3>Your calendar has room for a story.</h3>
              <p>Explore an event and try a demo booking.</p>
              <Button
                onClick={() => {
                  setWalletOpen(false);
                  browse();
                }}
              >
                Discover events
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {notice && (
        <div className="toast-message" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </>
  );
}
function ArrowDown() {
  return <ArrowRight size={16} style={{ transform: "rotate(90deg)" }} />;
}
