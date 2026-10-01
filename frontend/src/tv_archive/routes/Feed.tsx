import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchContents, type ContentsParams } from '../api';
import { errorDetail } from '../../shared/api/errors';
import FilterBar, {
  FILTER_FIELDS,
  type FilterValues,
} from '../components/FilterBar';
import ContentCard from '../components/ContentCard';
import Pagination from '../../shared/components/Pagination';

/**
 * Content feed — the React port of content_list.html (Stage 2 of
 * the rewrite plan). All filter state lives in the query string
 * with the template's exact param names, so a copied
 * `/tv-arhivs?…` URL works verbatim in the SPA and filtered views
 * stay shareable/bookmarkable.
 *
 * The template page has no navbar, so the shared <NavBar> is
 * deliberately not used — a slim header with a link back to the
 * Django home page suffices (and bootstrap.user is '' for the
 * anonymous visitors this public page serves).
 */
export default function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Every filter field + `page` straight from the URL — the query
  // key and fetcher both read this, so editing the URL (or a
  // copied template-page link) drives the request directly.
  const params: ContentsParams = {};
  const filterValues: FilterValues = {};
  for (const field of FILTER_FIELDS) {
    const value = searchParams.get(field);
    if (value) {
      params[field] = value;
      filterValues[field] = value;
    }
  }
  const page = searchParams.get('page');
  if (page) params.page = page;

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['tv_archive', 'contents', params],
    queryFn: () => fetchContents(params),
  });

  // The form covers the entire filter state, so applying it
  // replaces the query string outright — empty fields are omitted
  // and `page` resets to 1 (the template's GET form never carried
  // page either).
  const applyFilters = (values: FilterValues) => {
    const next = new URLSearchParams();
    for (const field of FILTER_FIELDS) {
      const value = values[field];
      if (value) next.set(field, value);
    }
    setSearchParams(next);
  };

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };

  return (
    <div className="feed-container">
      <header className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">TV Archive</h1>
        {/* Plain anchor: leaves the SPA for Django's home page. */}
        <a href="/">← Home</a>
      </header>

      {/* Remount on URL change so the uncontrolled form's
          defaultValues always reflect the active params. */}
      <FilterBar
        key={searchParams.toString()}
        values={filterValues}
        channels={data?.channels ?? []}
        contentRatings={data?.content_ratings ?? []}
        types={data?.types ?? []}
        onApply={applyFilters}
      />

      {isPending && (
        <p aria-busy="true" aria-label="Loading content">
          Loading…
        </p>
      )}
      {isError && (
        <div className="alert alert-danger" role="alert">
          Couldn&apos;t load content: {errorDetail(error)}{' '}
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          {data.contents.length === 0 ? (
            <p>No content available</p>
          ) : (
            data.contents.map((content) => (
              <ContentCard key={content.id} content={content} />
            ))
          )}
          <Pagination
            page={data.page}
            numPages={data.num_pages}
            count={data.count}
            hasNext={data.page < data.num_pages}
            hasPrevious={data.page > 1}
            itemLabel="items"
            navLabel="Content pages"
            onPage={goToPage}
          />
        </>
      )}
    </div>
  );
}
