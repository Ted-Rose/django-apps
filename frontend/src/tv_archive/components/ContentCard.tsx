import { useState } from 'react';
import type { ContentOut } from '../api';

/**
 * One feed card — a React port of content_list.html's card block
 * (image + LV title/description + Rating / Channel / Start Date /
 * Ratio metadata row).
 *
 * Nullability parity with the template's `|default`/`floatformat`
 * behavior: `image` falls back to a local CSS placeholder (the
 * rewrite deliberately drops the via.placeholder.com third-party
 * dependency — the div also swaps in on <img> load errors),
 * `description_lv` is omitted when empty, and null
 * `rating_value`/`start_date`/`ratio` render as an em dash.
 */
export function ContentCard({ content }: { content: ContentOut }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(content.image) && !imageFailed;

  return (
    <div className="feed-card">
      {showImage ? (
        <img
          src={content.image ?? undefined}
          alt={content.title_eng}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="feed-image-placeholder" aria-hidden="true">
          No image
        </div>
      )}
      <div className="feed-content">
        <div className="feed-title">{content.title_lv}</div>
        {content.description_lv && (
          <div className="feed-description">{content.description_lv}</div>
        )}
        <div className="feed-metadata">
          <span>Rating: {content.rating_value ?? '—'}</span> |{' '}
          <span>Channel: {content.channel}</span> |{' '}
          <span>Start Date: {content.start_date ?? '—'}</span> |{' '}
          <span>
            Ratio: {content.ratio != null ? content.ratio.toFixed(2) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default ContentCard;
