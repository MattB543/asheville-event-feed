"use client";

import { X, Loader2, Send } from "lucide-react";
import { useState, FormEvent } from "react";
import { useToast } from "./ui/Toast";

interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  organizer: string;
  price: string;
  url: string;
  description: string;
  submitterEmail: string;
  submitterName: string;
  notes: string;
}

const initialFormData: FormData = {
  title: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  location: "",
  organizer: "",
  price: "",
  url: "",
  description: "",
  submitterEmail: "",
  submitterName: "",
  notes: "",
};

export default function SubmitEventModal({
  isOpen,
  onClose,
}: SubmitEventModalProps) {
  const { showToast } = useToast();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFieldError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    // Basic client-side validation
    if (!formData.title.trim()) {
      setFieldError("title");
      return;
    }
    if (!formData.startDate) {
      setFieldError("startDate");
      return;
    }

    setIsSubmitting(true);

    try {
      // Build ISO datetime string
      const startDateTime = formData.startTime
        ? `${formData.startDate}T${formData.startTime}:00`
        : `${formData.startDate}T00:00:00`;

      let endDateTime: string | undefined;
      if (formData.endDate) {
        endDateTime = formData.endTime
          ? `${formData.endDate}T${formData.endTime}:00`
          : `${formData.endDate}T23:59:59`;
      }

      const response = await fetch("/api/events/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title.trim(),
          startDate: startDateTime,
          endDate: endDateTime,
          location: formData.location.trim() || undefined,
          organizer: formData.organizer.trim() || undefined,
          price: formData.price.trim() || undefined,
          url: formData.url.trim() || undefined,
          description: formData.description.trim() || undefined,
          submitterEmail: formData.submitterEmail.trim() || undefined,
          submitterName: formData.submitterName.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.field) {
          setFieldError(result.field);
        }
        showToast(result.error || "Failed to submit event", "error");
        return;
      }

      showToast("Event submitted! We'll review it soon.", "success");
      setFormData(initialFormData);
      onClose();
    } catch {
      showToast("Failed to submit event. Please try again.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Submit an Event
          </h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* API Info */}
          <div className="p-3 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-lg text-sm">
            <p className="text-brand-800 dark:text-brand-200">
              You can also submit events via our API.{" "}
              <a
                href="/api/events/submit"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-brand-600 dark:hover:text-brand-300"
              >
                View documentation
              </a>
            </p>
          </div>

          {/* Event Title */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
            >
              Event Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={formData.title}
              onChange={(e) => handleChange("title", e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
                fieldError === "title"
                  ? "border-red-500"
                  : "border-gray-300 dark:border-gray-600"
              }`}
              placeholder="e.g., Live Music at The Orange Peel"
              disabled={isSubmitting}
            />
            {fieldError === "title" && (
              <p className="mt-1 text-sm text-red-500">
                Event title is required
              </p>
            )}
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="startDate"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="startDate"
                value={formData.startDate}
                onChange={(e) => handleChange("startDate", e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
                  fieldError === "startDate"
                    ? "border-red-500"
                    : "border-gray-300 dark:border-gray-600"
                }`}
                disabled={isSubmitting}
              />
              {fieldError === "startDate" && (
                <p className="mt-1 text-sm text-red-500">
                  Start date is required
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="startTime"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Start Time
              </label>
              <input
                type="time"
                id="startTime"
                value={formData.startTime}
                onChange={(e) => handleChange("startTime", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="endDate"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                End Date
              </label>
              <input
                type="date"
                id="endDate"
                value={formData.endDate}
                onChange={(e) => handleChange("endDate", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label
                htmlFor="endTime"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                End Time
              </label>
              <input
                type="time"
                id="endTime"
                value={formData.endTime}
                onChange={(e) => handleChange("endTime", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
            >
              Location
            </label>
            <input
              type="text"
              id="location"
              value={formData.location}
              onChange={(e) => handleChange("location", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="e.g., The Orange Peel, 101 Biltmore Ave"
              disabled={isSubmitting}
            />
          </div>

          {/* Organizer and Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="organizer"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Organizer
              </label>
              <input
                type="text"
                id="organizer"
                value={formData.organizer}
                onChange={(e) => handleChange("organizer", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                placeholder="e.g., Local Arts Collective"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label
                htmlFor="price"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Price
              </label>
              <input
                type="text"
                id="price"
                value={formData.price}
                onChange={(e) => handleChange("price", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                placeholder="e.g., Free, $15, $10-$25"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Event URL */}
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
            >
              Event URL
            </label>
            <input
              type="url"
              id="url"
              value={formData.url}
              onChange={(e) => handleChange("url", e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
                fieldError === "url"
                  ? "border-red-500"
                  : "border-gray-300 dark:border-gray-600"
              }`}
              placeholder="https://example.com/event"
              disabled={isSubmitting}
            />
            {fieldError === "url" && (
              <p className="mt-1 text-sm text-red-500">
                Please enter a valid URL
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
            >
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
              placeholder="Tell us about the event..."
              disabled={isSubmitting}
            />
          </div>

          {/* Submitter Info */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Optional: Your contact info (in case we have questions)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="submitterName"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
                >
                  Your Name
                </label>
                <input
                  type="text"
                  id="submitterName"
                  value={formData.submitterName}
                  onChange={(e) =>
                    handleChange("submitterName", e.target.value)
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label
                  htmlFor="submitterEmail"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
                >
                  Your Email
                </label>
                <input
                  type="email"
                  id="submitterEmail"
                  value={formData.submitterEmail}
                  onChange={(e) =>
                    handleChange("submitterEmail", e.target.value)
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
                    fieldError === "submitterEmail"
                      ? "border-red-500"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                  disabled={isSubmitting}
                />
                {fieldError === "submitterEmail" && (
                  <p className="mt-1 text-sm text-red-500">
                    Please enter a valid email
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
            >
              Additional Notes
            </label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
              placeholder="Anything else we should know?"
              disabled={isSubmitting}
            />
          </div>
        </form>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Events are reviewed before publishing
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm bg-brand-600 text-white hover:bg-brand-700 rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Submit Event
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
