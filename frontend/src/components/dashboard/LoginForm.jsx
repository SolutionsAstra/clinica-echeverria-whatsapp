import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  Activity,
  AlertCircle,
  Ambulance,
  Atom,
  Bandage,
  Eye,
  EyeOff,
  FlaskConical,
  Heart,
  HeartPulse,
  Loader2,
  Lock,
  Mail,
  Pill,
  Syringe,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15000;
const REMEMBER_KEY = 'reception:last-email';

const timeFormatter = new Intl.DateTimeFormat('es-CL', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

const STATUS_MESSAGES = {
  400: 'Revisa los datos ingresados.',
  401: 'Correo o contraseña incorrectos.',
  403: 'Tu cuenta no tiene acceso a recepción.',
  429: 'Demasiados intentos. Espera un minuto y vuelve a intentar.',
};

// Íconos en la franja intermedia, entre la tarjeta y la red (posición relativa al viewport).
const FLOATING_ICONS = [
  { Icon: Atom, top: '20%', left: '52%', size: 26, delay: '0s' },
  { Icon: Activity, top: '30%', left: '60%', size: 18, delay: '6s' },
  { Icon: Ambulance, top: '38%', left: '46%', size: 20, delay: '3s' },
  { Icon: Heart, top: '48%', left: '54%', size: 20, delay: '9s' },
  { Icon: HeartPulse, top: '60%', left: '48%', size: 26, delay: '1.5s' },
  { Icon: Accessibility, top: '56%', left: '62%', size: 18, delay: '7.5s' },
  { Icon: Syringe, top: '68%', left: '58%', size: 20, delay: '4.5s' },
  { Icon: Bandage, top: '78%', left: '44%', size: 22, delay: '10.5s' },
  { Icon: Pill, top: '82%', left: '54%', size: 18, delay: '2s' },
  { Icon: FlaskConical, top: '84%', left: '64%', size: 20, delay: '8s' },
];

/* ------------------------------------------------------------------ */
/* Red neuronal médica (determinista)                                  */
/* ------------------------------------------------------------------ */

const NET_W = 900;
const NET_H = 900;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Malla tipo low-poly: más densa hacia el borde derecho, cada nodo unido a sus 3 vecinos más cercanos. */
function buildMesh(count = 70, neighbours = 3) {
  const rand = mulberry32(260);
  const nodes = Array.from({ length: count }, (_, i) => {
    const bias = 1 - rand() ** 1.8; // empuja los nodos hacia la derecha
    return {
      id: i,
      x: Math.round(bias * NET_W),
      y: Math.round(rand() * NET_H),
      r: rand() > 0.85 ? 2.5 : 1.5,
    };
  });

  const seen = new Set();
  const links = [];
  nodes.forEach((n) => {
    nodes
      .filter((m) => m.id !== n.id)
      .map((m) => ({ m, d: Math.hypot(n.x - m.x, n.y - m.y) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, neighbours)
      .forEach(({ m, d }) => {
        const key = n.id < m.id ? `${n.id}-${m.id}` : `${m.id}-${n.id}`;
        if (seen.has(key) || d > 220) return;
        seen.add(key);
        links.push({ key, a: n, b: m });
      });
  });

  return { nodes, links };
}

function crossPath(cx, cy, size) {
  const L = size / 2;
  const w = size / 6;
  return [
    `M${cx - w} ${cy - L}`,
    `H${cx + w}V${cy - w}H${cx + L}V${cy + w}H${cx + w}V${cy + L}`,
    `H${cx - w}V${cy + w}H${cx - L}V${cy - w}H${cx - w}Z`,
  ].join('');
}

// Cruces en coordenadas del viewBox. double = contorno doble, como las cruces grandes de la referencia.
const CROSSES = [
  { x: 470, y: 230, size: 110, double: true },
  { x: 330, y: 420, size: 140, double: true },
  { x: 610, y: 470, size: 120, double: true },
  { x: 130, y: 300, size: 46 },
  { x: 215, y: 160, size: 64 },
  { x: 430, y: 560, size: 50 },
  { x: 180, y: 520, size: 40 },
  { x: 760, y: 140, size: 54 },
];

function MedicalNetwork() {
  const { nodes, links } = useMemo(() => buildMesh(), []);

  return (
    <svg
      viewBox={`0 0 ${NET_W} ${NET_H}`}
      preserveAspectRatio="xMaxYMid slice"
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="#1A2D48" strokeWidth="1" fill="none">
        {links.map(({ key, a, b }) => (
          <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <g fill="#2A4266">
        {nodes.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r={n.r} />
        ))}
      </g>
      <g fill="none" strokeWidth="1" strokeLinejoin="miter">
        {CROSSES.map(({ x, y, size, double }) => (
          <g key={`${x}-${y}`}>
            <path
              d={crossPath(x, y, size)}
              stroke="#3B5A86"
              fill="#0F2138"
              fillOpacity="0.35"
              vectorEffect="non-scaling-stroke"
            />
            {double && (
              <path
                d={crossPath(x, y, size * 0.78)}
                stroke="#2A4266"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Hooks auxiliares                                                    */
/* ------------------------------------------------------------------ */

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 1000);
    }, 1000 - (Date.now() % 1000));

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);

  return now;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

function readRememberedEmail() {
  try {
    return typeof window === 'undefined' ? '' : window.localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

function persistRememberedEmail(remember, value) {
  try {
    if (remember) window.localStorage.setItem(REMEMBER_KEY, value);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* almacenamiento no disponible: se ignora sin romper el login */
  }
}

/* ------------------------------------------------------------------ */
/* Componente principal                                                */
/* ------------------------------------------------------------------ */

/**
 * Acceso de recepción.
 * @param {{
 *   onLoginSuccess: (usuario: object) => void,
 *   onForgotPassword?: () => void,
 *   apiBaseUrl?: string,
 * }} props
 */
export default function LoginForm({ onLoginSuccess, onForgotPassword, apiBaseUrl = '' }) {
  const [email, setEmail] = useState(readRememberedEmail);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readRememberedEmail() !== '');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const controllerRef = useRef(null);
  const mountedRef = useRef(true);

  const now = useClock();
  const online = useOnlineStatus();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const validate = (trimmedEmail) => {
    const errs = {};
    if (!trimmedEmail) errs.email = 'Ingresa tu correo institucional.';
    else if (!EMAIL_RE.test(trimmedEmail)) errs.email = 'El formato del correo no es válido.';
    if (!password) errs.password = 'Ingresa tu contraseña.';
    return errs;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    const trimmedEmail = email.trim();
    const errs = validate(trimmedEmail);
    setFieldErrors(errs);
    setError('');

    if (errs.email) {
      emailRef.current?.focus();
      return;
    }
    if (errs.password) {
      passwordRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200) {
        if (!data?.usuario) {
          setError('El servidor respondió sin datos de usuario. Contacta a soporte.');
          return;
        }
        persistRememberedEmail(remember, trimmedEmail);
        setPassword('');
        onLoginSuccess(data.usuario);
        return;
      }

      setError(
        data?.message ||
          data?.error ||
          STATUS_MESSAGES[res.status] ||
          `No se pudo iniciar sesión (código ${res.status}).`,
      );
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === 'AbortError') {
        if (timedOut) setError('El servidor no respondió a tiempo. Intenta nuevamente.');
        return;
      }
      setError('No hay conexión con el servidor. Verifica la red e intenta otra vez.');
    } finally {
      clearTimeout(timeoutId);
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current) setLoading(false);
    }
  };

  const clearFieldError = (field) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    if (error) setError('');
  };

  const inputBase =
    'w-full rounded-lg border bg-[#0B192C]/55 py-3 pl-11 pr-4 text-[15px] text-[#E6EAF0] ' +
    'placeholder:text-[#5F6E82] outline-none transition-colors duration-200 ' +
    'focus:border-[#8B9CF7] focus:ring-1 focus:ring-[#8B9CF7]/60 disabled:opacity-60';

  const borderFor = (field) =>
    fieldErrors[field] ? 'border-[#F87171]/70' : 'border-[#1A2D48] hover:border-[#2A4266]';

  return (
    <main
      className="relative isolate flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0B192C] px-4 py-12 text-[#E6EAF0] antialiased sm:px-6 md:justify-start md:pl-[8vw] lg:pl-[10vw]"
      style={{ fontFamily: "'Geist', 'Geist Sans', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes lf-drift {
          0%   { transform: translate3d(24px, 0, 0); opacity: 0; }
          20%  { opacity: .7; }
          80%  { opacity: .7; }
          100% { transform: translate3d(-48px, 6px, 0); opacity: 0; }
        }
        .lf-drift { animation: lf-drift 18s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .lf-drift { animation: none; opacity: .55; }
        }
      `}</style>

      {/* Red neuronal con cruces médicas (derecha) */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-full opacity-40 md:w-[65%] md:opacity-100"
        style={{
          WebkitMaskImage: 'linear-gradient(to left, #000 60%, transparent)',
          maskImage: 'linear-gradient(to left, #000 60%, transparent)',
        }}
      >
        <MedicalNetwork />
      </div>

      {/* Íconos médicos flotando hacia el centro (solo escritorio) */}
      <div className="pointer-events-none absolute inset-0 -z-10 hidden md:block" aria-hidden="true">
        {FLOATING_ICONS.map(({ Icon, top, left, size, delay }) => (
          <span
            key={`${top}-${left}`}
            className="lf-drift absolute text-[#5F7697]"
            style={{ top, left, animationDelay: delay }}
          >
            <Icon size={size} strokeWidth={1.25} />
          </span>
        ))}
      </div>

      {/* Tarjeta de acceso */}
      <section
        aria-labelledby="login-title"
        className="w-full max-w-[400px] rounded-2xl border border-[#1A2D48] bg-[#0F2138]/55 p-8 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-colors duration-200 focus-within:border-[#2A4266] sm:p-10"
      >
        <header className="mb-8 text-center">
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight text-[#F1F4F8]">
            Acceso de recepción
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#8A97A8]">
            Gestiona citas y derivaciones del día.
          </p>
        </header>

        <form noValidate onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-[#C3CCD8]">
              Correo institucional
            </label>
            <div className="relative">
              <Mail
                size={18}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5F6E82]"
                aria-hidden="true"
              />
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="nombre@clinica.cl"
                value={email}
                disabled={loading}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                className={`${inputBase} ${borderFor('email')}`}
              />
            </div>
            {fieldErrors.email && (
              <p id="login-email-error" className="mt-2 text-xs text-[#FCA5A5]">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-[#C3CCD8]">
              Contraseña
            </label>
            <div className="relative">
              <Lock
                size={18}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5F6E82]"
                aria-hidden="true"
              />
              <input
                ref={passwordRef}
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                disabled={loading}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError('password');
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                className={`${inputBase} ${borderFor('password')} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[#8A97A8] transition-colors duration-200 hover:text-[#E6EAF0] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B9CF7]"
              >
                {showPassword ? (
                  <EyeOff size={18} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Eye size={18} strokeWidth={1.5} aria-hidden="true" />
                )}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="login-password-error" className="mt-2 text-xs text-[#FCA5A5]">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[#C3CCD8]">
              <input
                type="checkbox"
                checked={remember}
                disabled={loading}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-[#2A4266] bg-[#0B192C] accent-[#8B9CF7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B9CF7]"
              />
              Recordar correo
            </label>
            {onForgotPassword && (
              <button
                type="button"
                onClick={onForgotPassword}
                className="cursor-pointer rounded text-[#C3CCD8] underline-offset-4 transition-colors duration-200 hover:text-[#F1F4F8] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B9CF7]"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}
          </div>

          <div aria-live="assertive">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-[#F87171]/30 bg-[#F87171]/[0.06] px-4 py-3 text-sm text-[#FCA5A5]"
              >
                <AlertCircle size={18} strokeWidth={1.5} className="mt-px shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#C3CCD8]/20 bg-[#E6EAF0] py-3 text-[15px] font-semibold text-[#0B192C] transition-colors duration-200 hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B9CF7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F2138] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />
                Verificando…
              </>
            ) : (
              'Ingresar'
            )}
          </button>
        </form>

        <footer className="mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-[#1A2D48] pt-5">
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <span className="relative flex h-2 w-2">
              {online && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#34D399] opacity-60 motion-safe:animate-ping" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${online ? 'bg-[#34D399]' : 'bg-[#FBBF24]'}`}
              />
            </span>
            <span
              className={`text-[11px] font-medium tracking-wide ${online ? 'text-[#34D399]' : 'text-[#FBBF24]'}`}
            >
              SECURE HEALTH CORE: {online ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>

          <div className="text-right">
            <time
              dateTime={now.toISOString()}
              className="block text-lg font-medium leading-none tabular-nums text-[#E6EAF0]"
            >
              {timeFormatter.format(now)}
            </time>
            <span className="mt-1 block text-xs capitalize tabular-nums text-[#8A97A8]">
              {dateFormatter.format(now)}
            </span>
          </div>
        </footer>
      </section>
    </main>
  );
}
