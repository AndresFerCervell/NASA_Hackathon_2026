import { useState } from 'react';
import { useData } from '../hooks/useStellarData';

export default function ConversationsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Toda la lógica de negocio y las llamadas a servicios viven en el hook
  const {
    activeId,
    setActiveId,
    data,
    handlePickLandingSite,
    isLoading,
    error
  } = useData();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-surface-bg)] text-[var(--color-text-main)] font-sans">

    </div>
  );
}