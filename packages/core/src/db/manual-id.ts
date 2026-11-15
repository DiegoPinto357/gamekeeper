/**
 * Generate a stable `manual:<slug>` id for user-added rows that have no
 * library/catalog id yet (P0B §6: owned games get the library canonical id
 * when added from library context, else `manual:<slug>`).
 */
export const manualId = (name: string): string => {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `manual:${slug || 'untitled'}`;
};
