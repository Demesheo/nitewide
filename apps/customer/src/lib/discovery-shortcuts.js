function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function discoveryShortcutRange(value, now = new Date()) {
  if (!['tonight', 'tomorrow', 'weekend'].includes(value)) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (value === 'tomorrow') start.setDate(start.getDate() + 1);
  if (value === 'weekend') {
    const day = start.getDay();
    if (day === 0) start.setDate(start.getDate() - 1);
    else if (day < 5) start.setDate(start.getDate() + (5 - day));
  }
  const end = new Date(start);
  if (value === 'weekend') end.setDate(end.getDate() + (7 - start.getDay()) % 7);
  return { start: dateKey(start), end: dateKey(end) };
}
