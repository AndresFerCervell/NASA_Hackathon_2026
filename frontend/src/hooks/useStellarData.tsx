import { useCallback, useRef, useState } from 'react';
import { getDatos, type GetDatosOptions } from '../services/getData';
import type { StellarData } from '../model/datosEstelares';

export function useData() {
  const [data, setData] = useState<StellarData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const handlePickLandingSite = useCallback(
    async (siteId: string, options: GetDatosOptions = {}): Promise<StellarData | null> => {
      const seq = ++requestSeqRef.current;
      setActiveId(siteId);
      setData(null);
      setError(null);
      setIsLoading(true);

      try {
        const response = await getDatos(siteId, options);
        if (requestSeqRef.current === seq) {
          setData(response);
        }
        return response;
      } catch (err) {
        if (requestSeqRef.current === seq) {
          console.error('Failed to fetch landing site data', err);
          setError('Could not load site data.');
        }
        return null;
      } finally {
        if (requestSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  return {
    activeId,
    setActiveId,
    data,
    handlePickLandingSite,
    isLoading,
    error,
  };
}