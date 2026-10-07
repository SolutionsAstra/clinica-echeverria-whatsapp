import React, { useState, useEffect } from 'react';
import LoginForm from './components/dashboard/LoginForm';
import AdminDashboard from './components/dashboard/AdminDashboard';
import LimiteErrores from './components/dashboard/ui/LimiteErrores';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // Verificar si el operador ya tiene una sesión abierta en Express
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setUsuario(data);
        setCargando(false);
      })
      .catch(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0B192C] font-mono text-xs text-[#7D8BA0]">
        SINCRO CORING INFRASTRUCTURE...
      </div>
    );
  }

  if (!usuario) {
    return <LoginForm onLoginSuccess={(usr) => setUsuario(usr)} />;
  }

  return (
    <LimiteErrores>
      <AdminDashboard usuarioActual={usuario} onLogout={() => setUsuario(null)} />
    </LimiteErrores>
  );
}
