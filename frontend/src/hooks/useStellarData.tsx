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
          console.error('Failed to fetch landing site data', err);
          setError('Could not load site data.');
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
      console.error('Failed to select landing site:', err);
      setError('Could not open landing site.');
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