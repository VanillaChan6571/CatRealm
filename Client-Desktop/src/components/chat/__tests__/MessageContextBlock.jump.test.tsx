import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MessageContextBlock } from '../SharedMessageRowParts';

it('opens a reply target by mouse and keyboard', () => {
  const onJump = vi.fn();
  render(<MessageContextBlock kind="reply" authorLabel="Alice" previewText="Hello" onJump={onJump} />);

  const preview = screen.getByRole('button', { name: 'Jump to message from Alice' });
  fireEvent.click(preview);
  fireEvent.keyDown(preview, { key: 'Enter' });

  expect(onJump).toHaveBeenCalledTimes(2);
});
