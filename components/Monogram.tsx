import { PulseMark } from "./Logo";

const TINTS = [
  ["#1F5138", "#E3EDE6"],
  ["#8A5A3B", "#F3E8DF"],
  ["#3F6E8A", "#E2ECF2"],
  ["#5B6B3A", "#E9EDDC"],
  ["#7A6A2E", "#F1ECD9"],
  ["#2E6E6A", "#DFEEEC"],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function initials(name: string) {
  const words = name.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "?";
}

// A merchant's initials on a soft tile, the same colors every time for the same
// name. Stabl's own moves get the pulse mark.
export function Monogram({ name, vault = false, size = "md" }: { name: string; vault?: boolean; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-12 text-[0.9375rem]" : "size-10 text-[0.8125rem]";
  if (vault) return <PulseMark className={`${size === "lg" ? "size-12" : "size-10"} shrink-0 rounded-[0.75rem]`} />;
  const [fg, bg] = TINTS[hash(name) % TINTS.length];
  return (
    <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-[0.75rem] font-bold`} style={{ color: fg, background: bg }}>
      {initials(name)}
    </span>
  );
}
