import { describe, it, expect } from 'vitest';
import { mapProduct } from './gamepass.adapter';

const makeProduct = (overrides: Record<string, any> = {}) => ({
  ProductId: 'PROD123',
  LocalizedProperties: [
    {
      ProductTitle: 'Test Game',
      Images: [],
      ...overrides.lp,
    },
  ],
  ...overrides.root,
});

describe('gamepass.adapter — mapProduct', () => {
  it('returns basic fields with no images', () => {
    const result = mapProduct(makeProduct());
    expect(result).toEqual({
      id: 'PROD123',
      title: 'Test Game',
      available: true,
      coverImageUrl: undefined,
    });
  });

  it('extracts BoxArt as coverImageUrl (prefixes https:)', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [
            { ImagePurpose: 'Screenshot', Uri: '//example.com/screen.jpg' },
            { ImagePurpose: 'BoxArt', Uri: '//example.com/boxart.jpg' },
          ],
        },
      }),
    );
    expect(result?.coverImageUrl).toBe('https://example.com/boxart.jpg');
    expect(result?.screenshotUrls).toEqual(['https://example.com/screen.jpg']);
  });

  it('captures Screenshot + HeroArt purposes, deduped and capped at 5', () => {
    const shots = Array.from({ length: 7 }, (_, i) => ({
      ImagePurpose: 'Screenshot',
      Uri: `//cdn/${i}.jpg`,
    }));
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [
            ...shots,
            { ImagePurpose: 'HeroArt', Uri: '//cdn/hero.jpg' },
            { ImagePurpose: 'BoxArt', Uri: '//cdn/box.jpg' },
            { ImagePurpose: 'Screenshot', Uri: '//cdn/0.jpg' }, // duplicate
          ],
        },
      }),
    );

    expect(result?.screenshotUrls).toEqual([
      'https://cdn/0.jpg',
      'https://cdn/1.jpg',
      'https://cdn/2.jpg',
      'https://cdn/3.jpg',
      'https://cdn/4.jpg',
    ]);
  });

  it('omits screenshotUrls when no Screenshot/HeroArt images exist', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [{ ImagePurpose: 'BoxArt', Uri: '//example.com/boxart.jpg' }],
        },
      }),
    );
    expect(result?.screenshotUrls).toBeUndefined();
  });

  it('falls back to Poster when no BoxArt', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [{ ImagePurpose: 'Poster', Uri: '//example.com/poster.jpg' }],
        },
      }),
    );
    expect(result?.coverImageUrl).toBe('https://example.com/poster.jpg');
  });

  it('prefers BoxArt over Poster when both present', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [
            { ImagePurpose: 'Poster', Uri: '//example.com/poster.jpg' },
            { ImagePurpose: 'BoxArt', Uri: '//example.com/boxart.jpg' },
          ],
        },
      }),
    );
    expect(result?.coverImageUrl).toBe('https://example.com/boxart.jpg');
  });

  it('returns undefined coverImageUrl when image Uri is missing', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          Images: [{ ImagePurpose: 'BoxArt' }],
        },
      }),
    );
    expect(result?.coverImageUrl).toBeUndefined();
  });

  it('falls back to slug id when ProductId is absent', () => {
    const result = mapProduct({
      LocalizedProperties: [{ ProductTitle: 'Some Cool Game', Images: [] }],
    });
    expect(result?.id).toBe('some-cool-game');
  });

  it('returns null for a product with no title', () => {
    const result = mapProduct({
      ProductId: 'PROD123',
      LocalizedProperties: [{ ProductTitle: '', Images: [] }],
    });
    expect(result).toBeNull();
  });

  it('returns null when LocalizedProperties is absent', () => {
    const result = mapProduct({ ProductId: 'PROD123' });
    expect(result).toBeNull();
  });

  it('extracts description/genres(Categories)/developer/publisher', () => {
    const result = mapProduct(
      makeProduct({
        lp: {
          ProductDescription: 'A thrilling sci-fi adventure.',
          DeveloperName: 'Signal Loop',
          PublisherName: 'Fellow Traveller',
        },
        root: { Properties: { Categories: ['Adventure', 'Indie'] } },
      }),
    );

    expect(result).toMatchObject({
      description: 'A thrilling sci-fi adventure.',
      genres: ['Adventure', 'Indie'],
      developer: 'Signal Loop',
      publisher: 'Fellow Traveller',
    });
  });

  it('falls back to ShortDescription and omits absent metadata', () => {
    const result = mapProduct(
      makeProduct({ lp: { ShortDescription: 'Short desc.' } }),
    );

    expect(result?.description).toBe('Short desc.');
    expect(result?.genres).toBeUndefined();
    expect(result?.developer).toBeUndefined();
    expect(result?.publisher).toBeUndefined();
  });
});
