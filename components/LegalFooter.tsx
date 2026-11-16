import Link from "next/link";

// Required on every page.
export function LegalFooter() {
  return (
    <footer className="border-t border-rule px-4 py-5 text-center text-caption text-muted">
      <p>Stabl is not a bank.</p>
      <p className="mt-1">
        <Link href="/privacy" className="underline decoration-rule underline-offset-4 hover:decoration-current">
          Privacy
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/terms" className="underline decoration-rule underline-offset-4 hover:decoration-current">
          Terms
        </Link>
      </p>
    </footer>
  );
}
