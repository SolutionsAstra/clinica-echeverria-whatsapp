import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Stethoscope,
} from 'lucide-react';

/* ---------------------------------------------------------------------------
 * Tokens del sistema "UI/UX Pro Max" (oxford + platino)
 * ------------------------------------------------------------------------- */
const LOGIN_ENDPOINT = '/api/auth/login';

const STATUS_MESSAGES = {
  400: 'Revisa el formato del correo y la contraseña.',
  401: 'Correo o contraseña incorrectos.',
  403: 'Tu cuenta no tiene acceso al panel de recepción.',
  429: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
  500: 'El servidor no pudo procesar el acceso. Intenta de nuevo en unos minutos.',
};

const fallbackMessage = (status) =>
  STATUS_MESSAGES[status] ?? `No se pudo iniciar sesión (código ${status}).`;

/* ---------------------------------------------------------------------------
 * Campo de entrada con icono y foco dinámico
 * ------------------------------------------------------------------------- */
function Field({ id, label, icon: Icon, invalid, describedBy, trailing, ...inputProps }) {
  return (
    <div className="group space-y-2">
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-[#7D8BA0] transition-colors duration-200 group-focus-within:text-[#A3AEBD]"
      >
        {label}
      </label>

      <div
        className={[
          'flex h-11 w-full items-center gap-3 rounded-md border bg-[#0B192C] px-3',
          'transition-colors duration-200',
          'hover:border-[#1E3350]',
          'focus-within:border-[#1E3350] focus-within:ring-1 focus-within:ring-[#1E3350]',
          invalid ? 'border-[#5A2E36]' : 'border-[#1A2D48]',
        ].join(' ')}
      >
        <Icon
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[#7D8BA0] transition-colors duration-200 group-focus-within:text-[#E6E9EE]"
          strokeWidth={1.75}
        />
        <input
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-full min-w-0 flex-1 bg-transparent text-base tabular-nums text-[#E6E9EE] placeholder:text-[#7D8BA0]/70 outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
          {...inputProps}
        />
        {trailing}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * LoginForm
 * ------------------------------------------------------------------------- */
export default function LoginForm({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const errorId = `${uid}-error`;

  const abortRef = useRef(null);

  // Cancela la petición si el componente se desmonta a mitad del login
  useEffect(() => () => abortRef.current?.abort(), []);

  const clearError = () => {
    if (error) setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Ingresa tu correo y tu contraseña para continuar.');
      return;
    }

    setError('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email: trimmedEmail, password }),
        signal: controller.signal,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null; // respuesta sin cuerpo JSON
      }

      if (response.status === 200) {
        const usuario = data?.usuario ?? data?.user ?? data;
        onLoginSuccess?.(usuario);
        return;
      }

      setError(
        data?.message || data?.mensaje || data?.error || fallbackMessage(response.status)
      );
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <main
      className="flex min-h-dvh w-full items-center justify-center overflow-x-hidden bg-[#0B192C] px-4 py-12 tabular-nums antialiased sm:px-6"
      style={{ fontFamily: "'Geist', 'Geist Sans', ui-sans-serif, system-ui, sans-serif" }}
    >
      <section className="w-full max-w-[400px]">
        {/* Encabezado */}
        <header className="mb-10 space-y-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[#1A2D48]">
            <Stethoscope aria-hidden="true" className="h-5 w-5 text-[#E6E9EE]" strokeWidth={1.5} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-[#E6E9EE]">
              Acceso a recepción
            </h1>
            <p className="text-sm leading-relaxed text-[#A3AEBD]">
              Ingresa con tu correo institucional para gestionar la agenda de la clínica.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Error del servidor o de validación, sobre los inputs */}
          {error && (
            <div
              id={errorId}
              role="alert"
              className="flex items-start gap-3 rounded-md border border-[#5A2E36] bg-[#1C1A2A] px-3 py-3 text-sm leading-snug text-[#E8A9A9]"
            >
              <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}

          <Field
            id={emailId}
            label="Correo electrónico"
            icon={Mail}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="nombre@clinica.cl"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError();
            }}
            disabled={loading}
            invalid={Boolean(error)}
            describedBy={error ? errorId : undefined}
            required
          />

          <Field
            id={passwordId}
            label="Contraseña"
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            disabled={loading}
            invalid={Boolean(error)}
            describedBy={error ? errorId : undefined}
            required
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                disabled={loading}
                className="-mr-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-[#7D8BA0] transition-colors duration-200 hover:text-[#E6E9EE] focus-visible:text-[#E6E9EE] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#A3AEBD] disabled:cursor-not-allowed"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            }
          />

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#E6E9EE] text-sm font-medium text-[#0B192C] transition-[background-color,transform] duration-200 hover:bg-[#F4F6F8] active:scale-[0.99] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#E6E9EE] disabled:cursor-wait disabled:bg-[#C9CFD8] disabled:active:scale-100"
          >
            {loading ? (
              <>
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                />
                <span>Verificando Firma...</span>
              </>
            ) : (
              <span>Iniciar sesión</span>
            )}
          </button>
        </form>

        <p className="mt-10 border-t border-[#1A2D48] pt-6 text-[13px] leading-relaxed text-[#7D8BA0]">
          ¿Problemas para ingresar? Contacta al administrador del sistema de la clínica.
        </p>
      </section>
    </main>
  );
}
