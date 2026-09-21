const photos = [
  "photo-1470229722913-7c0e2dbbafd3",
  "photo-1514525253161-7a46d19cd819",
  "photo-1516450360452-9312f5e86fc7",
  "photo-1506157786151-b8491531f063",
  "photo-1492684223066-81342ee5ff30",
  "photo-1501386761578-eac5c94b800a",
];
export const photo = (index, width = 900) =>
  `https://images.unsplash.com/${photos[Math.abs(index) % photos.length]}?auto=format&fit=crop&w=${width}&q=85`;
export const artIndex = (event) =>
  [...(event.organization?.name || event.title)].reduce(
    (n, char) => n + char.charCodeAt(0),
    0,
  );
export const eventDate = (event) =>
  new Date(event.startsAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: event.location?.timezone,
  });
export const eventTime = (event) =>
  new Date(event.startsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.location?.timezone,
  });
