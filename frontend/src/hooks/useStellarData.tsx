import { useEffect, useState } from 'react';
import { getDatos, type GetDatosOptions } from '../services/getData';
import type { StellarData } from '../model/datosEstelares';

export function useData() {
  const [data, setData] = useState<StellarData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeOptions, setActiveOptions] = useState<GetDatosOptions>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setData(null);
    setError(null);
    setIsLoading(true);

    const fetchData = async () => {
      try {
        const response = await getDatos(activeId, activeOptions);
        if (!cancelled) {
          setData(response);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error al recuperar los datos del punto de aterrizaje', err);
          setError('No se pudieron cargar los datos.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [activeId, activeOptions]);

  const handlePickLandingSite = (siteId: string, options: GetDatosOptions = {}) => {
    try {
      setActiveOptions(options);
      setActiveId(siteId);
    } catch (err) {
      console.error('Error al seleccionar sitio de aterrizaje:', err);
      setError('No se pudo abrir el sitio de aterrizaje.');
    }
  };

  return {
    activeId,
    setActiveId,
    data,
    handlePickLandingSite,
    isLoading,
    error,
  };
}