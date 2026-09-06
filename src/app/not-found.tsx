import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-surface p-space-8">
      <div className="text-center max-w-md">
        <p className="text-label-md uppercase tracking-wider text-outline font-semibold">Error 404</p>
        <h1 className="text-headline-xl text-on-surface font-bold mt-space-2">Page not found</h1>
        <p className="text-body-md text-on-surface-variant mt-space-3">
          The page you are looking for does not exist, or you do not have access to it.
        </p>
        <Link
          href="/"
          className="inline-flex items-center mt-space-6 px-space-4 py-2.5 rounded-xl bg-primary text-on-primary text-body-sm font-semibold"
        >
          Return to your dashboard
        </Link>
      </div>
    </main>
  );
}
