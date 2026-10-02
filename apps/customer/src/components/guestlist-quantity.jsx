import { Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';
import './guestlist-quantity.css';

export function GuestlistQuantity({ id, label, value, max, onChange, disabled = false, decreaseLabel = 'Decrease guestlist spots', increaseLabel = 'Increase guestlist spots', describedBy }) {
  const invalid = !Number.isInteger(value) || value < 1 || value > max;
  return <div className="guestlist-quantity-field">
    <label htmlFor={id}>{label}</label>
    <div className="guestlist-quantity-controls" role="group" aria-label={label}>
      <Button type="button" variant="outline" aria-label={decreaseLabel} aria-controls={id} disabled={disabled || value <= 1} onClick={() => { if (!disabled && value > 1) onChange(value - 1); }}><Minus aria-hidden="true" /></Button>
      <input id={id} type="text" role="spinbutton" inputMode="numeric" readOnly aria-readonly="true" aria-valuemin={1} aria-valuemax={max} aria-valuenow={value} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={value} disabled={disabled} />
      <Button type="button" variant="outline" aria-label={increaseLabel} aria-controls={id} disabled={disabled || value >= max} onClick={() => { if (!disabled && value < max) onChange(value + 1); }}><Plus aria-hidden="true" /></Button>
    </div>
  </div>;
}
