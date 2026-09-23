import { LoaderCircle } from 'lucide-react';

export function LoadingState({ children, className = '' }) {
  return <div className={`nw-loading-state ${className}`.trim()} role="status" aria-live="polite">
    <LoaderCircle size={17} className="nw-loading-icon" aria-hidden="true" />
    <span>{children}</span>
  </div>;
}
