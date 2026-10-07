import React from 'react';

export default class LimiteErrores extends React.Component {
  constructor(props) {
    super(props);
    this.state = { tieneError: false };
  }

  static getDerivedStateFromError(error) {
    return { tieneError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[panel] Error de render:", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.tieneError) {
      return (
        <div className="p-6 border border-red-900/40 bg-red-950/10 text-red-400 font-mono text-xs">
          <h3 className="font-bold uppercase mb-2">⚠️ Error de Renderizado Interno</h3>
          <p>La sección sufrió una caída visual. Revise la consola del navegador para adjuntar el componente afectado.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
