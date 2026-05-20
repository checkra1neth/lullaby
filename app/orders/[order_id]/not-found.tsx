/**
 * Custom 404 surface for `/orders/[order_id]` (Task 9, Req 13.6).
 *
 * Rendered when the page-level server component calls `notFound()` because
 * the route parameter either is not a UUID or doesn't match an `orders`
 * row. The body is intentionally generic — we don't disclose whether an
 * id "doesn't exist" vs. "isn't yours" — and contains no PII.
 */
import Link from "next/link";

export default function OrderNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Order not found
      </h1>
      <p className="text-foreground/70">
        We couldn&rsquo;t find that order. Double-check the link from your
        confirmation email, or start a new lullaby.
      </p>
      <Link
        href="/create"
        className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-semibold text-background"
      >
        Make a new lullaby
      </Link>
    </main>
  );
}
