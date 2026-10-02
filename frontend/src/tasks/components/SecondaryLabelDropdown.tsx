import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../shared/components/Dropdown';
import type { LabelOut } from '../api';

/**
 * The navbar's client-side "Filter by Label" dropdown (filters.js
 * selectSecondaryLabel): it only rewrites the `secondary_label`
 * search param — no API request — so every dashboard-shaped and
 * secondary page can share it. Setting `replace` keeps history
 * clean exactly like the DOM-only filter did.
 */
interface SecondaryLabelDropdownProps {
  labels: LabelOut[];
  secondaryLabel: string;
  /** Toggle padding — navbar.html uses '0.15rem 0.4rem'. */
  buttonStyle?: React.CSSProperties;
}

function activeClass(active: boolean): string {
  return `dropdown-item${active ? ' active' : ''}`;
}

export function SecondaryLabelDropdown({
  labels,
  secondaryLabel,
  buttonStyle = { padding: '0.15rem 0.4rem' },
}: SecondaryLabelDropdownProps) {
  const { t } = useTranslation('tasks');
  const [searchParams, setSearchParams] = useSearchParams();

  const select = (labelName: string) => {
    const params = new URLSearchParams(searchParams);
    if (labelName) {
      params.set('secondary_label', labelName);
    } else {
      params.delete('secondary_label');
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <Dropdown
      label={
        <>
          <i className="bi bi-funnel" /> {secondaryLabel || t('labels.all')}
        </>
      }
      buttonStyle={buttonStyle}
    >
      <li>
        <a
          className={activeClass(!secondaryLabel)}
          href="#"
          onClick={(event) => {
            event.preventDefault();
            select('');
          }}
        >
          <i className="bi bi-funnel" /> {t('labels.allLabels')}
        </a>
      </li>
      {labels.length > 0 && (
        <>
          <li>
            <hr className="dropdown-divider" />
          </li>
          <li>
            <h6 className="dropdown-header">{t('labels.filterByLabel')}</h6>
          </li>
          {labels.map((label) => (
            <li key={label.id}>
              <a
                className={activeClass(secondaryLabel === label.name)}
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  select(label.name);
                }}
              >
                <span
                  className="badge"
                  style={{ backgroundColor: label.color }}
                >
                  {label.name}
                </span>
                {label.task_count != null && label.task_count > 0 && (
                  <span className="badge bg-secondary ms-1">
                    {label.task_count}
                  </span>
                )}
              </a>
            </li>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export default SecondaryLabelDropdown;
