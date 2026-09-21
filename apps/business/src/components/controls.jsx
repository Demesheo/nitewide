import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
export function Choice({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  className = "",
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, title]) => (
          <SelectItem value={v} key={v}>
            {title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Field({ label, id, ...props }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <Input id={id} {...props} />
    </label>
  );
}
export function SelectField({ label, id, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Choice id={id} label={label} {...props} />
    </div>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
