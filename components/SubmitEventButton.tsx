'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import SubmitEventModal from './SubmitEventModal';

export default function SubmitEventButton({ className }: { className: string }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={className}
        aria-label="Submit an event"
        title="Submit an event"
      >
        <Plus size={16} />
      </button>

      <SubmitEventModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
