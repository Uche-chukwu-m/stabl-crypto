import { addDays } from "@/engine/dates";
import { formatCents, formatDay } from "@/lib/format";
import type { FeedItem } from "@/lib/views";
import { EmptyState } from "./EmptyState";
import { Monogram } from "./Monogram";

function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date, { weekday: true });
}

// A bank style activity list, grouped by day.
export function FeedList({ items, today, grouped = true }: { items: FeedItem[]; today: string; grouped?: boolean }) {
  if (items.length === 0) return <EmptyState text="Nothing here yet" />;
  const groups: { day: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (grouped && last?.day === item.date) last.items.push(item);
    else if (grouped || !last) groups.push({ day: item.date, items: [item] });
    else last.items.push(item);
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.day + g.items[0].id}>
          {grouped && <h3 className="label mb-1 px-1">{dayLabel(g.day, today)}</h3>}
          <ul>
            {g.items.map((i) => (
              <FeedRow key={i.id} item={i} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const amount =
    item.tone === "in" || item.tone === "vault_out"
      ? { text: `+${formatCents(item.amountCents)}`, cls: "text-accent" }
      : item.tone === "out"
        ? { text: `−${formatCents(Math.abs(item.amountCents))}`, cls: "" }
        : { text: formatCents(item.amountCents), cls: item.tone === "pending" ? "text-muted" : "" };
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Monogram name={item.title} vault={item.vault} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{item.title}</span>
        <span className="block truncate text-caption text-muted">{item.subtitle}</span>
      </span>
      <span className={`figure whitespace-nowrap text-[1.0625rem] ${amount.cls}`}>{amount.text}</span>
    </li>
  );
}
