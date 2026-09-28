'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap narrow" style={{ paddingTop: '4rem', minHeight: '50vh' }}>
      <div className="kicker">Something went wrong</div>
      <h1>This page could not be shown</h1>
      <p className="muted">Nothing was changed. The error has been logged{error.digest ? <> with reference <code>{error.digest}</code></> : null}; details never include your code.</p>
      <p className="row">
        <button className="btn primary" type="button" onClick={() => reset()}>Try again</button>
        <a className="btn" href="/">Home</a>
      </p>
    </main>
  );
}
