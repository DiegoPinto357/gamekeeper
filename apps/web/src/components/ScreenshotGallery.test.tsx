import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenshotGallery } from './ScreenshotGallery';

const shots = [
  'https://cdn/one.jpg',
  'https://cdn/two.jpg',
  'https://cdn/three.jpg',
];

describe('ScreenshotGallery', () => {
  it('renders nothing without screenshots', () => {
    const { container } = render(
      <ScreenshotGallery screenshots={[]} alt="Hades II" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('screenshot-gallery')).not.toBeInTheDocument();
  });

  it('renders the first screenshot as the hero', () => {
    render(<ScreenshotGallery screenshots={shots} alt="Hades II" />);

    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
    // single hero, no thumbnails for a one-image gallery would be covered by
    // length > 1; three images → three thumbs
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows no thumbnail strip for a single screenshot', () => {
    render(<ScreenshotGallery screenshots={[shots[0]]} alt="Hades II" />);

    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('switches the hero when a thumbnail is clicked', async () => {
    const user = userEvent.setup();
    render(<ScreenshotGallery screenshots={shots} alt="Hades II" />);

    await user.click(screen.getByRole('button', { name: 'Screenshot 3' }));

    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/three.jpg',
    );
    expect(screen.getByRole('button', { name: 'Screenshot 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Screenshot 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
