import { useTranslation } from 'react-i18next';

import i18n, {
  LANG_OVERRIDE_KEY,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../i18n';
import { apiPatch } from '../api/client';
import { errorDetail } from '../api/errors';
import queryClient from '../queryClient';
import { pushToast } from '../toasts';

/**
 * EN/LV toggle rendered inside the burger menu (inline on desktop,
 * in the dropdown on mobile). Switching applies instantly
 * (i18n.changeLanguage + a lang_override localStorage key so a
 * reload keeps it) and PATCHes /api/me/ so the stored per-user pref
 * — and job-rendered notifications — follow. All queries are
 * invalidated because some responses still carry server-rendered
 * labels (choice lists, period labels).
 */
export function LanguageSwitcher() {
  const { t } = useTranslation();
  const current: Language = i18n.language?.startsWith('lv')
    ? 'lv'
    : 'en';

  const switchTo = (language: Language) => {
    if (language === current) return;
    localStorage.setItem(LANG_OVERRIDE_KEY, language);
    void i18n.changeLanguage(language);
    void queryClient.invalidateQueries();
    apiPatch('/api/me/', { language }).catch((error) =>
      pushToast(errorDetail(error)),
    );
  };

  return (
    <div
      className="btn-group btn-group-sm"
      role="group"
      aria-label={t('language.label')}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          className={`btn btn-sm ${
            language === current ? 'btn-light' : 'btn-outline-light'
          }`}
          aria-pressed={language === current}
          onClick={() => switchTo(language)}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
