import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FieldList from './FieldList';

describe('FieldList', () => {
  it('renders one input per value and edits through onChange', () => {
    const onChange = vi.fn();
    render(
      <FieldList
        label="Spelētāji"
        values={['Kārlis', 'Anna']}
        onChange={onChange}
      />,
    );
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: 'Jānis' } });
    expect(onChange).toHaveBeenCalledWith(['Jānis', 'Anna']);
  });

  it('appends an empty field via Pievienot lauku', () => {
    const onChange = vi.fn();
    render(
      <FieldList
        label="Spelētāji"
        values={['Kārlis']}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pievienot lauku' }),
    );
    expect(onChange).toHaveBeenCalledWith(['Kārlis', '']);
  });

  it('removes a row via its remove button', () => {
    const onChange = vi.fn();
    render(
      <FieldList
        label="Spelētāji"
        values={['Kārlis', 'Anna']}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Spelētāji 2' }),
    );
    expect(onChange).toHaveBeenCalledWith(['Kārlis']);
  });
});
