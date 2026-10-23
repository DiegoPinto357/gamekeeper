import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.hoisted(() => {
  process.env.IGDB_CLIENT_ID = 'test-client-id';
  process.env.IGDB_CLIENT_SECRET = 'test-client-secret';
});

const { igdbAdapter } = await import('./igdb.adapter');

vi.mock('axios');
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(() =>
      Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    ),
    writeFile: vi.fn(() => Promise.resolve()),
    mkdir: vi.fn(() => Promise.resolve()),
  },
}));
const mockedAxios = vi.mocked(axios, true);

const authHeaders = {
  headers: expect.objectContaining({ 'Client-ID': expect.any(String) }),
};

const mockAuth = () => {
  mockedAxios.post.mockImplementation((url: string) => {
    if (url.includes('oauth2/token')) {
      return Promise.resolve({
        data: {
          access_token: 'tok',
          expires_in: 3600,
          token_type: 'bearer',
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
};

describe('igdbAdapter metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  describe('fetchGameBySteamAppId', () => {
    it('resolves the IGDB game id via external_games (category 1, uid)', async () => {
      mockedAxios.post.mockImplementation((url: string, body?: unknown) => {
        if (url.includes('oauth2/token'))
          return Promise.resolve({
            data: { access_token: 'tok', expires_in: 3600, token_type: 'bearer' },
          });
        if (url.includes('/external_games')) {
          expect(body).toContain('uid = "1145350"');
          expect(body).toContain('category = 1');
          return Promise.resolve({ data: [{ id: 9001, game: 5502 }] });
        }
        if (url.includes('/games')) {
          return Promise.resolve({ data: [{ id: 5502, name: 'Hades II' }] });
        }
        return Promise.resolve({ data: [] });
      });

      const match = await igdbAdapter.fetchGameBySteamAppId(1145350);

      expect(match).toEqual({ igdbId: 5502, name: 'Hades II' });
    });

    it('returns null when external_games has no Steam entry', async () => {
      mockedAxios.post.mockImplementation((url: string) => {
        if (url.includes('oauth2/token'))
          return Promise.resolve({
            data: { access_token: 'tok', expires_in: 3600, token_type: 'bearer' },
          });
        return Promise.resolve({ data: [] });
      });

      expect(await igdbAdapter.fetchGameBySteamAppId(1)).toBeNull();
    });
  });

  describe('fetchGameDetails', () => {
    it('maps summary/genres/themes/keywords/similar/companies', async () => {
      mockedAxios.post.mockImplementation((url: string, body?: unknown) => {
        if (url.includes('oauth2/token'))
          return Promise.resolve({
            data: { access_token: 'tok', expires_in: 3600, token_type: 'bearer' },
          });
        if (url.includes('/games')) {
          expect(body).toContain('id = 5502');
          return Promise.resolve({
            data: [
              {
                id: 5502,
                name: 'Hades II',
                summary: 'Battle beyond the Underworld.',
                genres: [{ id: 1, name: 'Action' }],
                themes: [{ id: 1, name: 'Fantasy' }],
                keywords: [{ id: 2, name: 'roguelike' }],
                similar_games: [{ id: 5501 }],
                involved_companies: [
                  { company: { name: 'Supergiant Games' }, developer: true, publisher: true },
                ],
              },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      });

      const details = await igdbAdapter.fetchGameDetails(5502);

      expect(details).toEqual({
        igdbId: 5502,
        name: 'Hades II',
        summary: 'Battle beyond the Underworld.',
        genres: ['Action'],
        themes: ['Fantasy'],
        keywords: ['roguelike'],
        similarGameIds: [5501],
        developers: ['Supergiant Games'],
        publishers: ['Supergiant Games'],
      });
    });

    it('returns null when the game is not found', async () => {
      mockedAxios.post.mockImplementation((url: string) => {
        if (url.includes('oauth2/token'))
          return Promise.resolve({
            data: { access_token: 'tok', expires_in: 3600, token_type: 'bearer' },
          });
        return Promise.resolve({ data: [] });
      });

      expect(await igdbAdapter.fetchGameDetails(1)).toBeNull();
    });
  });
});
