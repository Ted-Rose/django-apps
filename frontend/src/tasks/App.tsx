interface Bootstrap {
  user?: string;
}

function readBootstrap(): Bootstrap {
  const el = document.getElementById('spa-bootstrap');
  if (!el || !el.textContent) return {};
  return JSON.parse(el.textContent) as Bootstrap;
}

export default function App() {
  const bootstrap = readBootstrap();
  return (
    <div className="container py-4">
      <h1 className="mb-3">Tasks — React shell</h1>
      <p>
        Signed in as <strong>{bootstrap.user ?? 'unknown'}</strong>.
      </p>
      <p className="text-muted">
        This page is rendered by React via Vite + django-vite
        (strangler mount at <code>/tasks/app/</code>). The template UI
        still lives at <a href="/tasks/">/tasks/</a>.
      </p>
    </div>
  );
}
