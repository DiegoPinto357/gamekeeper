import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverImage } from './CoverImage';

describe('CoverImage', () => {
  it('renders the image when src is present', () => {
    render(
      <CoverImage
        src="https://example.com/cover.jpg"
        alt="Cover"
        fallback={<div data-testid="fallback">?</div>}
      />,
    );
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute(
      'src',
      'https://example.com/cover.jpg',
    );
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
  });

  it('renders the fallback when src is missing', () => {
    render(
      <CoverImage
        src={undefined}
        alt="Cover"
        fallback={<div data-testid="fallback">?</div>}
      />,
    );
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('swaps to the fallback when the image fails to load', async () => {
    const user = userEvent.setup();
    render(
      <CoverImage
        src="https://example.com/dead.jpg"
        alt="Cover"
        fallback={<div data-testid="fallback">?</div>}
      />,
    );

    await user.hover(screen.getByRole('img', { name: 'Cover' }));
    // fire the error event the browser would send on a 404/broken image
    screen.getByRole('img', { name: 'Cover' }).dispatchEvent(
      new Event('error', { bubbles: true }),
    );

    expect(await screen.findByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument();
  });
});
