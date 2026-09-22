// Read public, source-linked event pages only. Outputs reviewed-source material;
// never inserts events, authenticates, or extrapolates recurrence dates.
async function readEvent(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const html = await response.text();
  const text = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/g)].map(m => JSON.parse(m[1])[1] || '').join('');
  const start = text.indexOf('{\n  "@context"');
  if (start < 0) throw new Error(`Missing event structured data: ${url}`);
  let depth = 0, quoted = false, escaped = false, end = start;
  for (; end < text.length; end++) {
    const c = text[end];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quoted) { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted) { if (c === '{') depth++; if (c === '}' && --depth === 0) break; }
  }
  const event = JSON.parse(text.slice(start, end + 1));
  return { url, title: event.name, startsAt: event.startDate, endsAt: event.endDate,
    venue: event.location, imageUrl: event.image?.[0]?.match(/https:\/\/images\.posh\.vip\/originals\/[a-f0-9]{24}/)?.[0],
    description: event.description, links: [...new Set(text.match(/\/e\/[a-z0-9-]+/g) || [])] };
}
async function main() {
  const urls = process.argv.slice(2);
  if (urls.some(url => !/^https:\/\/posh\.vip\/e\/[a-z0-9-]+$/.test(url))) throw new Error('Expected public Posh event URLs');
  for (let i = 0; i < urls.length; i += 4) {
    for (const event of await Promise.all(urls.slice(i, i + 4).map(readEvent))) console.log(JSON.stringify(event));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { readEvent };
