import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';

import { LANG_OVERRIDE_KEY } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';

vi.mock('../api/client', () => ({
  apiPatch: vi.fn(() => Promise.resolve({})),
}));
import { apiPatch } from '../api/client';

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.removeItem(LANG_OVERRIDE_KEY);
    await i18n.changeLanguage('en');
    vi.mocked(apiPatch).mockClear();
  });

  it('marks the active language and PATCHes /api/me/ on switch', async () => {
    render(<LanguageSwitcher />);

    const en = screen.getByRole('button', { name: 'EN' });
    const lv = screen.getByRole('button', { name: 'LV' });
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(lv).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(lv);

    expect(apiPatch).toHaveBeenCalledWith('/api/me/', {
      language: 'lv',
    });
    expect(localStorage.getItem(LANG_OVERRIDE_KEY)).toBe('lv');
    expect(i18n.language).toBe('lv');
  });

  it('is a no-op when clicking the active language', () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(localStorage.getItem(LANG_OVERRIDE_KEY)).toBeNull();
  });
});
