import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the .ui-empty block with icon and title', () => {
    const { container } = render(
      <EmptyState icon="info-circle" title="No tasks" />,
    );

    expect(container.querySelector('.ui-empty')).not.toBeNull();
    expect(container.querySelector('.bi-info-circle')).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No tasks' }),
    ).toBeInTheDocument();
  });

  it('renders children as the hint below the title', () => {
    render(
      <EmptyState icon="inbox" title="Empty">
        <p>Sync to get started</p>
      </EmptyState>,
    );
    expect(screen.getByText('Sync to get started')).toBeInTheDocument();
  });
});
