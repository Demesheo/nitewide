import { Check, Circle } from 'lucide-react';
import './password-requirements.css';

const requirements = [
  ['8–128 characters', value => value.length >= 8 && value.length <= 128],
  ['One uppercase letter', value => /[A-Z]/.test(value)],
  ['One lowercase letter', value => /[a-z]/.test(value)],
  ['One number', value => /[0-9]/.test(value)],
];

export function passwordRequirementError(value) {
  const missing = requirements.filter(([, check]) => !check(value)).map(([label]) => label.toLowerCase());
  return missing.length ? `Your password needs ${missing.join(', ')}.` : '';
}

export function PasswordRequirements({ id, password }) {
  return <div id={id} className="password-requirements">
    <p>Password requirements</p>
    <ul aria-label="Password requirements">
      {requirements.map(([label, check]) => {
        const met = check(password);
        const Icon = met ? Check : Circle;
        return <li key={label} data-met={met}><Icon size={14} aria-hidden="true" /><span>{label}<span className="password-requirement-status"> — {met ? 'met' : 'not met'}</span></span></li>;
      })}
    </ul>
  </div>;
}
