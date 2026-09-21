import { Heart, MapPin, ArrowUpRight } from "lucide-react";
import { Badge } from "./ui/badge";
import { availableQuantity, cityName, money } from "../lib/discovery";
import { photo, artIndex, eventDate, eventTime } from "../lib/presentation";
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
          <img src={photo(artIndex(event), 720)} alt="" loading="lazy" />
        </div>
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
        <h3 className="card-title">
          <button
            className="card-open"
            onClick={onOpen}
            aria-label={`Explore ${event.title}`}
          >
            {event.title}
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
