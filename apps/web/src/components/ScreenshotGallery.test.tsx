import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenshotGallery } from './ScreenshotGallery';

const shots = [
  'https://cdn/one.jpg',
  'https://cdn/two.jpg',
  'https://cdn/three.jpg',
];

const renderGallery = () =>
  render(<ScreenshotGallery screenshots={shots} alt="Hades II" />);

const openFullscreen = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
  );
  return screen.getByTestId('screenshot-lightbox');
};

describe('ScreenshotGallery', () => {
  it('renders nothing without screenshots', () => {
    const { container } = render(
      <ScreenshotGallery screenshots={[]} alt="Hades II" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('screenshot-gallery')).not.toBeInTheDocument();
  });

  it('renders the first screenshot as the hero with a fullscreen control', () => {
    renderGallery();

    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
    // hero fullscreen button + two inline carousel arrows + three thumbnails
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(
      screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
    ).toBeInTheDocument();
  });

  it('shows no thumbnail strip for a single screenshot', () => {
    render(<ScreenshotGallery screenshots={[shots[0]]} alt="Hades II" />);

    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
    expect(screen.queryByRole('button', { name: /^Screenshot \d+$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show next screenshot' })).not.toBeInTheDocument();
    // the hero itself still opens fullscreen
    expect(
      screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
    ).toBeInTheDocument();
  });

  it('cycles the hero with the inline arrows without opening the lightbox', async () => {
    const user = userEvent.setup();
    renderGallery();

    await user.click(screen.getByRole('button', { name: 'Show next screenshot' }));
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/two.jpg',
    );
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();

    // previous from the first wraps around to the last
    await user.click(screen.getByRole('button', { name: 'Show previous screenshot' }));
    await user.click(screen.getByRole('button', { name: 'Show previous screenshot' }));
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/three.jpg',
    );
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();
  });

  it('cycles the hero with arrow keys without opening the lightbox', async () => {
    const user = userEvent.setup();
    renderGallery();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/two.jpg',
    );
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();

    // previous from the first wraps around to the last
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/three.jpg',
    );
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();
  });

  it('leaves arrow keys to editable fields', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input data-testid="note-input" />
        <ScreenshotGallery screenshots={shots} alt="Hades II" />
      </>,
    );
    await user.click(screen.getByTestId('note-input'));

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
  });

  it('reports lightbox open and close to the hosting dialog', async () => {
    const user = userEvent.setup();
    const onLightboxChange = vi.fn();
    render(
      <ScreenshotGallery
        screenshots={shots}
        alt="Hades II"
        onLightboxChange={onLightboxChange}
      />,
    );
    expect(onLightboxChange).toHaveBeenLastCalledWith(false);

    await user.click(
      screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
    );
    expect(onLightboxChange).toHaveBeenLastCalledWith(true);

    await user.keyboard('{Escape}');
    expect(onLightboxChange).toHaveBeenLastCalledWith(false);
  });

  it('switches the hero when a thumbnail is clicked', async () => {
    const user = userEvent.setup();
    renderGallery();

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

  it('opens a fullscreen lightbox from the hero', async () => {
    const user = userEvent.setup();
    renderGallery();

    const lightbox = await openFullscreen(user);
    expect(lightbox).toBeInTheDocument();
    expect(lightbox).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', shots[0]);
  });

  it('drives the carousel with buttons and arrow keys, wrapping around', async () => {
    const user = userEvent.setup();
    renderGallery();
    await openFullscreen(user);

    await user.click(screen.getByRole('button', { name: 'Next screenshot' }));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', shots[1]);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');

    // next from the last one wraps to the first
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');

    // previous from the first wraps back to the last
    await user.click(screen.getByRole('button', { name: 'Previous screenshot' }));
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', shots[2]);
  });

  it('opens at the clicked thumbnail', async () => {
    const user = userEvent.setup();
    renderGallery();

    await user.click(screen.getByRole('button', { name: 'Screenshot 3' }));

    expect(screen.getByTestId('screenshot-lightbox')).toBeInTheDocument();
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', shots[2]);
  });

  it('closes with the close button and with Escape', async () => {
    const user = userEvent.setup();
    renderGallery();

    await openFullscreen(user);
    await user.click(screen.getByRole('button', { name: 'Close screenshots' }));
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();

    await openFullscreen(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();
  });
});
