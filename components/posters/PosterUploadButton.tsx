'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import PosterUploadModal from './PosterUploadModal';

export default function PosterUploadButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors cursor-pointer"
      >
        <Upload size={16} />
        Upload a poster
      </button>

      <PosterUploadModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
