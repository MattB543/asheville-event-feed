'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
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

const PROGRAM = 'tedx';

type Step = 1 | 2 | 3;

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
  aiMatching: boolean;
  consentAt: string | null;
  consentVersion: string | null;
  status: 'draft' | 'submitted';
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
  inputType: 'long_text' | 'short_text' | 'url' | 'multi_url' | 'file_markdown';
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
  defaultDisplayName: string;
  defaultEmail: string | null;
}

export default function MatchingOnboardingClient({
  defaultDisplayName,
  defaultEmail,
}: MatchingOnboardingClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>(1);
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [multiUrlState, setMultiUrlState] = useState<
    Record<string, { id: string; value: string }[]>
  >({});

  const answersRef = useRef(answers);
  const displayNameRef = useRef(displayName);
  const aiMatchingRef = useRef(aiMatching);
  const profileDirtyRef = useRef(false);
  const answersDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const isSubmitted = profile?.status === 'submitted';
  const makeRowId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

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
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;
    setMultiUrlState((prev) => {
      let changed = false;
      const next = { ...prev };
      questions
        .filter((question) => question.inputType === 'multi_url')
        .forEach((question) => {
          if (!next[question.id] || next[question.id].length === 0) {
            next[question.id] = [{ id: makeRowId(), value: '' }];
            changed = true;
          }
        });
      return changed ? next : prev;
    });
  }, [makeRowId, questions]);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/matching/profile?program=${PROGRAM}`);
      if (response.status === 401) {
        router.push('/login?next=/tedx/onboarding');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load profile');
      }

      const data = (await response.json()) as ProfileResponse;
      setProfile(data.profile);
      setQuestions(data.questions);
      setVersion(data.version);

      if (data.profile?.displayName) {
        setDisplayName(data.profile.displayName);
      }
      if (typeof data.profile?.aiMatching === 'boolean') {
        setAiMatching(data.profile.aiMatching);
      }

      const nextAnswers: Record<string, AnswerState> = {};
      const nextMultiUrlState: Record<string, { id: string; value: string }[]> = {};
      data.answers.forEach((answer) => {
        const answerJson = Array.isArray(answer.answerJson)
          ? answer.answerJson.filter((item): item is string => typeof item === 'string')
          : undefined;
        nextAnswers[answer.questionId] = {
          answerText: answer.answerText ?? '',
          answerJson,
        };
        if (answerJson && answerJson.length > 0) {
          nextMultiUrlState[answer.questionId] = answerJson.map((value) => ({
            id: makeRowId(),
            value,
          }));
        }
      });
      setAnswers(nextAnswers);
      setMultiUrlState((prev) => ({ ...prev, ...nextMultiUrlState }));

      if (data.profile?.updatedAt) {
        setLastSavedAt(new Date(data.profile.updatedAt));
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      showToast('Failed to load matching profile', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const markProfileDirty = () => {
    profileDirtyRef.current = true;
  };

  const markAnswersDirty = () => {
    answersDirtyRef.current = true;
  };

  const updateAnswer = (questionId: string, update: AnswerState) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        ...update,
      },
    }));
    markAnswersDirty();
  };

  const syncMultiUrlAnswers = (questionId: string, rows: { id: string; value: string }[]) => {
    const values = rows.map((row) => row.value);
    updateAnswer(questionId, { answerJson: values });
  };

  const updateMultiUrlValue = (questionId: string, index: number, value: string) => {
    setMultiUrlState((prev) => {
      const current = prev[questionId] ?? [];
      const next = [...current];
      if (!next[index]) {
        next[index] = { id: makeRowId(), value };
      } else {
        next[index] = { ...next[index], value };
      }
      syncMultiUrlAnswers(questionId, next);
      return { ...prev, [questionId]: next };
    });
  };

  const addMultiUrlRow = (questionId: string) => {
    setMultiUrlState((prev) => {
      const current = prev[questionId] ?? [];
      const next = [...current, { id: makeRowId(), value: '' }];
      syncMultiUrlAnswers(questionId, next);
      return { ...prev, [questionId]: next };
    });
  };

  const removeMultiUrlRow = (questionId: string, index: number) => {
    setMultiUrlState((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.filter((_, idx) => idx !== index);
      const ensured = next.length > 0 ? next : [{ id: makeRowId(), value: '' }];
      syncMultiUrlAnswers(questionId, ensured);
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
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save profile');
    }

    const data = (await response.json()) as { profile: MatchingProfile };
    setProfile(data.profile);
    profileDirtyRef.current = false;
  }, [version]);

  const saveAnswers = useCallback(async () => {
    if (!version) return;

    const payload = Object.entries(answersRef.current).map(([questionId, value]) => ({
      questionId,
      answerText: typeof value.answerText === 'string' ? value.answerText : undefined,
      answerJson: Array.isArray(value.answerJson)
        ? value.answerJson.map((item) => item.trim()).filter((item) => item.length > 0)
        : undefined,
    }));

    if (payload.length === 0) return;

    const response = await fetch('/api/matching/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: PROGRAM, version, answers: payload }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error || 'Failed to save answers');
    }

    answersDirtyRef.current = false;
  }, [version]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (saveInFlightRef.current || isSubmitted) return true;
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
  }, [isSubmitted, saveAnswers, saveProfile, showToast]);

  useEffect(() => {
    if (isSubmitted || !version) return;
    const interval = setInterval(() => {
      if (profileDirtyRef.current || answersDirtyRef.current) {
        void saveDraft();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isSubmitted, saveDraft, version]);

  const validateForSubmit = () => {
    const nextErrors: Record<string, string> = {};

    if (!aiMatching) {
      nextErrors.consent = 'You must agree before submitting.';
    }

    questions.forEach((question) => {
      if (!question.required) return;
      const answer = answers[question.id];
      if (!answer) {
        nextErrors[question.id] = 'Required';
        return;
      }

      if (question.inputType === 'multi_url') {
        const list = Array.isArray(answer.answerJson) ? answer.answerJson : [];
        if (list.length === 0) {
          nextErrors[question.id] = 'Required';
        }
      } else {
        const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
        if (!text) {
          nextErrors[question.id] = 'Required';
        }
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmitClick = async () => {
    const isValid = validateForSubmit();
    if (!isValid) {
      showToast('Please complete the required questions.', 'error');
      return;
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
      if (!response.ok || !data.profile) {
        throw new Error(data.error || 'Failed to submit profile');
      }

      setProfile(data.profile);
      setConfirmOpen(false);
      setStep(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Profile submitted successfully!', 'success');
    } catch (error) {
      console.error('Submit failed:', error);
      showToast('Submission failed. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = async () => {
    if (step > 1) {
      await saveDraft();
      setStep((prev) => (prev - 1) as Step);
    }
  };

  const handleNext = async () => {
    await saveDraft();
    setStep((prev) => (prev + 1) as Step);
  };

  const passiveQuestions = questions.filter((q) => q.section === 'passive');
  const surveyQuestions = questions.filter((q) => q.section === 'survey');

  const renderAutosaveStatus = () => {
    if (isSubmitted) {
      return (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle className="w-4 h-4" />
          Submitted
        </div>
      );
    }

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

  const handleResumeUpload = async (file: File, questionId: string) => {
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
            Build a profile to help us match you with other attendees.
          </p>
        </div>
        {renderAutosaveStatus()}
      </div>

      {isSubmitted && (
        <div className="mx-6 mt-4 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-200">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5" />
            <div>
              <p className="font-medium">Your answers are locked.</p>
              <p className="text-green-700/80 dark:text-green-200/80">
                If you need to update your answers, email support@avlgo.com.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 pt-6">
        <div className="flex items-center gap-2">
          {(['1', '2', '3'] as const).map((item, index) => {
            const stepNumber = (index + 1) as Step;
            const isActive = step === stepNumber;
            return (
              <div
                key={item}
                className={`flex-1 py-2 rounded-full text-center text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {stepNumber === 1 && '1. Consent'}
                {stepNumber === 2 && '2. Context'}
                {stepNumber === 3 && '3. Questions'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-6">
        {step === 1 && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <User className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Your profile basics
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  We will use this to personalize your matches.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                readOnly={isSubmitted}
                aria-readonly={isSubmitted}
                onChange={(event) => {
                  setDisplayName(event.target.value.slice(0, 80));
                  markProfileDirty();
                }}
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                  isSubmitted
                    ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-default'
                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                }`}
              />
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
                  disabled={isSubmitted}
                  onChange={(event) => {
                    setAiMatching(event.target.checked);
                    markProfileDirty();
                  }}
                  className="mt-1 w-4 h-4 text-brand-600 cursor-pointer"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  I agree that my profile data will be analyzed and used to match me with other AVL
                  GO users.
                </span>
              </label>
              {errors.consent && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errors.consent}</p>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <FileText className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Context</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Optional but helpful information for richer matching.
                </p>
              </div>
            </div>

            {passiveQuestions.map((question) => (
              <div key={question.id} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {question.prompt}
                  {question.required && <span className="text-red-500"> *</span>}
                </label>
                {question.helpText && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{question.helpText}</p>
                )}

                {question.inputType === 'file_markdown' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                        <Upload className="w-4 h-4" />
                        <span>{isParsingResume ? 'Parsing...' : 'Upload PDF resume'}</span>
                        <input
                          type="file"
                          accept="application/pdf"
                          disabled={isSubmitted || isParsingResume}
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
                      <span className="text-xs text-gray-500">PDF only, max 10 MB</span>
                    </div>
                    <textarea
                      value={answers[question.id]?.answerText ?? ''}
                      readOnly={isSubmitted}
                      aria-readonly={isSubmitted}
                      onChange={(event) =>
                        updateAnswer(question.id, { answerText: event.target.value })
                      }
                      rows={6}
                      placeholder="Paste resume text here if you prefer"
                      className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                        isSubmitted
                          ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-default'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                      }`}
                    />
                  </div>
                )}

                {question.inputType === 'url' && (
                  <input
                    type="url"
                    value={answers[question.id]?.answerText ?? ''}
                    readOnly={isSubmitted}
                    aria-readonly={isSubmitted}
                    onChange={(event) =>
                      updateAnswer(question.id, { answerText: event.target.value })
                    }
                    placeholder="https://..."
                    className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                      isSubmitted
                        ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-default'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                    }`}
                  />
                )}

                {question.inputType === 'multi_url' && (
                  <div className="space-y-3">
                    {(() => {
                      const urlRows = multiUrlState[question.id] ?? [];

                      return urlRows.map((row, index) => (
                        <div key={row.id} className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Link2 className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="url"
                              value={row.value}
                              readOnly={isSubmitted}
                              aria-readonly={isSubmitted}
                              onChange={(event) => {
                                updateMultiUrlValue(question.id, index, event.target.value);
                              }}
                              placeholder="https://..."
                              className={`w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                                isSubmitted
                                  ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-default'
                                  : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                              }`}
                            />
                          </div>
                          {!isSubmitted && (
                            <button
                              onClick={() => {
                                removeMultiUrlRow(question.id, index);
                              }}
                              className="p-2 text-gray-400 hover:text-red-500 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ));
                    })()}
                    {!isSubmitted && (
                      <button
                        onClick={() => {
                          addMultiUrlRow(question.id);
                        }}
                        className="inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Add another link
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {step === 3 && (
          <section className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="icon-circle">
                <ClipboardList className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Questions</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Take your time. Thoughtful answers lead to better matches.
                </p>
              </div>
            </div>

            {surveyQuestions.map((question) => {
              const answerValue = answers[question.id]?.answerText ?? '';
              const remaining = question.maxLength ? question.maxLength - answerValue.length : null;

              return (
                <div key={question.id} className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {question.prompt}
                    {question.required && <span className="text-red-500"> *</span>}
                  </label>
                  {question.helpText && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{question.helpText}</p>
                  )}
                  <textarea
                    value={answerValue}
                    readOnly={isSubmitted}
                    aria-readonly={isSubmitted}
                    onChange={(event) =>
                      updateAnswer(question.id, { answerText: event.target.value })
                    }
                    rows={4}
                    maxLength={question.maxLength ?? undefined}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                      errors[question.id]
                        ? 'border-red-400 focus:ring-red-400'
                        : 'border-gray-300 dark:border-gray-600'
                    } ${
                      isSubmitted
                        ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-default'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                    }`}
                  />
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{errors[question.id]}</span>
                    {remaining !== null && <span>{remaining} characters left</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <div className="px-6 pb-6 flex items-center justify-between gap-4">
        <button
          onClick={() => void handleBack()}
          disabled={step === 1}
          className="flex items-center gap-2 px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        {step < 3 && (
          <button
            onClick={() => void handleNext()}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
          >
            Next
          </button>
        )}

        {step === 3 && !isSubmitted && (
          <button
            onClick={() => void handleSubmitClick()}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
          >
            Submit profile
          </button>
        )}
      </div>

      <ConfirmSubmitModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirmSubmit()}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
