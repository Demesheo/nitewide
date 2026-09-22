import { useState } from "react";
import { eventArtworkState } from "../lib/presentation";
import { curatedVenue } from '../lib/venue-artwork';
import { eventVenueName } from '../lib/event-venue';
export function EventArtwork({ event, className = '', ...props }) {
  const [failedSources, setFailedSources] = useState([]);
  const { src, kind } = eventArtworkState(event, import.meta.env.VITE_API_URL, failedSources);
  const venue = kind === 'photo' ? curatedVenue(event) : null;
  return (
    <span className={`event-artwork artwork-${kind} ${className}`}>
      {src ? (
        <img
          {...props}
          className={kind === 'flyer' ? 'uploaded-artwork' : kind === 'photo' ? 'venue-photo' : 'illustrative-artwork'}
          src={src}
          alt={kind === 'flyer' ? `${event.title} event flyer` : kind === 'photo' ? `Nightlife at ${eventVenueName(event, venue.names[0])}` : ''}
          decoding="async"
          onError={() => setFailedSources(previous => previous.includes(src) ? previous : [...previous, src])}
        />
      ) : <span className="artwork-monogram" aria-hidden="true">n.</span>}
      {kind !== 'flyer' && <span className="artwork-caption">{kind === 'placeholder' ? 'Artwork coming soon' : kind === 'photo' ? `Photo: @${venue.photoCredit}` : 'Nitewide mood artwork'}</span>}
    </span>
  );
}
