/* eslint-disable i18next/no-literal-string -- Latvian-only toy page,
   no catalogs (see docs/plans/SINGLE_PAGES_REACT_REWRITE.md). */
import { useQuery } from '@tanstack/react-query';
import { errorText, fetchSpoki } from '../api';

/**
 * Random spoki.lv article via GET /api/single_pages/spoki/. A fresh
 * query on every mount matches the template's per-load random pick;
 * "Cits raksts" refetches for another one.
 */
export default function Spoki() {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['single_pages', 'spoki'],
    queryFn: fetchSpoki,
  });

  return (
    <div className="container py-4">
      <a href="/">← home</a>
      <div className="d-flex align-items-center justify-content-between mt-3 mb-3">
        <h1 className="mb-0">{data?.title || 'Spoki'}</h1>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Ielādē…' : 'Cits raksts'}
        </button>
      </div>
      {isPending && <p>Ielādē…</p>}
      {isError && (
        <div className="alert alert-danger" role="alert">
          {errorText(error)}
        </div>
      )}
      {data && (
        <>
          {/* Safe only because the server ran nh3.clean — never
              render raw upstream HTML here. */}
          <div
            className="border rounded p-3 bg-white"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
          <p className="mt-3 text-muted">
            Avots:{' '}
            <a href={data.source_url} rel="noopener noreferrer">
              {data.source_url}
            </a>
          </p>
        </>
      )}
    </div>
  );
}
