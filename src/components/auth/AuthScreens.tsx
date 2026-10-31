import React, { useId, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { BrandLogo } from '../ui/BrandLogo';
import { useAuth } from '../../context/AuthContext';
import {
  PASSWORD_MIN,
  validateConfirm,
  validateEmail,
  validatePassword,
  validateSignUp,
  type SignUpErrors
} from '../../utils/authValidation';

/* ---------- layout ---------- */

const AuthLayout: React.FC<{
  title: string;
  subtitle?: string;
  onBackToHome?: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, onBackToHome, children }) => (
  <div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans flex items-center justify-center px-4 py-10">
    <main className="w-full max-w-md">
      <div className={onBackToHome ? 'flex items-center justify-between mb-4 px-1' : 'hidden'}>
        {onBackToHome ? (
          <button
            type="button"
            onClick={onBackToHome}
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-400 hover:text-accent transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
            <span>BACK TO HOME</span>
          </button>
        ) : null}
      </div>
      <div className="flex justify-center mb-6">
        <BrandLogo variant="full" eager className="h-28 sm:h-36" />
      </div>
      <div className="bg-surface border border-line rounded-2xl p-5 sm:p-7 shadow-xl">
        <h1 className="text-xl font-bold text-zinc-100">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  </div>
);

export const SplashScreen: React.FC = () => (
  <div className="min-h-dvh bg-[var(--bg-canvas)] flex items-center justify-center" role="status" aria-busy="true" aria-live="polite">
    <div className="flex flex-col items-center gap-6 px-6">
      <BrandLogo variant="full" eager className="h-40 sm:h-48" />
      <Loader2 className="w-6 h-6 text-accent animate-spin" aria-hidden />
    </div>
    <span className="sr-only">Checking your session…</span>
  </div>
);

export const SetupErrorScreen: React.FC<{ message: string | null }> = ({ message }) => (
  <AuthLayout title="Setup required" subtitle="IronLog AI can't reach its account service yet.">
    <div role="alert" className="flex gap-2 text-sm text-warning bg-warning/10 border border-warning/30 rounded-xl p-3">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <span>{message ?? 'Supabase is not configured.'}</span>
    </div>
    <ol className="mt-4 text-sm text-zinc-300 list-decimal pl-5 space-y-1">
      <li>Copy <code className="font-mono text-zinc-100">.env.example</code> to <code className="font-mono text-zinc-100">.env.local</code>.</li>
      <li>Set <code className="font-mono text-zinc-100">VITE_SUPABASE_URL</code> and <code className="font-mono text-zinc-100">VITE_SUPABASE_PUBLISHABLE_KEY</code> (Supabase dashboard → Project Settings → API Keys).</li>
      <li>Restart the dev server.</li>
    </ol>
  </AuthLayout>
);

export const SessionErrorScreen: React.FC<{ message: string | null; onRetry: () => void }> = ({ message, onRetry }) => (
  <AuthLayout title="Couldn't load your session">
    <div role="alert" className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-xl p-3">{message}</div>
    <Button className="mt-4" fullWidth onClick={onRetry}>Try again</Button>
  </AuthLayout>
);

/* ---------- field primitives ---------- */

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoComplete?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

const inputCls = 'w-full h-11 px-3 bg-surface-2 border rounded-xl text-zinc-100 text-sm focus:outline-none focus:border-accent disabled:opacity-60';

