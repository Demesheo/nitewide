import { Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';
import './guestlist-approval-quantity.css';

export function GuestlistApprovalQuantity({ value, onChange, disabled = false }) {
  function change(next) {
    if (!disabled) onChange(Math.min(20, Math.max(1, next)));
  }

  function onKeyDown(event) {
    const next = { ArrowUp: value + 1, ArrowDown: value - 1, Home: 1, End: 20 }[event.key];
    if (next == null) return;
    event.preventDefault();
    change(next);
  }

  return <div className="guestlist-approval-quantity" role="group" aria-label="Approved spots controls">
    <Button type="button" variant="outline" className="guestlist-approval-quantity-button" aria-label="Decrease approved spots" disabled={disabled || value <= 1} onClick={() => change(value - 1)}><Minus aria-hidden="true"/></Button>
    <span className="guestlist-approval-quantity-value" role="spinbutton" aria-label="Approved spots" aria-valuemin={1} aria-valuemax={20} aria-valuenow={value} aria-valuetext={`${value} ${value === 1 ? 'spot' : 'spots'}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onKeyDown={onKeyDown}>{value}</span>
    <Button type="button" variant="outline" className="guestlist-approval-quantity-button" aria-label="Increase approved spots" disabled={disabled || value >= 20} onClick={() => change(value + 1)}><Plus aria-hidden="true"/></Button>
  </div>;
}
