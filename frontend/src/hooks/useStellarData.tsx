import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getDatos
} from '../services/getData';
import type { StellarData} from '../model/datosEstelares';

export function useData() {
  // const [landing_sites, setLandingSites] = useState<LandingSites[]>([])
  const [data, setData] = useState<StellarData|null>(null);
  const [activeId, setActiveId] = useState<string|null>(null);

  // const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  /**
  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await getLandingSites());
    } catch (err) {
      console.error('Error al recuperar los puntos de aterrizaje:', err);
      setError('No se pudieron cargar los puntos de aterrizaje.');
    }
  }, []);
  useEffect(() => {
    ().finally(() => setIsLoadingList(false));
  }, [refreshLandingSitres]);

  */
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
      const response = await getDatos(activeId);

      if (!cancelled) {
        setData(response);
      }
    } catch (err) {
      if (!cancelled) {
        console.error(
          'Error al recuperar los datos del punto de aterrizaje',
          err
        );
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
  }, 
  [activeId]);

  const handlePickLandingSite = async (siteId: string) => {
    try {
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
    isLoading: isLoading,
    error,
  };
}