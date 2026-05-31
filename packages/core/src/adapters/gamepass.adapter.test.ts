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
});
