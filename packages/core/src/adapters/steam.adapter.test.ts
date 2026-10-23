import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { steamAdapter } from './steam.adapter';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('steamAdapter.fetchAppDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps developers/publishers/short_description/genres/release_date/header_image', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        '1145350': {
          success: true,
          data: {
            name: 'Hades II',
            steam_appid: 1145350,
            header_image: 'https://cdn.example/hades2.jpg',
            short_description: 'Battle beyond the Underworld.',
            developers: ['Supergiant Games'],
            publishers: ['Supergiant Games'],
            genres: [{ description: 'Action' }, { description: 'Roguelike' }],
            release_date: { coming_soon: false, date: 'May 6, 2024' },
          },
        },
      },
    });

    const details = await steamAdapter.fetchAppDetails(1145350);

    expect(details).toMatchObject({
      name: 'Hades II',
      steam_appid: 1145350,
      header_image: 'https://cdn.example/hades2.jpg',
      short_description: 'Battle beyond the Underworld.',
      developers: ['Supergiant Games'],
      publishers: ['Supergiant Games'],
      genres: [{ description: 'Action' }, { description: 'Roguelike' }],
      release_date: { coming_soon: false, date: 'May 6, 2024' },
    });
  });

  it('returns null when success is false', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { '1': { success: false } },
    });

    expect(await steamAdapter.fetchAppDetails(1)).toBeNull();
  });

  it('returns null on network error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('boom'));

    expect(await steamAdapter.fetchAppDetails(1)).toBeNull();
  });
});
