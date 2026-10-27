/** Pure validation helpers for the auth forms (kept UI-free so they are unit-testable). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt truncates beyond 72 bytes; reject rather than silently truncate
export const NAME_MAX = 100;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();

export function validateEmail(v: string): string | null {
  const e = v.trim();
  if (!e) return 'Enter your email address.';
  if (e.length > 254 || !EMAIL_RE.test(e)) return 'Enter a valid email address.';
  return null;
}

export function validateFullName(v: string): string | null {
  const n = v.trim();
  if (!n) return 'Enter your full name.';
  if (n.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`;
  return null;
}

export function validatePassword(v: string): string | null {
  if (!v) return 'Enter a password.';
  if (v.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(v).length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return 'Include at least one letter and one number.';
  return null;
}

export function validateConfirm(password: string, confirm: string): string | null {
  if (!confirm) return 'Re-enter your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export interface SignUpFields { fullName: string; email: string; password: string; confirm: string }
export type SignUpErrors = Partial<Record<keyof SignUpFields, string>>;

export function validateSignUp(f: SignUpFields): SignUpErrors {
  const errors: SignUpErrors = {};
  const set = <K extends keyof SignUpFields>(k: K, msg: string | null) => { if (msg) errors[k] = msg; };
  set('fullName', validateFullName(f.fullName));
  set('email', validateEmail(f.email));
  set('password', validatePassword(f.password));
  set('confirm', validateConfirm(f.password, f.confirm));
  return errors;
}

/** Maps Supabase auth errors to messages that don't reveal whether an account exists. */
export function friendlyAuthError(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = err?.code ?? '';
  switch (code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_not_confirmed':
      return 'Please verify your email first — check your inbox for the confirmation link.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'weak_password':
      return 'That password is too weak. Try a longer one with letters and numbers.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    case 'session_not_found':
    case 'refresh_token_not_found':
      return 'Your session has expired. Please sign in again.';
    default:
      break;
  }
  if (err?.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (err?.message && /fetch|network/i.test(err.message)) return 'Network error. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
