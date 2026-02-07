'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Link2,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import ConfirmSubmitModal from '@/components/matching/ConfirmSubmitModal';
import type { MatchingFlowStep } from '@/lib/matching/flow';
import { getMatchingFlowPath } from '@/lib/matching/flow';

const PROGRAM = 'tedx';
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
  inputType: 'long_text' | 'short_text' | 'url' | 'multi_url' | 'multi_text' | 'file_markdown';
  maxLength: number | null;
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
  currentStep: MatchingFlowStep;
  defaultDisplayName: string;
  defaultEmail: string | null;
  entrySource?: string | null;
}

function getMaxItemsForQuestion(
  questionId: string,
  inputType: MatchingQuestion['inputType']
): number {
  if (inputType === 'multi_url') return questionId === 'links_about_you' ? 5 : 10;
  if (inputType === 'multi_text') return questionId === 'links_about_topics' ? 10 : 20;
  return 20;
}

export default function MatchingOnboardingClient({
  currentStep,
  defaultDisplayName,
  defaultEmail,
  entrySource,
}: MatchingOnboardingClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const currentPath = getMatchingFlowPath(currentStep);

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

  const answersRef = useRef(answers);
  const displayNameRef = useRef(displayName);
  const aiMatchingRef = useRef(aiMatching);
  const profileDirtyRef = useRef(false);
  const answersDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const isSubmitted = profile?.status === 'submitted';
  const isEditLocked = profile ? !profile.allowEditing : false;
  const canEdit = !isEditLocked;

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

  const markAnswersDirty = () => {
    if (!canEdit) return;
    answersDirtyRef.current = true;
  };

  const answerHasValue = useCallback(
    (question: MatchingQuestion, answer: AnswerState | undefined): boolean => {
      if (!answer) return false;
      if (question.inputType === 'multi_url' || question.inputType === 'multi_text') {
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
      const response = await fetch(`/api/matching/profile?program=${PROGRAM}`);
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

      const nextAnswers: Record<string, AnswerState> = {};
      const nextMultiState: Record<string, { id: string; value: string }[]> = {};

      data.answers.forEach((answer) => {
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
  }, [defaultDisplayName, makeRowId, redirectToLogin, showToast]);

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

  const updateAnswer = (questionId: string, update: AnswerState) => {
    if (!canEdit) return;
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        ...update,
      },
    }));
    markAnswersDirty();
  };

  const syncMultiValues = useCallback(
    (questionId: string, rows: { id: string; value: string }[]) => {
      if (!canEdit) return;
      updateAnswer(questionId, { answerJson: rows.map((row) => row.value) });
    },
    [canEdit]
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
    const maxItems = getMaxItemsForQuestion(question.id, question.inputType);

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
        program: PROGRAM,
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
  }, [entrySource, redirectToLogin, version]);

  const saveAnswers = useCallback(async () => {
    if (!version) return;

    const payload = Object.entries(answersRef.current).map(([questionId, value]) => ({
      questionId,
      answerText: typeof value.answerText === 'string' ? value.answerText : undefined,
      answerJson: Array.isArray(value.answerJson) ? value.answerJson : undefined,
    }));

    if (payload.length === 0) return;

    const response = await fetch('/api/matching/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: PROGRAM, version, answers: payload }),
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
  }, [redirectToLogin, version]);

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
      router.push(getMatchingFlowPath(step));
    },
    [router, saveDraft]
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
    if (answeredSurveyCount < 1) {
      nextErrors.survey = 'Answer at least one question before submitting.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [aiMatching, answeredSurveyCount, displayName]);

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
    await goToStep('context', false);
  };

  const handleSubmitClick = async () => {
    const isValid = validateForSubmit();
    if (!isValid) {
      showToast('Please complete consent and at least one question.', 'error');
      return;
    }

    if (answeredSurveyCount === 1) {
      showToast('You can submit now, but 2-3 answers usually creates better matches.', 'info');
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
        body: JSON.stringify({ program: PROGRAM }),
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
      router.push(getMatchingFlowPath('confirmation'));
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
    if (!answerHasValue(question, answer)) return null;

    if (question.inputType === 'multi_url' || question.inputType === 'multi_text') {
      const list = Array.isArray(answer?.answerJson) ? answer.answerJson.filter(Boolean) : [];
      return (
        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {list.map((item) => (
            <li key={`${question.id}-${item}`} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {answer?.answerText?.trim()}
      </p>
    );
  };

  const renderQuestionFields = (question: MatchingQuestion) => {
    const questionAnswer = answers[question.id];

    if (question.inputType === 'long_text' || question.inputType === 'short_text') {
      const value = questionAnswer?.answerText ?? '';

      return (
        <textarea
          value={value}
          disabled={!canEdit}
          onChange={(event) => updateAnswer(question.id, { answerText: event.target.value })}
          rows={4}
          maxLength={question.maxLength ?? undefined}
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
          placeholder="https://..."
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
              placeholder="Paste resume text here"
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

    if (question.inputType === 'multi_url' || question.inputType === 'multi_text') {
      const rows = multiValueState[question.id] ?? [];
      const maxItems = getMaxItemsForQuestion(question.id, question.inputType);
      const placeholder =
        question.inputType === 'multi_url'
          ? 'https://...'
          : 'e.g. marginalrevolution.com, Arrival movie, Guggenheim Museum, anything';

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-6 pt-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            TEDx Matching Profile
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Find the attendees you will actually want to meet.
          </p>
        </div>
        {(currentStep === 'consent' || currentStep === 'context' || currentStep === 'questions') &&
          renderAutosaveStatus()}
      </div>

      {isEditLocked && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
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
        <div className="mx-6 mt-4 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-200">
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
        <div className="px-6 pt-6">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['consent', '1. Consent'],
                ['context', '2. Context'],
                ['questions', '3. Questions'],
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

      <div className="p-6">
        {currentStep === 'intro' && (
          <section className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">How This Works</h2>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                We are building something special for TEDxAsheville: a way to connect you with the
                attendees you will actually click with.
              </p>
            </div>

            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">The Idea</h3>
                <p>
                  Share a bit about yourself, your interests, and what makes you tick. AI reads your
                  input and finds people you are likely to have great conversations with.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">What You Get</h3>
                <p>
                  Before the event, you will receive a personalized list of people to meet with
                  conversation starters to make introductions easier.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Your Privacy</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Your specific answers are not shown directly to other attendees.</li>
                  <li>Your data is used only for this matching pilot.</li>
                  <li>You control what you share. Most fields are optional.</li>
                </ul>
              </div>
              <p>
                The more you share, the better your matches. Even 5 minutes of thoughtful input can
                help.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Link
                href="/tedx"
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
                  Confirm your name and opt in to AI-powered matching.
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
                  I understand my profile data will be analyzed by AI and used to match me with
                  other TEDxAsheville attendees. My specific answers are not shared directly.
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
                  Share Some Context
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Everything is optional. More context leads to better matches.
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
                onClick={() => void goToStep('consent', true)}
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => void goToStep('questions', true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
              >
                Continue to Questions
                <ChevronRight className="w-4 h-4" />
              </button>
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
                  A Few Questions
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Every question is optional. Answer the ones that resonate with you.
                </p>
              </div>
            </div>

            {errors.survey && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.survey}</p>
            )}
            {answeredSurveyCount === 1 && (
              <p className="text-sm text-brand-700 dark:text-brand-300">
                You can submit with one answer, but 2-3 thoughtful answers improves match quality.
              </p>
            )}

            <div className="space-y-3">
              {surveyQuestions.map((question) => {
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
                        isAnswered
                          ? 'bg-green-50 dark:bg-green-900/20'
                          : 'bg-gray-50 dark:bg-gray-800/50'
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
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {question.helpText}
                          </p>
                        )}
                        {renderQuestionFields(question)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => void goToStep('context', true)}
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

        {currentStep === 'confirmation' && (
          <section className="space-y-6">
            {!isSubmitted && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-5">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  You have not submitted yet
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Complete the questions step when you are ready to submit your profile.
                </p>
                <button
                  onClick={() => void goToStep('questions', true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
                >
                  Go to Questions
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
                    Your profile has been submitted. We will analyze it and use it to generate your
                    TEDx matches.
                  </p>
                  <ol className="mt-3 text-sm text-green-800 dark:text-green-200 list-decimal pl-5 space-y-1">
                    <li>We analyze your profile details and answers.</li>
                    <li>We identify your strongest conversation matches.</li>
                    <li>You receive your personalized list before TEDxAsheville.</li>
                  </ol>
                  {canEdit && (
                    <p className="mt-3 text-sm text-green-800 dark:text-green-200">
                      You can still edit your profile until submissions are locked.
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
                href="/tedx"
                className="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                Back to TEDx
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
