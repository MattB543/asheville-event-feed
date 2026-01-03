'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import SubmitEventModal from './SubmitEventModal';

export default function SubmitEventButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        aria-label="Submit an event"
        title="Submit an event"
      >
        <Plus size={16} className="text-gray-600 dark:text-gray-300" />
      </button>

      <SubmitEventModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
