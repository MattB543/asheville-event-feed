'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import ConfirmSubmitModal from '@/components/matching/ConfirmSubmitModal';
import type { MatchingFlowStep } from '@/lib/matching/flow';
import { getMatchingFlowPath } from '@/lib/matching/flow';
import {
  getQuestionOptionLabel,
  parseMatchingQuestionConfig,
  type MatchingInputType,
  type MatchingSurveyPhaseKey,
} from '@/lib/matching/questions';
import { getMatchingProgramConfig, type MatchingProgram } from '@/lib/matching/programs';

const SUPPORT_EMAIL = 'support@avlgo.com';

type AnswerState = {
  answerText?: string;
  answerJson?: string[];
};

interface MatchingProfile {
  id: string;
  userId: string;
  program: string;
  displayName: string | null;
  email: string | null;
  source: string | null;
  aiMatching: boolean;
  consentAt: string | null;
  consentVersion: string | null;
  status: 'draft' | 'submitted';
  allowEditing: boolean;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MatchingQuestion {
  id: string;
  program: string;
  version: string;
  section: 'passive' | 'survey';
  order: number;
  prompt: string;
  helpText: string | null;
  required: boolean;
  inputType: MatchingInputType;
  maxLength: number | null;
  configJson: unknown;
  websearch: boolean;
  active: boolean;
}

interface MatchingAnswer {
  id: string;
  profileId: string;
  questionId: string;
  answerText: string | null;
  answerJson: unknown;
}

interface ProfileResponse {
  profile: MatchingProfile | null;
  answers: MatchingAnswer[];
  questions: MatchingQuestion[];
  version: string | null;
}

interface MatchingOnboardingClientProps {
  program: MatchingProgram;
  currentStep: MatchingFlowStep;
  defaultDisplayName: string;
  defaultEmail: string | null;
  entrySource?: string | null;
}

function getMaxItemsForQuestion(question: MatchingQuestion): number {
  const config = parseMatchingQuestionConfig(question.configJson);
  if (
    typeof config.maxSelections === 'number' &&
    (question.inputType === 'multi_select' || question.inputType === 'ranking')
  ) {
    return config.maxSelections;
  }
  if (question.inputType === 'multi_url') return question.id.includes('links_about_you') ? 5 : 10;
  if (question.inputType === 'multi_text')
    return question.id.includes('links_about_topics') ? 10 : 20;
  return 20;
}

function getChoiceGridClass(optionCount: number, configuredColumns?: number): string {
  // For questions with many choices, use flex-wrap on all screen sizes
  // so buttons auto-size based on content and fit more per row
  if (optionCount > 5) {
    return 'flex flex-wrap gap-2';
  }

  // For fewer choices, use grid layout on desktop
  const columns = typeof configuredColumns === 'number' ? configuredColumns : 2;

  if (columns >= 3) {
    return 'flex flex-wrap gap-2 sm:grid sm:gap-3 sm:grid-cols-3';
  }

  return 'flex flex-wrap gap-2 sm:grid sm:gap-3 sm:grid-cols-2';
}

export default function MatchingOnboardingClient({
  program,
  currentStep,
  defaultDisplayName,
  defaultEmail,
  entrySource,
}: MatchingOnboardingClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const programConfig = getMatchingProgramConfig(program);
  const currentPath = getMatchingFlowPath(currentStep, program);

  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<MatchingProfile | null>(null);
  const [questions, setQuestions] = useState<MatchingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [version, setVersion] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [aiMatching, setAiMatching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [multiValueState, setMultiValueState] = useState<
    Record<string, { id: string; value: string }[]>
  >({});
  const [showResumeTextarea, setShowResumeTextarea] = useState(false);
  const [imageTranscribing, setImageTranscribing] = useState<Record<string, boolean>>({});
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string[]>>({});

  const answersRef = useRef(answers);
  const displayNameRef = useRef(displayName);
  const aiMatchingRef = useRef(aiMatching);
  const profileDirtyRef = useRef(false);
  const answersDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const isSubmitted = profile?.status === 'submitted';
  const isEditLocked = profile ? !profile.allowEditing : false;
  const canEdit = !isEditLocked;
  const getQuestionConfig = useCallback(
    (question: MatchingQuestion) => parseMatchingQuestionConfig(question.configJson),
    []
  );

  const passiveQuestions = useMemo(
    () =>
      questions
        .filter((question) => question.section === 'passive')
        .sort((a, b) => a.order - b.order),
    [questions]
  );
  const surveyQuestions = useMemo(
    () =>
      questions
        .filter((question) => question.section === 'survey')
        .sort((a, b) => a.order - b.order),
    [questions]
  );
  const surveyQuestionsByPhase = useMemo(() => {
    const groups: Record<MatchingSurveyPhaseKey, MatchingQuestion[]> = {
      phase1: [],
      phase2: [],
    };

    surveyQuestions.forEach((question) => {
      const phase = getQuestionConfig(question).phase ?? 'phase1';
      groups[phase].push(question);
    });

    return groups;
  }, [getQuestionConfig, surveyQuestions]);

  const makeRowId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

  const redirectToLogin = useCallback(() => {
    router.push(`/login?next=${encodeURIComponent(currentPath)}`);
  }, [currentPath, router]);

  const markProfileDirty = () => {
    if (!canEdit) return;
    profileDirtyRef.current = true;
  };

  const answerHasValue = useCallback(
    (question: MatchingQuestion, answer: AnswerState | undefined): boolean => {
      if (!answer) return false;
      if (
        question.inputType === 'multi_url' ||
        question.inputType === 'multi_text' ||
        question.inputType === 'multi_select' ||
        question.inputType === 'ranking' ||
        question.inputType === 'multi_image'
      ) {
        return Array.isArray(answer.answerJson)
          ? answer.answerJson.some((item) => item.trim().length > 0)
          : false;
      }

      return typeof answer.answerText === 'string' ? answer.answerText.trim().length > 0 : false;
    },
    []
  );

  const answeredSurveyCount = useMemo(
    () =>
      surveyQuestions.filter((question) => answerHasValue(question, answers[question.id])).length,
    [answerHasValue, answers, surveyQuestions]
  );

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/matching/profile?program=${program}`);
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load profile');
      }

      const data = (await response.json()) as ProfileResponse;
      setProfile(data.profile);
      setQuestions(data.questions);
      setVersion(data.version);
      setDisplayName(data.profile?.displayName || defaultDisplayName);
      setAiMatching(
        typeof data.profile?.aiMatching === 'boolean' ? data.profile.aiMatching : false
      );

      const currentQuestionIds = new Set(data.questions.map((question) => question.id));
      const nextAnswers: Record<string, AnswerState> = {};
      const nextMultiState: Record<string, { id: string; value: string }[]> = {};

      data.answers.forEach((answer) => {
        if (!currentQuestionIds.has(answer.questionId)) {
          return;
        }

        const answerJson = Array.isArray(answer.answerJson)
          ? answer.answerJson.filter((item): item is string => typeof item === 'string')
          : undefined;
        nextAnswers[answer.questionId] = {
          answerText: answer.answerText ?? '',
          answerJson,
        };
        if (answerJson && answerJson.length > 0) {
          nextMultiState[answer.questionId] = answerJson.map((value) => ({
            id: makeRowId(),
            value,
          }));
        }
      });

      setAnswers(nextAnswers);
      setMultiValueState(nextMultiState);
      setLastSavedAt(data.profile?.updatedAt ? new Date(data.profile.updatedAt) : null);
    } catch (error) {
      console.error('Error loading profile:', error);
      showToast('Failed to load matching profile', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [defaultDisplayName, makeRowId, program, redirectToLogin, showToast]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  useEffect(() => {
    aiMatchingRef.current = aiMatching;
  }, [aiMatching]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (profileDirtyRef.current || answersDirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;

    setMultiValueState((prev) => {
      let changed = false;
      const next = { ...prev };

      questions
        .filter(
          (question) => question.inputType === 'multi_url' || question.inputType === 'multi_text'
        )
        .forEach((question) => {
          if (!next[question.id] || next[question.id].length === 0) {
            const existing = answersRef.current[question.id]?.answerJson;
            if (Array.isArray(existing) && existing.length > 0) {
              next[question.id] = existing.map((value) => ({ id: makeRowId(), value }));
            } else {
              next[question.id] = [{ id: makeRowId(), value: '' }];
            }
            changed = true;
          }
        });

      return changed ? next : prev;
    });
  }, [makeRowId, questions]);

  const updateAnswer = useCallback(
    (questionId: string, update: AnswerState) => {
      if (!canEdit) return;
      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          ...update,
        },
      }));
      answersDirtyRef.current = true;
    },
    [canEdit]
  );

  const syncMultiValues = useCallback(
    (questionId: string, rows: { id: string; value: string }[]) => {
      if (!canEdit) return;
      updateAnswer(questionId, { answerJson: rows.map((row) => row.value) });
    },
    [canEdit, updateAnswer]
  );

  const updateMultiValue = (questionId: string, index: number, value: string) => {
    if (!canEdit) return;
    setMultiValueState((prev) => {
      const current = prev[questionId] ?? [];
      const next = [...current];
      if (!next[index]) {
        next[index] = { id: makeRowId(), value };
      } else {
        next[index] = { ...next[index], value };
      }
      syncMultiValues(questionId, next);
      return { ...prev, [questionId]: next };
    });
  };

  const addMultiValueRow = (question: MatchingQuestion) => {
    if (!canEdit) return;
    const maxItems = getMaxItemsForQuestion(question);

    setMultiValueState((prev) => {
      const current = prev[question.id] ?? [];
      if (current.length >= maxItems) return prev;
      const next = [...current, { id: makeRowId(), value: '' }];
      syncMultiValues(question.id, next);
      return { ...prev, [question.id]: next };
    });
  };

  const removeMultiValueRow = (questionId: string, index: number) => {
    if (!canEdit) return;
    setMultiValueState((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      const ensured = next.length > 0 ? next : [{ id: makeRowId(), value: '' }];
      syncMultiValues(questionId, ensured);
      return { ...prev, [questionId]: ensured };
    });
  };

  const saveProfile = useCallback(async () => {
    const response = await fetch('/api/matching/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program,
        displayName: displayNameRef.current,
        aiMatching: aiMatchingRef.current,
        consentVersion: version ?? undefined,
        source: entrySource ?? undefined,
      }),
    });

    if (response.status === 401) {
      redirectToLogin();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Failed to save profile');
    }

    const data = (await response.json()) as { profile: MatchingProfile };
    setProfile(data.profile);
    profileDirtyRef.current = false;
  }, [entrySource, program, redirectToLogin, version]);

  const saveAnswers = useCallback(async () => {
    if (!version) return;

    const currentQuestionIds = new Set(questions.map((question) => question.id));
    const payload = Object.entries(answersRef.current)
      .filter(([questionId]) => currentQuestionIds.has(questionId))
      .map(([questionId, value]) => ({
        questionId,
        answerText: typeof value.answerText === 'string' ? value.answerText : undefined,
        answerJson: Array.isArray(value.answerJson) ? value.answerJson : undefined,
      }));

    if (payload.length === 0) return;

    const response = await fetch('/api/matching/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program, version, answers: payload }),
    });

    if (response.status === 401) {
      redirectToLogin();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || 'Failed to save answers');
    }

    answersDirtyRef.current = false;
  }, [program, questions, redirectToLogin, version]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return true;

    if (saveInFlightRef.current) {
      // Wait for in-flight save to finish (poll every 100ms, up to 2s)
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!saveInFlightRef.current) break;
      }
      // If still in-flight after 2s, give up waiting
      if (saveInFlightRef.current) return false;
      // After the in-flight save finished, check if still dirty
      if (!profileDirtyRef.current && !answersDirtyRef.current) return true;
    }

    if (!profileDirtyRef.current && !answersDirtyRef.current) return true;

    saveInFlightRef.current = true;
    setIsAutosaving(true);

    try {
      if (profileDirtyRef.current) {
        await saveProfile();
      }
      if (answersDirtyRef.current) {
        await saveAnswers();
      }
      setLastSavedAt(new Date());
      return true;
    } catch (error) {
      console.error('Autosave failed:', error);
      showToast('Autosave failed. Your changes are still here.', 'error');
      return false;
    } finally {
      setIsAutosaving(false);
      saveInFlightRef.current = false;
    }
  }, [canEdit, saveAnswers, saveProfile, showToast]);

  useEffect(() => {
    if (!canEdit || !version) return;

    const interval = setInterval(() => {
      if (profileDirtyRef.current || answersDirtyRef.current) {
        void saveDraft();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [canEdit, saveDraft, version]);

  const goToStep = useCallback(
    async (step: MatchingFlowStep, saveBeforeRouteChange: boolean) => {
      if (saveBeforeRouteChange) {
        const saved = await saveDraft();
        if (!saved) return;
      }
      router.push(getMatchingFlowPath(step, program));
    },
    [program, router, saveDraft]
  );

  const validateConsent = useCallback(() => {
    const nextErrors: Record<string, string> = {};
    if (!displayName.trim()) {
      nextErrors.displayName = 'Display name is required.';
    } else if (displayName.trim().length > 50) {
      nextErrors.displayName = 'Display name must be 50 characters or fewer.';
    }
    if (!aiMatching) {
      nextErrors.consent = 'You must agree before continuing.';
    }
    setErrors((prev) => ({ ...prev, ...nextErrors }));
    return Object.keys(nextErrors).length === 0;
  }, [aiMatching, displayName]);

  const validateForSubmit = useCallback(() => {
    const nextErrors: Record<string, string> = {};

    if (!displayName.trim()) {
      nextErrors.displayName = 'Display name is required.';
    }
    if (!aiMatching) {
      nextErrors.consent = 'You must agree before submitting.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [aiMatching, displayName]);

  const handleResumeUpload = async (file: File, questionId: string) => {
    if (!canEdit) return;

    if (file.type !== 'application/pdf') {
      showToast('Please upload a PDF file.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('File is too large. Maximum size is 10 MB.', 'error');
      return;
    }

    setIsParsingResume(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/matching/resume', {
        method: 'POST',
        body: formData,
      });

      const data = (await response.json()) as {
        markdown?: string;
        truncated?: boolean;
        error?: string;
      };
      if (!response.ok || !data.markdown) {
        throw new Error(data.error || 'Resume parsing failed');
      }

      updateAnswer(questionId, { answerText: data.markdown });
      showToast(
        data.truncated
          ? 'Resume parsed. We trimmed it to fit the limit.'
          : 'Resume parsed successfully.',
        'success'
      );
    } catch (error) {
      console.error('Resume upload failed:', error);
      showToast('Failed to parse resume. You can paste text manually.', 'error');
    } finally {
      setIsParsingResume(false);
    }
  };

  const compressImage = useCallback(async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX_DIM = 2048;
        let { naturalWidth: w, naturalHeight: h } = img;

        if (w > MAX_DIM || h > MAX_DIM) {
          const scale = MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Compression failed'));
          },
          'image/jpeg',
          0.85
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };

      img.src = objectUrl;
    });
  }, []);

  const handleImageUpload = async (files: FileList, questionId: string) => {
    if (!canEdit) return;
    const config = parseMatchingQuestionConfig(
      questions.find((q) => q.id === questionId)?.configJson
    );
    const maxImages = config.maxImages ?? 5;

    const fileArray = Array.from(files).slice(0, maxImages);
    const validFiles = fileArray.filter((f) => f.type.startsWith('image/'));

    if (validFiles.length === 0) {
      showToast('Please select image files (JPEG, PNG, etc.)', 'error');
      return;
    }

    // Create preview URLs
    const previewUrls = validFiles.map((f) => URL.createObjectURL(f));
    setImagePreviewUrls((prev) => ({ ...prev, [questionId]: previewUrls }));
    setImageTranscribing((prev) => ({ ...prev, [questionId]: true }));

    try {
      // Compress images client-side
      const compressed = await Promise.all(validFiles.map(compressImage));

      // Send to transcription API
      const formData = new FormData();
      compressed.forEach((blob, i) => {
        formData.append('images', blob, `bookshelf-${i + 1}.jpg`);
      });
      if (config.aiPrompt) {
        formData.append('aiPrompt', config.aiPrompt);
      }

      const response = await fetch('/api/matching/transcribe-images', {
        method: 'POST',
        body: formData,
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      const data = (await response.json()) as {
        books?: { title: string; author: string | null }[];
        notes?: string | null;
        parseError?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process images');
      }

      if (data.parseError) {
        showToast('Something went wrong analyzing your photos. Please try again.', 'error');
      } else if (data.books && data.books.length > 0) {
        const bookStrings = data.books.map((b) =>
          b.author ? `${b.title} - ${b.author}` : b.title
        );
        updateAnswer(questionId, { answerJson: bookStrings });
        showToast(
          `Found ${data.books.length} book${data.books.length === 1 ? '' : 's'}!`,
          'success'
        );
      } else {
        showToast('No books detected. Try clearer or closer photos.', 'info');
      }
    } catch (error) {
      console.error('Image transcription failed:', error);
      showToast('Failed to process images. Please try again.', 'error');
    } finally {
      setImageTranscribing((prev) => ({ ...prev, [questionId]: false }));
      // Clean up preview URLs after a delay (let user see them briefly)
      setTimeout(() => {
        setImagePreviewUrls((prev) => {
          const urls = prev[questionId];
          if (urls) urls.forEach((url) => URL.revokeObjectURL(url));
          const next = { ...prev };
          delete next[questionId];
          return next;
        });
      }, 2000);
    }
  };

  const removeBookFromAnswer = (questionId: string, index: number) => {
    if (!canEdit) return;
    const current = answers[questionId]?.answerJson ?? [];
    const next = current.filter((_, i) => i !== index);
    updateAnswer(questionId, { answerJson: next.length > 0 ? next : undefined });
  };

  const handleIntroContinue = async () => {
    if (!profile || (entrySource && !profile.source)) {
      markProfileDirty();
      const saved = await saveDraft();
      if (!saved) return;
    }
    await goToStep('consent', false);
  };

  const handleConsentContinue = async () => {
    const isValid = validateConsent();
    if (!isValid) {
      showToast('Please complete your consent details.', 'error');
      return;
    }

    markProfileDirty();
    const saved = await saveDraft();
    if (!saved) return;
    await goToStep('questions', false);
  };

  const handleSubmitClick = async () => {
    const isValid = validateForSubmit();
    if (!isValid) {
      showToast('Please complete your consent details before submitting.', 'error');
      return;
    }

    if (answeredSurveyCount === 1) {
      showToast(programConfig.betterAnswerHint, 'info');
    }

    const saved = await saveDraft();
    if (!saved) return;
    setConfirmOpen(true);
  };

  const confirmSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/matching/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program }),
      });
      const data = (await response.json()) as { profile?: MatchingProfile; error?: string };

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (!response.ok || !data.profile) {
        throw new Error(data.error || 'Failed to submit profile');
      }

      setProfile(data.profile);
      setConfirmOpen(false);
      showToast('Profile submitted successfully!', 'success');
      router.push(getMatchingFlowPath('confirmation', program));
    } catch (error) {
      console.error('Submit failed:', error);
      showToast('Submission failed. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderAutosaveStatus = () => {
    if (isAutosaving) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Autosaving...
        </div>
      );
    }

    if (lastSavedAt) {
      return (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Saved {lastSavedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      );
    }

    return null;
  };

  const renderSummaryAnswer = (question: MatchingQuestion) => {
    const answer = answers[question.id];
    const config = getQuestionConfig(question);
    if (!answerHasValue(question, answer)) return null;

    if (
      question.inputType === 'multi_url' ||
      question.inputType === 'multi_text' ||
      question.inputType === 'multi_select' ||
      question.inputType === 'ranking' ||
      question.inputType === 'multi_image'
    ) {
      const list = Array.isArray(answer?.answerJson) ? answer.answerJson.filter(Boolean) : [];
      return (
        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {list.map((item, index) => (
            <li key={`${question.id}-${item}`} className="break-words">
              {question.inputType === 'ranking' ? `${index + 1}. ` : ''}
              {getQuestionOptionLabel(config, item)}
            </li>
          ))}
        </ul>
      );
    }

    if (question.inputType === 'single_select') {
      return (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {getQuestionOptionLabel(config, answer?.answerText?.trim() ?? '')}
        </p>
      );
    }

    if (question.inputType === 'slider') {
      const value = answer?.answerText?.trim() ?? '';
      const max = config.sliderMax ?? 10;

      return (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {value} / {max}
          {config.minLabel && config.maxLabel ? ` (${config.minLabel} -> ${config.maxLabel})` : ''}
        </p>
      );
    }

    return (
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {answer?.answerText?.trim()}
      </p>
    );
  };

  const renderQuestionFields = (
    question: MatchingQuestion,
    options?: {
      showChoiceMeta?: boolean;
    }
  ) => {
    const questionAnswer = answers[question.id];
    const config = getQuestionConfig(question);
    const showChoiceMeta = options?.showChoiceMeta ?? true;

    if (question.inputType === 'long_text' || question.inputType === 'short_text') {
      const value = questionAnswer?.answerText ?? '';

      return (
        <textarea
          value={value}
          disabled={!canEdit}
          onChange={(event) => updateAnswer(question.id, { answerText: event.target.value })}
          rows={question.inputType === 'short_text' ? 3 : 4}
          maxLength={question.maxLength ?? undefined}
          placeholder={config.placeholder}
          className={`w-full px-3 py-2 text-[15px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            canEdit
              ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
          }`}
        />
      );
    }

    if (question.inputType === 'url') {
      return (
        <input
          type="url"
          value={questionAnswer?.answerText ?? ''}
          disabled={!canEdit}
          onChange={(event) => updateAnswer(question.id, { answerText: event.target.value })}
          placeholder={config.placeholder || 'https://...'}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            canEdit
              ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
          }`}
        />
      );
    }

    if (question.inputType === 'file_markdown') {
      const resumeText = questionAnswer?.answerText ?? '';
      const textareaVisible = showResumeTextarea || resumeText.trim().length > 0;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm ${
                canEdit
                  ? 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              }`}
            >
              <Upload className="w-4 h-4" />
              <span>{isParsingResume ? 'Parsing...' : 'Upload PDF'}</span>
              <input
                type="file"
                accept="application/pdf"
                disabled={!canEdit || isParsingResume}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleResumeUpload(file, question.id);
                    event.target.value = '';
                  }
                }}
              />
            </label>
            {!textareaVisible && canEdit && (
              <button
                onClick={() => setShowResumeTextarea(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                Paste text
              </button>
            )}
          </div>
          {isParsingResume && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Parsing your resume...
            </div>
          )}
          {textareaVisible && (
            <textarea
              value={resumeText}
              disabled={!canEdit}
              onChange={(event) => updateAnswer(question.id, { answerText: event.target.value })}
              rows={8}
              maxLength={question.maxLength ?? 20000}
              placeholder={config.placeholder || 'Paste resume text here'}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                canEdit
                  ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            />
          )}
        </div>
      );
    }

    if (question.inputType === 'single_select') {
      const options = config.options ?? [];
      const selectedValue = questionAnswer?.answerText ?? '';
      const choiceGridClass = getChoiceGridClass(options.length, config.gridColumns);

      return (
        <div className={choiceGridClass}>
          {options.map((option) => {
            const isSelected = selectedValue === option.value;

            return (
              <button
                key={option.value}
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  updateAnswer(question.id, {
                    answerText: isSelected ? '' : option.value,
                    answerJson: undefined,
                  })
                }
                className={`rounded-lg sm:rounded-xl border px-3 py-2 sm:p-4 text-left transition-colors ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-brand-900 dark:text-brand-100'
                    : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
                } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
              >
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  <span className="text-xs sm:text-sm font-medium">{option.label}</span>
                  {isSelected && <CheckCircle className="w-4 h-4 shrink-0 text-brand-600" />}
                </div>
                {option.description && (
                  <p className="mt-1 sm:mt-2 text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                    {option.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      );
    }

    if (question.inputType === 'multi_select' || question.inputType === 'ranking') {
      const options = config.options ?? [];
      const selectedValues = Array.isArray(questionAnswer?.answerJson)
        ? questionAnswer.answerJson
        : [];
      const maxSelections =
        config.maxSelections ?? (question.inputType === 'ranking' ? 3 : options.length);
      const choiceGridClass = getChoiceGridClass(options.length, config.gridColumns);

      const toggleValue = (value: string) => {
        if (!canEdit) return;

        const isSelected = selectedValues.includes(value);
        let nextValues = selectedValues.filter((item) => item !== value);

        if (!isSelected && nextValues.length < maxSelections) {
          nextValues = [...nextValues, value];
        }

        updateAnswer(question.id, { answerJson: nextValues, answerText: undefined });
      };

      return (
        <div className="space-y-3">
          {showChoiceMeta && question.inputType === 'ranking' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tap in the order you prefer. Tap again to remove.
            </p>
          )}
          {showChoiceMeta && typeof config.maxSelections === 'number' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {selectedValues.length} / {config.maxSelections} selected
            </p>
          )}
          <div className={choiceGridClass}>
            {options.map((option) => {
              const selectionIndex = selectedValues.indexOf(option.value);
              const isSelected = selectionIndex >= 0;
              const isAtLimit = !isSelected && selectedValues.length >= maxSelections;

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={!canEdit || isAtLimit}
                  onClick={() => toggleValue(option.value)}
                  className={`rounded-lg sm:rounded-xl border px-3 py-2 sm:p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-brand-900 dark:text-brand-100'
                      : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700'
                  } ${!canEdit || isAtLimit ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm font-medium">{option.label}</span>
                    {isSelected ? (
                      question.inputType === 'ranking' ? (
                        <span className="inline-flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-brand-600 text-[9px] sm:text-[11px] font-semibold text-white shrink-0">
                          {selectionIndex + 1}
                        </span>
                      ) : (
                        <CheckCircle className="w-4 h-4 shrink-0 text-brand-600" />
                      )
                    ) : null}
                  </div>
                  {option.description && (
                    <p className="mt-1 sm:mt-2 text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                      {option.description}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (question.inputType === 'slider') {
      const min = config.sliderMin ?? 0;
      const max = config.sliderMax ?? 10;
      const step = config.sliderStep ?? 1;
      const currentValue = questionAnswer?.answerText ? Number(questionAnswer.answerText) : null;
      const midpoint = min + (max - min) / 2;
      const displayValue = currentValue ?? Math.round((midpoint - min) / step) * step + min;

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
            <span>{config.minLabel || min}</span>
            <span className="font-medium">
              {currentValue === null ? 'Not set yet' : currentValue}
            </span>
            <span>{config.maxLabel || max}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            disabled={!canEdit}
            value={displayValue}
            onChange={(event) => updateAnswer(question.id, { answerText: event.target.value })}
            className="w-full accent-brand-600"
          />
          {canEdit && currentValue !== null && (
            <button
              type="button"
              onClick={() => updateAnswer(question.id, { answerText: '' })}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
            >
              Clear answer
            </button>
          )}
        </div>
      );
    }

    if (question.inputType === 'multi_image') {
      const isTranscribing = imageTranscribing[question.id] ?? false;
      const previews = imagePreviewUrls[question.id] ?? [];
      const bookList = Array.isArray(questionAnswer?.answerJson) ? questionAnswer.answerJson : [];
      const maxImages = config.maxImages ?? 5;

      return (
        <div className="space-y-4">
          {/* Privacy notice */}
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            Your images are sent to AI for transcription only and are never saved or stored.
          </p>

          {/* Upload area */}
          <label
            className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed transition-colors ${
              canEdit && !isTranscribing
                ? 'border-gray-300 dark:border-gray-600 hover:border-brand-400 dark:hover:border-brand-600 cursor-pointer'
                : 'border-gray-200 dark:border-gray-700 cursor-not-allowed opacity-60'
            }`}
          >
            {isTranscribing ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Identifying books...
                </span>
              </>
            ) : (
              <>
                <ImagePlus className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {bookList.length > 0
                    ? 'Upload new photos to re-scan'
                    : `Tap to upload photos (up to ${maxImages})`}
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={!canEdit || isTranscribing}
              className="hidden"
              onChange={(event) => {
                const fileList = event.target.files;
                if (fileList && fileList.length > 0) {
                  void handleImageUpload(fileList, question.id);
                  event.target.value = '';
                }
              }}
            />
          </label>

          {/* Image previews while processing */}
          {previews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previews.map((url, i) => (
                <Image
                  key={`preview-${question.id}-${i}`}
                  src={url}
                  alt={`Upload ${i + 1}`}
                  width={80}
                  height={80}
                  unoptimized
                  className={`h-20 w-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 ${
                    isTranscribing ? 'opacity-60' : ''
                  }`}
                />
              ))}
            </div>
          )}

          {/* Transcribed book list */}
          {bookList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <BookOpen className="w-4 h-4" />
                <span>
                  {bookList.length} book{bookList.length === 1 ? '' : 's'} found
                </span>
              </div>
              <ul className="space-y-1">
                {bookList.map((book, index) => (
                  <li
                    key={`${question.id}-book-${index}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <span className="break-words min-w-0">{book}</span>
                    {canEdit && (
                      <button
                        onClick={() => removeBookFromAnswer(question.id, index)}
                        className="p-1 text-gray-400 hover:text-red-500 shrink-0 cursor-pointer"
                        aria-label="Remove book"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    if (question.inputType === 'multi_url' || question.inputType === 'multi_text') {
      const rows = multiValueState[question.id] ?? [];
      const maxItems = getMaxItemsForQuestion(question);
      const placeholder =
        question.inputType === 'multi_url'
          ? config.placeholder || 'https://...'
          : config.placeholder ||
            'e.g. marginalrevolution.com, Arrival movie, Guggenheim Museum, anything';

      return (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2">
              <div className="flex-1 relative">
                {question.inputType === 'multi_url' && (
                  <Link2 className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                )}
                <input
                  type="text"
                  value={row.value}
                  disabled={!canEdit}
                  onChange={(event) => updateMultiValue(question.id, index, event.target.value)}
                  placeholder={placeholder}
                  className={`w-full py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    question.inputType === 'multi_url' ? 'pl-9 pr-3' : 'px-3'
                  } ${
                    canEdit
                      ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                  }`}
                />
              </div>
              {canEdit && (
                <button
                  onClick={() => removeMultiValueRow(question.id, index)}
                  className="p-2 text-gray-400 hover:text-red-500 cursor-pointer"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit && rows.length < maxItems && (
            <button
              onClick={() => addMultiValueRow(question)}
              className="inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add another
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  const renderSurveyQuestionCards = (questionList: MatchingQuestion[]) => (
    <div className="space-y-3">
      {questionList.map((question) => {
        const isOpen = expandedQuestionId === question.id;
        const isAnswered = answerHasValue(question, answers[question.id]);

        return (
          <div
            key={question.id}
            className={`rounded-lg border overflow-hidden ${
              isAnswered
                ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <button
              onClick={() =>
                setExpandedQuestionId((prev) => (prev === question.id ? null : question.id))
              }
              className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer ${
                isAnswered ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/50'
              }`}
            >
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
                <span className="text-[15px] font-medium text-gray-900 dark:text-white">
                  {question.prompt}
                </span>
              </div>
              {isAnswered && (
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
              )}
            </button>

            {isOpen && (
              <div className="p-4 space-y-3">
                {question.helpText && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{question.helpText}</p>
                )}
                {renderQuestionFields(question)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderInlineSurveyQuestions = (questionList: MatchingQuestion[]) => (
    <div className="space-y-3 sm:space-y-5">
      {questionList.map((question) => {
        const isAnswered = answerHasValue(question, answers[question.id]);

        return (
          <section
            key={question.id}
            className={`rounded-xl sm:rounded-2xl border p-3 sm:p-4 md:p-5 ${
              isAnswered
                ? 'border-brand-200 bg-brand-50/40 dark:border-brand-900 dark:bg-brand-950/20'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}
          >
            <div className="mb-3 sm:mb-4 flex items-start justify-between gap-3">
              <h3 className="text-sm sm:text-[15px] font-semibold leading-5 sm:leading-6 text-gray-900 dark:text-white">
                {question.prompt}
              </h3>
              {isAnswered && (
                <CheckCircle className="mt-0.5 w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" />
              )}
            </div>
            {renderQuestionFields(question, { showChoiceMeta: false })}
          </section>
        );
      })}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 sm:rounded-xl sm:shadow-lg sm:border sm:border-gray-200 sm:dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-6 sm:px-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {programConfig.onboardingTitle}
          </h1>
          {programConfig.landingEyebrow && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {programConfig.landingEyebrow}
            </p>
          )}
        </div>
        {(currentStep === 'consent' || currentStep === 'context' || currentStep === 'questions') &&
          renderAutosaveStatus()}
      </div>

      {isEditLocked && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5" />
            <div>
              <p className="font-medium">Profile edits are locked.</p>
              <p className="text-amber-700/80 dark:text-amber-200/80">
                If you need help, email {SUPPORT_EMAIL}.
              </p>
            </div>
          </div>
        </div>
      )}

      {isSubmitted && canEdit && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-200">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 mt-0.5" />
            <div>
              <p className="font-medium">Your profile is submitted.</p>
              <p className="text-green-700/80 dark:text-green-200/80">
                You can keep editing until submissions close.
              </p>
            </div>
          </div>
        </div>
      )}

      {currentStep !== 'intro' && currentStep !== 'confirmation' && (
        <div className="px-4 pt-5 sm:px-6 sm:pt-6">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['consent', '1. Consent'],
                ['questions', '2. Questions'],
                ['context', '3. Context'],
              ] as [MatchingFlowStep, string][]
            ).map(([stepKey, label]) => (
              <button
                key={stepKey}
                onClick={() => void goToStep(stepKey, true)}
                className={`py-2 rounded-full text-center text-xs font-medium cursor-pointer transition-colors ${
                  currentStep === stepKey
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-5 sm:p-6">
        {currentStep === 'intro' && (
          <section className="space-y-6">
            <div className="space-y-3">
              {programConfig.introHeading && (
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {programConfig.introHeading}
                </h2>
              )}
              <p className="text-sm text-gray-700 dark:text-gray-300">{programConfig.introLead}</p>
            </div>

            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {programConfig.ideaHeading}
                </h3>
                <p>{programConfig.ideaBody}</p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {programConfig.outcomeHeading}
                </h3>
                <p>{programConfig.outcomeBody}</p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {programConfig.privacyHeading}
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  {programConfig.privacyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
              <p>{programConfig.introClosing}</p>
            </div>

            <div className="flex items-center justify-between">
              <Link
                href={programConfig.path}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back
              </Link>
              <button
                onClick={() => void handleIntroContinue()}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
              >
                Start
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {currentStep === 'consent' && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <User className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Consent</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {programConfig.consentDescription}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Display name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                disabled={!canEdit}
                maxLength={50}
                onChange={(event) => {
                  setDisplayName(event.target.value.slice(0, 50));
                  markProfileDirty();
                }}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                  errors.displayName
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-gray-300 dark:border-gray-600'
                } ${
                  canEdit
                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              />
              {errors.displayName && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.displayName}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Account email
              </label>
              <input
                type="text"
                value={defaultEmail || 'No email'}
                disabled
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500"
              />
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiMatching}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setAiMatching(event.target.checked);
                    markProfileDirty();
                  }}
                  className="mt-1 w-4 h-4 text-brand-600 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {programConfig.consentStatement}
                </span>
              </label>
              {errors.consent && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errors.consent}</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => void goToStep('intro', true)}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => void handleConsentContinue()}
                disabled={!canEdit}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {currentStep === 'context' && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <FileText className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {programConfig.contextTitle}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {programConfig.contextDescription}
                </p>
              </div>
            </div>

            <div className="space-y-8">
              {passiveQuestions.map((question) => (
                <div key={question.id} className="space-y-2">
                  <div>
                    <label className="block text-base font-medium text-gray-700 dark:text-gray-300">
                      {question.prompt}
                    </label>
                    {question.helpText && (
                      <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        {question.helpText}
                      </p>
                    )}
                  </div>
                  {renderQuestionFields(question)}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => void goToStep('questions', true)}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back
              </button>

              {!isSubmitted && (
                <button
                  onClick={() => void handleSubmitClick()}
                  disabled={!canEdit}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Submit Profile
                </button>
              )}

              {isSubmitted && (
                <button
                  onClick={() => void goToStep('confirmation', true)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
                >
                  Done Editing
                </button>
              )}
            </div>
          </section>
        )}

        {currentStep === 'questions' && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <ClipboardList className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {programConfig.questionsTitle}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {programConfig.questionsDescription}
                </p>
              </div>
            </div>

            {answeredSurveyCount === 1 && (
              <p className="text-sm text-brand-700 dark:text-brand-300">
                {programConfig.oneAnswerHint}
              </p>
            )}

            <div className="space-y-6">
              {programConfig.surveyPhases.map((phase) => {
                const questionList = surveyQuestionsByPhase[phase.key];
                if (questionList.length === 0) return null;
                const useInlineQuickSignalLayout = program === 'vibe' && phase.key === 'phase1';
                const shouldShowHeading =
                  !phase.hideHeader &&
                  (programConfig.surveyPhases.length > 1 || phase.title !== 'Questions');

                return (
                  <section key={phase.key} className={shouldShowHeading ? 'space-y-3' : ''}>
                    {shouldShowHeading && (
                      <div>
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                          {phase.title}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {phase.description}
                        </p>
                      </div>
                    )}
                    {useInlineQuickSignalLayout
                      ? renderInlineSurveyQuestions(questionList)
                      : renderSurveyQuestionCards(questionList)}
                  </section>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => void goToStep('consent', true)}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => void goToStep('context', true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
              >
                Continue to Context
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {currentStep === 'confirmation' && (
          <section className="space-y-6">
            {!isSubmitted && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-5">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  You have not submitted yet
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Complete the context step when you are ready to submit your profile.
                </p>
                <button
                  onClick={() => void goToStep('context', true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
                >
                  Go to Context
                </button>
              </div>
            )}

            {isSubmitted && (
              <>
                <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20 p-5">
                  <h2 className="text-xl font-semibold text-green-900 dark:text-green-100">
                    You are all set!
                  </h2>
                  <p className="mt-2 text-sm text-green-800 dark:text-green-200">
                    {programConfig.confirmationBody}
                  </p>
                  <ol className="mt-3 text-sm text-green-800 dark:text-green-200 list-decimal pl-5 space-y-1">
                    {programConfig.confirmationSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {canEdit && (
                    <p className="mt-3 text-sm text-green-800 dark:text-green-200">
                      {programConfig.confirmationEditNote}
                    </p>
                  )}
                </div>

                <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-white">
                    View context you shared
                  </summary>
                  <div className="mt-4 space-y-4">
                    {passiveQuestions.map((question) => {
                      const content = renderSummaryAnswer(question);
                      if (!content) return null;
                      return (
                        <div key={question.id}>
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                            {question.prompt}
                          </h3>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </details>

                <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-white">
                    View question answers ({answeredSurveyCount} answered)
                  </summary>
                  <div className="mt-4 space-y-4">
                    {surveyQuestions.map((question) => {
                      const content = renderSummaryAnswer(question);
                      if (!content) return null;
                      return (
                        <div key={question.id}>
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                            {question.prompt}
                          </h3>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </>
            )}

            <div className="flex items-center justify-between">
              <Link
                href={programConfig.path}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                {programConfig.backLabel}
              </Link>
              {canEdit && (
                <button
                  onClick={() => void goToStep('context', true)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
                >
                  Edit My Profile
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <ConfirmSubmitModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirmSubmit()}
        isSubmitting={isSubmitting}
        answeredCount={answeredSurveyCount}
        canEditAfterSubmit={canEdit}
      />
    </div>
  );
}
