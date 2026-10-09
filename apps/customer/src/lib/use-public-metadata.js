import { useEffect } from 'react';
import { publicMetadata } from '../../../shared/public-metadata.mjs';

// Development builds default to noindex. A production document grants indexing
// only when its server-side route and access checks allowed it. Private initial
// documents never upgrade themselves to indexable through client navigation.
const initiallyIndexable = typeof document !== 'undefined' && document.querySelector('meta[name="robots"]')?.content === 'index, follow';
export function usePublicMetadata({ event, view, preview, rundownId, rundown }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const publicParams = new Set(['event', 'rundown', 'ref', 'tab', 'city', 'date', 'q', 'scope', 'sort', 'when', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
    const privateView = view !== 'discover' || Boolean(preview) || [...params.keys()].some(key => !publicParams.has(key));
    const filtered = ['city', 'date', 'q', 'scope', 'sort', 'when'].some(key => params.has(key));
    const kind = privateView ? 'private' : event ? 'event' : rundownId ? rundown?.profile ? 'rundown' : 'unavailable' : 'home';
    const origin = window.location.origin;
    const indexable = initiallyIndexable && !privateView && (event ? event.isDiscoverable !== false && new Date(event.endsAt) > new Date()
      : rundownId ? Boolean(rundown?.profile && rundown.loadState === 'ready') : !filtered);
    const metadata = publicMetadata({ origin, kind, event, id: rundownId, profile: rundown?.profile, items: rundown?.items, indexable });
    document.title = metadata.title;
    for (const node of document.head.querySelectorAll('meta[name="description"], meta[name="robots"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], #nitewide-public-jsonld')) node.remove();
    const meta = (attribute, key, value) => { const node = document.createElement('meta'); node.setAttribute(attribute, key); node.content = value; document.head.append(node); };
    meta('name', 'description', metadata.description); meta('name', 'robots', metadata.robots);
    meta('property', 'og:type', 'website'); meta('property', 'og:site_name', 'Nitewide');
    for (const [key, value] of Object.entries({ title: metadata.title, description: metadata.description, image: metadata.image })) {
      meta('property', `og:${key}`, value); meta('name', `twitter:${key}`, value);
    }
    meta('name', 'twitter:card', 'summary_large_image');
    if (metadata.canonical) {
      const link = document.createElement('link'); link.rel = 'canonical'; link.href = metadata.canonical; document.head.append(link);
      meta('property', 'og:url', metadata.canonical);
    }
    if (metadata.structured.length) {
      const node = document.createElement('script'); node.type = 'application/ld+json'; node.id = 'nitewide-public-jsonld';
      node.textContent = JSON.stringify(metadata.structured); document.head.append(node);
    }
  }, [event, view, preview, rundownId, rundown]);
}
