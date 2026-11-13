import { describe, expect, it } from 'vitest';
import { SIGNUP_REJECTED_MESSAGE, friendlyAuthError, friendlySignUpError, validateConfirm, validateEmail, validateFullName, validatePassword, validateSignUp } from './authValidation';

describe('auth validation', () => {
  it('validates email format and required', () => {
    expect(validateEmail('')).toMatch(/Enter/);
    expect(validateEmail('nope')).toMatch(/valid/);
    expect(validateEmail('a@b')).toMatch(/valid/);
    expect(validateEmail(' user@example.com ')).toBeNull();
  });
  it('enforces password strength and the 72-byte limit', () => {
    expect(validatePassword('short1')).toMatch(/at least 8/);
    expect(validatePassword('allletters')).toMatch(/letter and one number/);
    expect(validatePassword('12345678')).toMatch(/letter and one number/);
    expect(validatePassword('a1'.repeat(37))).toMatch(/at most 72/);
    expect(validatePassword('goodpass1')).toBeNull();
  });
  it('flags a password confirmation mismatch', () => {
    expect(validateConfirm('goodpass1', 'goodpass2')).toBe('Passwords do not match.');
    expect(validateConfirm('goodpass1', '')).toMatch(/Re-enter/);
    expect(validateConfirm('goodpass1', 'goodpass1')).toBeNull();
  });
  it('requires a name', () => {
    expect(validateFullName('  ')).toMatch(/Enter/);
    expect(validateFullName('x'.repeat(101))).toMatch(/100/);
  });
  it('collects every sign-up error at once', () => {
    const e = validateSignUp({ fullName: '', email: 'bad', password: 'x', confirm: 'y' });
    expect(Object.keys(e).sort()).toEqual(['confirm', 'email', 'fullName', 'password']);
  });
  it('maps auth errors without revealing account existence', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Incorrect email or password.');
    expect(friendlyAuthError({ code: 'user_not_found' })).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError({ status: 429 })).toMatch(/Too many/);
  });
});

describe('friendlySignUpError (V2: database-side sign-up rejection)', () => {
  const GENERIC = 'Something went wrong. Please try again.';

  it('maps the documented generic Supabase shape (500 / unexpected_failure) to the policy message', () => {
    // This is what the strict legal-acceptance and 18+ triggers surface as, because Auth does not forward the trigger text.
    const e = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' };
    expect(friendlySignUpError(e)).toBe(SIGNUP_REJECTED_MESSAGE);
  });
  it('maps the legal-acceptance trigger rejection if its hint ever reaches the client', () => {
    expect(friendlySignUpError({ message: 'x (hint: legal_acceptance_required)' })).toBe(SIGNUP_REJECTED_MESSAGE);
  });
  it('maps the age-declaration trigger rejection if its hint ever reaches the client', () => {
    expect(friendlySignUpError({ message: 'x (hint: age_declaration_required)' })).toBe(SIGNUP_REJECTED_MESSAGE);
  });
  it('tolerates a client that exposes only status or only code for the generic sign-up error', () => {
    expect(friendlySignUpError({ status: 500, message: 'Database error creating new user' })).toBe(SIGNUP_REJECTED_MESSAGE);
    expect(friendlySignUpError({ code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(SIGNUP_REJECTED_MESSAGE);
  });
  it('does not treat a generic database failure on another operation as a policy rejection', () => {
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Database error updating user' })).toBe(GENERIC);
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Internal server error' })).toBe(GENERIC);
    expect(friendlySignUpError({ status: 500 })).toBe(GENERIC);
  });
  it('does not treat the matching text with a non-server status or code as a rejection', () => {
    expect(friendlySignUpError({ status: 200, code: 'other', message: 'Database error saving new user' })).toBe(GENERIC);
  });
  it('keeps network failures as network errors', () => {
    expect(friendlySignUpError({ message: 'Failed to fetch' })).toBe('Network error. Check your connection and try again.');
    expect(friendlySignUpError({ name: 'AuthRetryableFetchError', status: 0, message: 'NetworkError when attempting to fetch resource.' }))
      .toBe('Network error. Check your connection and try again.');
  });
  it('keeps every existing mapping unchanged', () => {
    expect(friendlySignUpError({ code: 'invalid_credentials' })).toBe(friendlyAuthError({ code: 'invalid_credentials' }));
    expect(friendlySignUpError({ code: 'weak_password' })).toBe(friendlyAuthError({ code: 'weak_password' }));
    expect(friendlySignUpError({ code: 'over_email_send_rate_limit' })).toMatch(/Too many/);
    expect(friendlySignUpError({ status: 429 })).toMatch(/Too many/);
    expect(friendlySignUpError({ code: 'email_not_confirmed' })).toBe(friendlyAuthError({ code: 'email_not_confirmed' }));
  });
  it('returns the generic message for unknown, empty and null errors', () => {
    expect(friendlySignUpError({ code: 'something_new', message: 'odd' })).toBe(GENERIC);
    expect(friendlySignUpError({})).toBe(GENERIC);
    expect(friendlySignUpError(null)).toBe(GENERIC);
    expect(friendlySignUpError(undefined)).toBe(GENERIC);
  });
  it('never exposes SQL, trigger or table details', () => {
    expect(SIGNUP_REJECTED_MESSAGE).not.toMatch(/sql|trigger|auth\.users|23514|constraint|hint|legal_acceptance|age_declaration/i);
    const leaky = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user: ERROR: legal_acceptance_required (SQLSTATE 23514)' };
    expect(friendlySignUpError(leaky)).toBe(SIGNUP_REJECTED_MESSAGE);
  });
  it('leaves friendlyAuthError itself unchanged for the generic sign-up error', () => {
    expect(friendlyAuthError({ status: 500, code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(GENERIC);
  });
});