const Field: React.FC<FieldProps> = ({ label, type = 'text', value, onChange, error, autoComplete, hint, disabled, autoFocus }) => {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-zinc-400 mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputCls} ${error ? 'border-danger' : 'border-line-strong'} ${isPassword ? 'pr-11' : ''}`}
          {...(type === 'email' ? { inputMode: 'email' as const, autoCapitalize: 'none', spellCheck: false } : {})}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute right-1 top-1 h-9 w-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 rounded-lg"
          >
            {shown ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
          </button>
        )}
      </div>
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-zinc-500 mt-1">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
};

const FormError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div role="alert" className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-xl p-3">{message}</div>
  ) : null;

const LinkButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="text-accent hover:underline font-medium">{children}</button>
);

/** Blocks a second submit while one is in flight (state alone can lag a fast double-click). */
function useSubmitGuard() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

/* ---------- screens ---------- */

type Mode = 'signin' | 'signup' | 'forgot' | 'verify' | 'reset-sent';

export interface AuthScreenProps {
  initialMode?: Mode;
  onBackToHome?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'signin',
  onBackToHome
}) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const { callbackError, clearCallbackError } = useAuth();
  const go = (m: Mode) => { clearCallbackError(); setMode(m); };

  return (
    <>
      {mode === 'signin' && (
        <SignInForm
          email={email}
          setEmail={setEmail}
          go={go}
          callbackError={callbackError}
          onBackToHome={onBackToHome}
        />
      )}
      {mode === 'signup' && (
        <SignUpForm
          email={email}
          setEmail={setEmail}
          go={go}
          onBackToHome={onBackToHome}
        />
      )}
      {mode === 'forgot' && (
        <ForgotForm
          email={email}
          setEmail={setEmail}
          go={go}
          callbackError={callbackError}
          onBackToHome={onBackToHome}
        />
      )}
      {mode === 'verify' && (
        <VerifyNotice
          email={email}
          go={go}
          onBackToHome={onBackToHome}
        />
      )}
      {mode === 'reset-sent' && (
        <ResetSentNotice
          email={email}
          go={go}
          onBackToHome={onBackToHome}
        />
      )}
    </>
  );
};

interface FormProps {
  email: string;
  setEmail: (v: string) => void;
  go: (m: Mode) => void;
  callbackError?: string | null;
  onBackToHome?: () => void;
}

const SignInForm: React.FC<FormProps> = ({ email, setEmail, go, callbackError, onBackToHome }) => {
  const { signIn, resendVerification } = useAuth();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const { busy, run } = useSubmitGuard();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { email: validateEmail(email) ?? undefined, password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    setFormError(null);
    setUnverified(false);
    if (next.email || next.password) return;
    void run(async () => {
      const r = await signIn(email, password);
      if (!r.ok) {
        setFormError(r.error ?? 'Sign in failed.');
        setUnverified(/verify your email/i.test(r.error ?? ''));
      }
      // On success the AuthGate swaps this screen out; nothing else to do.
    });
  };

  const resend = () => void run(async () => {
    const r = await resendVerification(email);
    if (r.ok) setResent(true); else setFormError(r.error ?? 'Could not resend.');
  });

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your IronLog AI account." onBackToHome={onBackToHome}>
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        <FormError message={callbackError ?? formError} />
        <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" disabled={busy} autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" disabled={busy} />
        <Button type="submit" fullWidth loading={busy}>Sign in</Button>
        {unverified && (
          <p className="text-xs text-zinc-400">
            {resent ? 'Verification email sent.' : <>Didn't get it? <LinkButton onClick={resend}>Resend verification email</LinkButton></>}
          </p>
        )}
      </form>
      <div className="mt-5 flex items-center justify-between text-sm text-zinc-400">
        <LinkButton onClick={() => go('forgot')}>Forgot password?</LinkButton>
        <span>New here? <LinkButton onClick={() => go('signup')}>Create account</LinkButton></span>
      </div>
      {onBackToHome && (
        <div className="mt-4 pt-4 border-t border-line/60 text-center">
          <button
            type="button"
            onClick={onBackToHome}
            className="text-xs font-mono text-zinc-400 hover:text-accent transition-colors"
          >
            ← Back to Homepage
          </button>
        </div>
      )}
    </AuthLayout>
  );
};

const SignUpForm: React.FC<FormProps> = ({ email, setEmail, go, onBackToHome }) => {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useSubmitGuard();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateSignUp({ fullName, email, password, confirm });
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    void run(async () => {
      const r = await signUp(fullName, email, password);
      if (!r.ok) { setFormError(r.error ?? 'Could not create account.'); return; }
      // needsVerification: show the check-your-email screen. Otherwise a session exists and AuthGate takes over.
      if (r.needsVerification) go('verify');
    });
  };

  return (
    <AuthLayout title="Create your account" subtitle="Track training, nutrition and progress." onBackToHome={onBackToHome}>
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        <FormError message={formError} />
        <Field label="Full name" value={fullName} onChange={setFullName} error={errors.fullName} autoComplete="name" disabled={busy} autoFocus />
        <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" disabled={busy} />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" disabled={busy}
          hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" disabled={busy} />
        <Button type="submit" fullWidth loading={busy}>Create account</Button>
      </form>
      <p className="mt-5 text-sm text-zinc-400 text-center">Already have an account? <LinkButton onClick={() => go('signin')}>Sign in</LinkButton></p>
      {onBackToHome && (
        <div className="mt-4 pt-4 border-t border-line/60 text-center">
          <button
            type="button"
            onClick={onBackToHome}
            className="text-xs font-mono text-zinc-400 hover:text-accent transition-colors"
          >
            ← Back to Homepage
          </button>
        </div>
      )}
    </AuthLayout>
  );
};

const VerifyNotice: React.FC<{ email: string; go: (m: Mode) => void; onBackToHome?: () => void }> = ({ email, go, onBackToHome }) => {
  const { resendVerification } = useAuth();
  const [state, setState] = useState<'idle' | 'sent'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useSubmitGuard();
  const resend = () => void run(async () => {
    setErr(null);
    const r = await resendVerification(email);
    if (r.ok) setState('sent'); else setErr(r.error ?? 'Could not resend.');
  });
  return (
    <AuthLayout title="Check your email" onBackToHome={onBackToHome}>
      <div className="flex gap-3 text-sm text-zinc-300">
        <MailCheck className="w-5 h-5 text-accent shrink-0" aria-hidden />
        <p>If <span className="font-semibold text-zinc-100">{email}</span> can be registered, we've sent a confirmation link. Open it to verify your address, then sign in. Check spam if it doesn't arrive.</p>
      </div>
      <div className="mt-4 space-y-3">
        <FormError message={err} />
        {state === 'sent' && <p role="status" className="text-sm text-success flex items-center gap-1"><CheckCircle2 className="w-4 h-4" aria-hidden />Email sent again.</p>}
        <Button variant="secondary" fullWidth loading={busy} onClick={resend}>Resend email</Button>
        <Button variant="ghost" fullWidth onClick={() => go('signin')}>Back to sign in</Button>
      </div>
    </AuthLayout>
  );
};

const ForgotForm: React.FC<FormProps> = ({ email, setEmail, go, callbackError, onBackToHome }) => {
  const { requestPasswordReset } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useSubmitGuard();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateEmail(email);
    setError(v); setFormError(null);
    if (v) return;
    void run(async () => {
      const r = await requestPasswordReset(email);
      if (r.ok) go('reset-sent'); else setFormError(r.error ?? 'Could not send reset email.');
    });
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one." onBackToHome={onBackToHome}>
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        <FormError message={callbackError ?? formError} />
        <Field label="Email" type="email" value={email} onChange={setEmail} error={error} autoComplete="email" disabled={busy} autoFocus />
        <Button type="submit" fullWidth loading={busy}>Send reset link</Button>
      </form>
      <p className="mt-5 text-sm text-zinc-400 text-center"><LinkButton onClick={() => go('signin')}>Back to sign in</LinkButton></p>
    </AuthLayout>
  );
};

const ResetSentNotice: React.FC<{ email: string; go: (m: Mode) => void; onBackToHome?: () => void }> = ({ email, go, onBackToHome }) => (
  <AuthLayout title="Check your email" onBackToHome={onBackToHome}>
    <div className="flex gap-3 text-sm text-zinc-300">
      <MailCheck className="w-5 h-5 text-accent shrink-0" aria-hidden />
      <p>If an account exists for <span className="font-semibold text-zinc-100">{email}</span>, a password-reset link is on its way. Open it in this same browser.</p>
    </div>
    <Button variant="ghost" className="mt-4" fullWidth onClick={() => go('signin')}>Back to sign in</Button>
  </AuthLayout>
);

/** Shown after the user opens a password-recovery link. */
export const ResetPasswordScreen: React.FC = () => {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useSubmitGuard();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { password: validatePassword(password) ?? undefined, confirm: validateConfirm(password, confirm) ?? undefined };
    setErrors(next); setFormError(null);
    if (next.password || next.confirm) return;
    void run(async () => {
      const r = await updatePassword(password);
      if (!r.ok) setFormError(r.error ?? 'Could not update password.');
      // Success: status flips to authenticated and AuthGate opens the app.
    });
  };
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        <FormError message={formError} />
        <Field label="New password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" disabled={busy} autoFocus
          hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`} />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" disabled={busy} />
        <Button type="submit" fullWidth loading={busy}>Update password</Button>
      </form>
      <p className="mt-5 text-sm text-zinc-400 text-center"><LinkButton onClick={() => void signOut()}>Cancel and sign out</LinkButton></p>
    </AuthLayout>
  );
};
