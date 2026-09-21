import { Heart, MapPin, ArrowUpRight } from "lucide-react";
import { Badge } from "./ui/badge";
import { availableQuantity, cityName, money } from "../lib/discovery";
import { eventDate, eventTime } from "../lib/presentation";
import { EventArtwork } from "./event-artwork";
export function EventCard({ event, saved, onSave, onOpen }) {
  const offerings =
    event.offerings?.filter((o) => availableQuantity(o) > 0) || [];
  const lowest = offerings.length
    ? Math.min(...offerings.map((o) => o.priceCents))
    : null;
  return (
    <article className="event-card">
      <div className="card-image">
        <div className="image-link">
          <EventArtwork event={event} loading="lazy" />
        </div>
      </div>
      <div className="card-copy">
        <div className="card-meta">
          <Badge className="card-category">
            {event.category === "nightlife"
              ? "AFTER DARK"
              : (event.category || 'experience').replaceAll("_", " ").toUpperCase()}
          </Badge>
          <button
            className={`save-button ${saved ? "saved" : ""}`}
            aria-label={`${saved ? "Unsave" : "Save"} ${event.title}`}
            aria-pressed={saved}
            onClick={onSave}
          >
            <Heart size={17} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="card-date">
          <time dateTime={event.startsAt}>{eventDate(event)} <span>· {eventTime(event)}</span></time>
        </p>
        <p className="venue-name">
          {event.organization?.name || "Independent experience"}
        </p>
        <h3 className="card-title">
          <button
            className="card-open"
            onClick={onOpen}
            aria-label={`Explore ${event.title}`}
          >
            <span className="card-title-text">{event.title}</span>
          </button>
        </h3>
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
          <span className="card-arrow" aria-hidden="true">
            <ArrowUpRight size={21} />
          </span>
        </div>
      </div>
    </article>
  );
}
