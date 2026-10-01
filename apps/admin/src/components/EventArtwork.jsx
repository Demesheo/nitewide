import { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import { mediaSrc } from '../../../business/src/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../business/src/components/ui/dialog';

export default function EventArtwork({ event }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const thumbnail = useRef(null);
  useEffect(() => { setFailed(false); setOpen(false); }, [event.imageUrl]);
  const failedImage = () => { setFailed(true); setOpen(false); };
  const source = event.imageUrl ? mediaSrc(event.imageUrl) : null;
  return <><figure className="record-event-artwork">{source && !failed ? <button ref={thumbnail} type="button" className="flyer-thumbnail-button" aria-label="View event flyer" onClick={() => setOpen(true)}><img src={source} alt={`${event.title} event flyer`} onError={failedImage}/></button> : <div className="artwork-empty"><Image size={28} aria-hidden="true"/><span>{failed ? 'Event flyer is unavailable.' : 'No event flyer has been added.'}</span></div>}<figcaption>Event flyer</figcaption></figure>
    {source && !failed && <Dialog open={open} onOpenChange={setOpen}><DialogContent className="event-flyer-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); thumbnail.current?.focus(); }}><DialogHeader><DialogTitle>Event flyer</DialogTitle><DialogDescription>{event.title}</DialogDescription></DialogHeader><img className="event-flyer-full-image" src={source} alt={`${event.title} event flyer`} onError={failedImage}/></DialogContent></Dialog>}
  </>;
}
