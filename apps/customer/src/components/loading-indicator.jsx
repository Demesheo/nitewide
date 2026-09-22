import { LoaderCircle } from 'lucide-react';
export function LoadingIndicator({ children = 'Loading…' }) {
  return <span className="loading-indicator" role="status"><LoaderCircle aria-hidden="true" className="loading-spinner" size={18} /><span>{children}</span></span>;
}
