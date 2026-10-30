import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

const baseProps = {
  show: true,
  title: 'Delete task?',
  confirmLabel: 'Delete',
  onConfirm: () => {},
  onClose: () => {},
};

describe('ConfirmModal', () => {
  it('renders title, children, cancel and confirm buttons', () => {
    render(
      <ConfirmModal {...baseProps}>
        <p>Are you sure?</p>
      </ConfirmModal>,
    );

    expect(
      screen.getByRole('heading', { name: 'Delete task?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('fires onConfirm and onClose; busy disables both buttons', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal {...baseProps} onConfirm={onConfirm} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies confirmClassName and honors confirmDisabled', () => {
    render(
      <ConfirmModal
        {...baseProps}
        confirmClassName="btn-danger"
        confirmDisabled
      />,
    );
    const confirm = screen.getByRole('button', { name: /Delete/ });
    expect(confirm).toHaveClass('btn-danger');
    expect(confirm).toBeDisabled();
  });

  it('disables both footer buttons while busy', () => {
    render(<ConfirmModal {...baseProps} busy />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('renders nothing when show is false', () => {
    render(<ConfirmModal {...baseProps} show={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
