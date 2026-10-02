import React, { useState, useEffect } from 'react';
import LoginForm from './components/dashboard/LoginForm';
import WorkspaceDashboard from './components/dashboard/WorkspaceDashboard';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [derivaciones, setDerivaciones] = useState([]);
  const [proximasCitas, setProximasCitas] = useState([]);

  // Cada vez que la recepcionista inicia sesión con éxito, cargamos los flujos de Supabase
  useEffect(() => {
    if (!usuario) return;

    const cargarDatosPanel = async () => {
      try {
        // 1. Cargar las solicitudes de la IA desde el backend real
        const resDerivaciones = await fetch('/api/derivaciones');
        const dataDerivaciones = await resDerivaciones.json();

        // 2. Cargar las próximas citas médicas del día
        const mockCitas = [
          { id: 1, paciente: 'Carlos Mendoza', hora: '10:00 AM', especialidad: 'neurologia', doctor: 'Dr. Rojas', confirmado: true },
          { id: 2, paciente: 'Sofía Valentina', hora: '11:30 AM', especialidad: 'pediatria', doctor: 'Dra. Salas', confirmado: false },
          { id: 3, paciente: 'Marcos Castillo', hora: '02:00 PM', especialidad: 'eeg', doctor: 'Sala EEG', confirmado: true }
        ];

        setDerivaciones(Array.isArray(dataDerivaciones) ? dataDerivaciones : dataDerivaciones.derivaciones || []);
        setProximasCitas(mockCitas);
      } catch (err) {
        console.error('Error cargando los flujos del Dashboard:', err);
      }
    };

    cargarDatosPanel();
  }, [usuario]);

  // Si no hay sesión activa, forzamos la pantalla de acceso premium
  if (!usuario) {
    return <LoginForm onLoginSuccess={(usr) => setUsuario(usr)} />;
  }

  // Al autenticarse, damos paso al Workspace unificado de 3 columnas
  return (
    <WorkspaceDashboard 
      usuarioActual={usuario} 
      solicitudesIniciales={derivaciones}
      proximasCitasIniciales={proximasCitas}
      onLogout={() => setUsuario(null)} 
    />
  );
}
