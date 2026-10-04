import { useState } from "react";
import AdminDashboard from "./components/dashboard/AdminDashboard";
import LoginForm from "./components/dashboard/LoginForm";

/**
 * Sin sesión → pantalla de acceso. Con sesión → panel unificado.
 * Los datos los carga cada sección contra el backend real: aquí ya no hay datos de demostración.
 */
export default function App() {
  const [usuario, setUsuario] = useState(null);

  if (!usuario) return <LoginForm onLoginSuccess={setUsuario} />;

  return <AdminDashboard usuarioInicial={usuario} onSesionCerrada={() => setUsuario(null)} />;
}
