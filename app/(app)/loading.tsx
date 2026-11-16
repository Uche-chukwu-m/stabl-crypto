// Placeholders while a screen loads, in the rough shape of what is coming.
export default function Loading() {
  return (
    <div className="space-y-4 pt-[env(safe-area-inset-top)]" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-9 w-40" />
      <div className="skeleton h-44 rounded-[1.25rem]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-24 rounded-[1.25rem]" />
        <div className="skeleton h-24 rounded-[1.25rem]" />
      </div>
      <div className="skeleton h-56 rounded-[1.25rem]" />
    </div>
  );
}
