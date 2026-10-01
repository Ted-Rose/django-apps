import { useQuery } from '@tanstack/react-query';
import { fetchContents, type ContentOut } from '../api';
import { errorDetail } from '../../shared/api/errors';

/**
 * Content feed — Stage 1 skeleton that already exercises the
 * anonymous end-to-end path (public shell → GET
 * /api/tv-arhivs/contents/ with auth=None). Stage 2 builds the real
 * feed: FilterBar driven by useSearchParams, ContentCard feed and
 * pagination.
 *
 * The template page has no navbar, so the shared <NavBar> is
 * deliberately not used — a slim header with a link back to the
 * Django home page suffices (and bootstrap.user is '' for the
 * anonymous visitors this page serves).
 */
export default function Feed() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['tv_archive', 'contents'],
    queryFn: () => fetchContents(),
  });

  return (
    <div className="feed-container">
      <header className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">TV Archive</h1>
        {/* Plain anchor: leaves the SPA for Django's home page. */}
        <a href="/">← Home</a>
      </header>

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
          <p className="feed-metadata">
            {data.count} item{data.count === 1 ? '' : 's'} — page {data.page} of{' '}
            {data.num_pages}
          </p>
          {data.contents.length === 0 ? (
            <p>No content available</p>
          ) : (
            data.contents
              .slice(0, 10)
              .map((content) => <FeedCard key={content.id} content={content} />)
          )}
        </>
      )}
    </div>
  );
}

/** Minimal card — Stage 2 replaces it with the full ContentCard. */
function FeedCard({ content }: { content: ContentOut }) {
  return (
    <div className="feed-card">
      <div className="feed-content">
        <div className="feed-title">{content.title_lv}</div>
        <div className="feed-metadata">
          <span>Channel: {content.channel}</span>
          {content.start_date && (
            <span> | Start Date: {content.start_date}</span>
          )}
          {content.rating_value != null && (
            <span> | Rating: {content.rating_value}</span>
          )}
        </div>
      </div>
    </div>
  );
}
