'use client';

import { useState } from 'react';
import {
  Database,
  ShieldOff,
  Code,
  Sparkles,
  Upload,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';

export default function WhySection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="text-center">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors mt-4 cursor-pointer"
      >
        How / why / what is this?
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* CSS grid for smooth height animation */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    All in one place
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Every AVL event source in one clean feed.
                  </p>
                </div>
                <div className="icon-circle">
                  <Database className="w-6 h-6 text-brand-600" />
                </div>
              </div>
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">No ads, ever</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No sponsors. No promotions. Free forever.
                  </p>
                </div>
                <div className="icon-circle">
                  <ShieldOff className="w-6 h-6 text-brand-600" />
                </div>
              </div>
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    Open source, open data
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    All data available via{' '}
                    <a
                      href="https://avlgo.com/api/export/json"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      JSON API
                    </a>
                    .
                  </p>
                </div>
                <div className="icon-circle">
                  <Code className="w-6 h-6 text-brand-600" />
                </div>
              </div>
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">AI-enhanced</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Auto-tags, smart search, similar events.
                  </p>
                </div>
                <div className="icon-circle">
                  <Sparkles className="w-6 h-6 text-brand-600" />
                </div>
              </div>
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    Easy for hosts
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    We&apos;ll grab your events automatically!
                  </p>
                </div>
                <div className="icon-circle">
                  <Upload className="w-6 h-6 text-brand-600" />
                </div>
              </div>
              <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    Your feed, your way
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Filter, customize, curate. Make it yours.
                  </p>
                </div>
                <div className="icon-circle">
                  <SlidersHorizontal className="w-6 h-6 text-brand-600" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
