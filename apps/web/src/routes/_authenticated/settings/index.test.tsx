import { describe, expect, it } from 'vitest';
import { Route } from './index';

type ValidateSearch = (search: Record<string, unknown>) => Record<string, unknown>;
const validateSearch = Route.options.validateSearch as ValidateSearch;

describe('/_authenticated/settings/ route search', () => {
  it('keeps a known section id', () => {
    expect(validateSearch({ section: 'security' })).toEqual({ section: 'security' });
  });

  it('drops a section id the rail does not know', () => {
    expect(validateSearch({ section: 'billing' })).toEqual({});
  });

  it('drops a non-string section', () => {
    expect(validateSearch({ section: 42 })).toEqual({});
  });

  it('keeps a known oauth_linked provider next to a section', () => {
    expect(validateSearch({ oauth_linked: 'google', section: 'profile' })).toEqual({
      oauth_linked: 'google',
      section: 'profile',
    });
  });

  it('drops an unknown provider and unrelated params', () => {
    expect(validateSearch({ oauth_linked: 'myspace', foo: 'bar' })).toEqual({});
  });

  it('never throws on an empty search', () => {
    expect(validateSearch({})).toEqual({});
  });
});
