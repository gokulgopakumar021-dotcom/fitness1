import { describe, expect, it } from 'vitest';
import { friendlyAuthError, validateConfirm, validateEmail, validateFullName, validatePassword, validateSignUp } from './authValidation';

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
