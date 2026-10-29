import { Navigate, useParams } from 'react-router-dom';

/**
 * `/category/:id` is the deep-linkable category URL — it redirects
 * onto `/?category=<id>` so the query param stays the single filter
 * representation (like the tasks dashboard's ?list=).
 */
export default function CategoryRedirect() {
  const { id = '' } = useParams();
  const target = /^\d+$/.test(id)
    ? `/?category=${encodeURIComponent(id)}`
    : '/';
  return <Navigate to={target} replace />;
}
