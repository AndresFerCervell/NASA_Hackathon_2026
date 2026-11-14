import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainPage from './pages/mainPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta Raíz ('/'): Aquí es donde se muestra tu chat al desplegar */}
        <Route path="/" element={<MainPage />} />

        {/* Redirección de seguridad: si escriben cualquier otra ruta inventada, los manda al chat */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}