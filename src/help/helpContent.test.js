import { describe, it, expect } from 'vitest';
import { articlesForRole, docsUrl, HELP_ARTICLES } from './helpContent.js';

describe('articlesForRole', () => {
  it('shows only trainee articles to a student', () => {
    const groups = articlesForRole('student');
    const ids = groups.flatMap((g) => g.articles.map((a) => a.id));
    expect(ids).toContain('getting-started');
    expect(ids).not.toContain('cohorts'); // educator-only
    expect(ids).not.toContain('first-week'); // admin-only
  });

  it('shows educator articles to an educator but not admin ones', () => {
    const ids = articlesForRole('educator').flatMap((g) =>
      g.articles.map((a) => a.id),
    );
    expect(ids).toContain('cohorts');
    expect(ids).not.toContain('first-week');
  });

  it('shows everything to an admin', () => {
    const ids = articlesForRole('admin').flatMap((g) =>
      g.articles.map((a) => a.id),
    );
    expect(ids).toContain('first-week');
    expect(ids.length).toBe(HELP_ARTICLES.length);
  });

  it('defaults unknown roles to student scope', () => {
    expect(articlesForRole(undefined)).toEqual(articlesForRole('student'));
    expect(articlesForRole('bogus')).toEqual(articlesForRole('student'));
  });

  it('groups articles by their group catalogue key', () => {
    const groups = articlesForRole('admin');
    expect(groups.map((g) => g.groupKey)).toEqual([
      'group_using',
      'group_teaching',
      'group_administration',
    ]);
  });

  // Regression lock: help chrome must stay translatable — the manifest carries
  // catalogue keys, never English prose (findings #24b, 2026-08-30).
  it('carries catalogue keys, not prose, for every article', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.title, `${a.id} still has a hardcoded title`).toBeUndefined();
      expect(a.titleKey).toMatch(/^article_[a-z_]+$/);
      expect(a.groupKey).toMatch(/^group_[a-z_]+$/);
    }
  });
});

describe('docsUrl', () => {
  it('joins onto the docs base without double slashes', () => {
    expect(docsUrl('trainee/rooms')).toBe('/rohy/docs/trainee/rooms');
    expect(docsUrl('/trainee/rooms')).toBe('/rohy/docs/trainee/rooms');
  });
});
