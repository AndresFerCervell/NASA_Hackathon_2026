import { useCallback, useRef, useState } from 'react';
import { getDatos, type GetDatosOptions } from '../services/getData';
import type { StellarData } from '../model/datosEstelares';

export function useData() {
  const [data, setData] = useState<StellarData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isWakingUp, setIsWakingUp] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const handlePickLandingSite = useCallback(
    async (siteId: string, options: GetDatosOptions = {}): Promise<StellarData | null> => {
      const seq = ++requestSeqRef.current;
      setActiveId(siteId);
      setData(null);
      setError(null);
      setIsLoading(true);
      setIsWakingUp(false);

      const slowTimer = window.setTimeout(() => {
        if (requestSeqRef.current === seq) {
          setIsWakingUp(true);
        }
      }, 15000);

      try {
        const response = await getDatos(siteId, {
          ...options,
          onWakeupNotice: () => {
            if (requestSeqRef.current === seq) {
              setIsWakingUp(true);
            }
            options.onWakeupNotice?.();
          },
        });
        if (requestSeqRef.current === seq) {
          setData(response);
        }
        return response;
      } catch (err) {
        if (requestSeqRef.current === seq) {
          console.error('Failed to fetch landing site data', err);
          setError('Could not reach the simulation backend. Please try again.');
        }
        return null;
      } finally {
        window.clearTimeout(slowTimer);
        if (requestSeqRef.current === seq) {
          setIsLoading(false);
          setIsWakingUp(false);
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
    isWakingUp,
    error,
  };
}