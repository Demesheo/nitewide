import { forwardRef } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import './clipboard-copy.css';

// Presentation is shared; callers must supply already prepared text to their
// click handler. Keep the real button in place for focus, layout and gestures.
export const CopyLinkButton = forwardRef(function CopyLinkButton({ component: Button, copied = false, copying = false, label = 'Copy link', copiedLabel = 'Link copied', loadingLabel = 'Copying…', className = '', ...props }, ref) {
  const Icon = copied ? Check : Copy;
  return <Tooltip.Provider delayDuration={250}><Tooltip.Root><Tooltip.Trigger asChild>
    <Button ref={ref} type="button" variant="outline" {...props} className={`nw-copy-link-button ${className}`} data-copied={copied || undefined} aria-busy={copying || props['aria-busy']}>
      <span key={copied ? 'copied' : 'copy'} className="nw-copy-icon"><Icon size={16} aria-hidden="true"/></span>
      <span>{copying ? loadingLabel : copied ? copiedLabel : label}</span>
    </Button>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="nw-copy-tooltip" sideOffset={6}>{copied ? 'Link copied' : 'Copy link'}<Tooltip.Arrow className="nw-copy-tooltip-arrow"/></Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
});
