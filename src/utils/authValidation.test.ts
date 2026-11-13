import { describe, expect, it } from 'vitest';
import { BREACHED_PASSWORD_MESSAGE, SIGNUP_GENERIC_FAILURE_MESSAGE, SIGNUP_POLICY_REJECTED_MESSAGE, WEAK_PASSWORD_MESSAGE, friendlyAuthError, friendlySignUpError, validateConfirm, validateEmail, validateFullName, validatePassword, validateSignUp } from './authValidation';

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

describe('friendlySignUpError (V2: database-side sign-up failure)', () => {
  const GENERIC = 'Something went wrong. Please try again.';
  const NEW_MSG = "We couldn't complete your signup. Please refresh the page and try again. If the problem continues, contact support.";
  it('uses the exact agreed generic wording and never blames policy', () => {
    expect(SIGNUP_GENERIC_FAILURE_MESSAGE).toBe(NEW_MSG);
    expect(SIGNUP_GENERIC_FAILURE_MESSAGE).not.toMatch(/polic|legal|terms|\bage\b/i);
  });
  it('maps the documented generic database error (any shape) to the generic failure message, not a policy claim', () => {
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(NEW_MSG);
    expect(friendlySignUpError({ status: 500, message: 'Database error creating new user' })).toBe(NEW_MSG);
    expect(friendlySignUpError({ code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(NEW_MSG);
  });
  it('keeps the policy-specific message only when an explicit rejection hint is present', () => {
    expect(friendlySignUpError({ message: 'x (hint: legal_acceptance_required)' })).toBe(SIGNUP_POLICY_REJECTED_MESSAGE);
    expect(friendlySignUpError({ message: 'x (hint: age_declaration_required)' })).toBe(SIGNUP_POLICY_REJECTED_MESSAGE);
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Database error saving new user: legal_acceptance_required' }))
      .toBe(SIGNUP_POLICY_REJECTED_MESSAGE);
    expect(SIGNUP_POLICY_REJECTED_MESSAGE).not.toBe(SIGNUP_GENERIC_FAILURE_MESSAGE);
  });
  it('does not misclassify other 500s, partial shapes or non-server statuses', () => {
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Database error updating user' })).toBe(GENERIC);
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Internal server error' })).toBe(GENERIC);
    expect(friendlySignUpError({ status: 500 })).toBe(GENERIC);
    expect(friendlySignUpError({ status: 200, code: 'other', message: 'Database error saving new user' })).toBe(GENERIC);
  });
  it('keeps network failures as network errors', () => {
    expect(friendlySignUpError({ message: 'Failed to fetch' })).toBe('Network error. Check your connection and try again.');
    expect(friendlySignUpError({ name: 'AuthRetryableFetchError', status: 0, message: 'NetworkError when attempting to fetch resource.' }))
      .toBe('Network error. Check your connection and try again.');
  });
  it('keeps ordinary authentication failures on their existing mappings', () => {
    expect(friendlySignUpError({ code: 'invalid_credentials' })).toBe(friendlyAuthError({ code: 'invalid_credentials' }));
    expect(friendlySignUpError({ code: 'weak_password' })).toBe(friendlyAuthError({ code: 'weak_password' }));
    expect(friendlySignUpError({ code: 'weak_password', reasons: ['pwned'] })).toBe(BREACHED_PASSWORD_MESSAGE);
    expect(friendlySignUpError({ code: 'over_email_send_rate_limit' })).toMatch(/Too many/);
    expect(friendlySignUpError({ status: 429 })).toMatch(/Too many/);
    expect(friendlySignUpError({ code: 'email_not_confirmed' })).toBe(friendlyAuthError({ code: 'email_not_confirmed' }));
  });
  it('returns the unchanged generic message for unknown, empty and null errors', () => {
    expect(friendlySignUpError({ code: 'something_new', message: 'odd' })).toBe(GENERIC);
    expect(friendlySignUpError({})).toBe(GENERIC);
    expect(friendlySignUpError(null)).toBe(GENERIC);
    expect(friendlySignUpError(undefined)).toBe(GENERIC);
  });
  it('never exposes SQL, trigger or table details', () => {
    for (const m of [SIGNUP_GENERIC_FAILURE_MESSAGE, SIGNUP_POLICY_REJECTED_MESSAGE]) {
      expect(m).not.toMatch(/sql|trigger|auth\.users|23514|constraint|hint|legal_acceptance|age_declaration/i);
    }
    const leaky = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user: ERROR: legal_acceptance_required (SQLSTATE 23514)' };
    expect(friendlySignUpError(leaky)).toBe(SIGNUP_POLICY_REJECTED_MESSAGE);
    expect(friendlySignUpError({ status: 500, code: 'unexpected_failure', message: 'Database error saving new user' })).not.toMatch(/SQLSTATE|23514/);
  });
  it('leaves friendlyAuthError itself unchanged for the generic sign-up error', () => {
    expect(friendlyAuthError({ status: 500, code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(GENERIC);
  });
});

describe('weak_password mapping (V4: leaked-password protection)', () => {
  it('tells a breached-password rejection the password is compromised, not too short', () => {
    const m = friendlyAuthError({ code: 'weak_password', reasons: ['pwned'] });
    expect(m).toBe(BREACHED_PASSWORD_MESSAGE);
    expect(m).toMatch(/data breach/);
    expect(m).not.toMatch(/longer/i);
  });
  it('treats pwned together with other reasons as breached', () => {
    expect(friendlyAuthError({ code: 'weak_password', reasons: ['length', 'pwned'] })).toBe(BREACHED_PASSWORD_MESSAGE);
  });
  it('stays neutral when the reason is length/characters or absent (cause unknown)', () => {
    expect(friendlyAuthError({ code: 'weak_password', reasons: ['length'] })).toBe(WEAK_PASSWORD_MESSAGE);
    expect(friendlyAuthError({ code: 'weak_password', reasons: ['characters'] })).toBe(WEAK_PASSWORD_MESSAGE);
    expect(friendlyAuthError({ code: 'weak_password' })).toBe(WEAK_PASSWORD_MESSAGE);
    expect(friendlyAuthError({ code: 'weak_password', reasons: [] })).toBe(WEAK_PASSWORD_MESSAGE);
    expect(WEAK_PASSWORD_MESSAGE).not.toBe(BREACHED_PASSWORD_MESSAGE);
  });
  it('does not alter client-side password validation or other mappings', () => {
    expect(validatePassword('goodpass1')).toBeNull();
    expect(validatePassword('short1')).toMatch(/at least 8/);
    expect(friendlyAuthError({ code: 'same_password' })).toMatch(/different/);
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Incorrect email or password.');
  });
});
