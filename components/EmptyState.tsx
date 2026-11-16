// Nothing here yet: the pulse line, drawn in, and one short line.
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <svg viewBox="0 0 100 60" className="h-14 w-24 text-accent" aria-hidden="true">
        <polyline
          points="4,32 26,32 36,12 48,50 58,24 66,34 96,32"
          pathLength={1}
          className="draw-line"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="mt-3 text-muted">{text}</p>
    </div>
  );
}
