import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { createApi } from '../../lib/api';
import { useMotionProfile } from '../../lib/motion';
import { useAuthStore } from '../../stores/authStore';
import { MessageFormatter } from '../chat/MessageFormatter';
import { Check } from 'lucide-react';

interface WelcomeAnswer {
  id: string;
  question_id: string;
  text: string;
  emoji: string | null;
  role_ids: string[];
  channel_ids: string[];
  position: number;
}

interface WelcomeQuestion {
  id: string;
  question: string;
  allow_multiple: boolean;
  required: boolean;
  position: number;
  answers: WelcomeAnswer[];
}

interface WelcomeRule {
  id: string;
  content: string;
  position: number;
}

interface WelcomeSettings {
  enabled: boolean;
  bg: string;
  serverIcon?: string | null;
  questions: WelcomeQuestion[];
  rules: WelcomeRule[];
  rulesMode: 'structured' | 'markdown';
  rulesMarkdown: string;
}

type Step = 'arrival' | `question-${string}` | 'rules' | 'completing';

interface WelcomeFlowProps {
  onComplete: () => void;
  previewOnly?: boolean;
}

export function WelcomeFlow({ onComplete, previewOnly = false }: WelcomeFlowProps) {
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const api = createApi();
  const serverUrl = api.defaults.baseURL || useAuthStore.getState().serverUrl || '';

  const [settings, setSettings] = useState<WelcomeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('arrival');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({});
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const motionProfile = useMotionProfile();

  useEffect(() => {
    api.get('/api/welcome/settings')
      .then((res) => {
        setSettings(res.data);
        setLoading(false);
      })
      .catch(() => {
        // If we can't load settings, just complete the flow silently
        onComplete();
      });
  }, []);

  if (loading || !settings) return null;

  const questions = settings.questions;
  const currentQuestionIndex = (() => {
    if (!step.startsWith('question-')) return -1;
    const qId = step.replace('question-', '');
    return questions.findIndex((q) => q.id === qId);
  })();
  const currentQuestion = currentQuestionIndex >= 0 ? questions[currentQuestionIndex] : null;

  function goToNextStep() {
    if (step === 'arrival') {
      if (questions.length > 0) {
        setStep(`question-${questions[0].id}`);
      } else {
        setStep('rules');
      }
      return;
    }

    if (currentQuestion) {
      const nextIdx = currentQuestionIndex + 1;
      if (nextIdx < questions.length) {
        setStep(`question-${questions[nextIdx].id}`);
      } else {
        setStep('rules');
      }
      return;
    }

    if (step === 'rules') {
      void handleComplete();
    }
  }

  function toggleAnswer(questionId: string, answerId: string, allowMultiple: boolean) {
    setSelectedAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (allowMultiple) {
        const next = current.includes(answerId)
          ? current.filter((id) => id !== answerId)
          : [...current, answerId];
        return { ...prev, [questionId]: next };
      } else {
        return { ...prev, [questionId]: current.includes(answerId) ? [] : [answerId] };
      }
    });
  }

  async function handleComplete() {
    if (previewOnly) {
      onComplete();
      return;
    }
    setStep('completing');
    setError(null);
    try {
      const answers: Record<string, string | string[]> = {};
      for (const [qId, aIds] of Object.entries(selectedAnswers)) {
        const q = questions.find((x) => x.id === qId);
        if (!q) continue;
        answers[qId] = q.allow_multiple ? aIds : (aIds[0] ?? null!);
      }
      await api.post('/api/welcome/complete', { answers });
      onComplete();
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('rules');
    }
  }

  const bgStyle = settings.bg
    ? {
      backgroundImage: `url(${
        /^https?:\/\//i.test(settings.bg) || !serverUrl
          ? settings.bg
          : `${serverUrl}${settings.bg}`
      })`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
    : {};

  const serverIconUrl = settings.serverIcon || (serverInfo?.serverIcon
    ? (/^https?:\/\//i.test(serverInfo.serverIcon) || !serverUrl
      ? serverInfo.serverIcon
      : `${serverUrl}${serverInfo.serverIcon}`)
    : null);

  const canNext = (() => {
    if (!currentQuestion) return true;
    if (!currentQuestion.required) return true;
    return (selectedAnswers[currentQuestion.id]?.length ?? 0) > 0;
  })();

  const primaryButtonClass = 'w-full py-3 px-6 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed';
  const secondaryButtonClass = 'flex-1 py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="invite-backdrop fixed inset-0 z-[200] flex items-center justify-center overflow-hidden p-4">
      {settings.bg && (
        <div
          className="absolute inset-0"
          style={bgStyle}
        />
      )}
      <div
        aria-hidden="true"
        className="invite-orb-a pointer-events-none fixed left-[-160px] bottom-[-190px] h-[460px] w-[460px] rounded-full opacity-80 blur-[8px]"
      />
      <div
        aria-hidden="true"
        className="invite-orb-b pointer-events-none fixed right-[-130px] top-[88px] h-[390px] w-[390px] rounded-full opacity-70 blur-[7px]"
      />
      <div
        aria-hidden="true"
        className="invite-stars pointer-events-none fixed inset-0"
      />
      {settings.bg && <div className="absolute inset-0 bg-black/60" />}

      <div className="relative z-10 w-full max-w-lg mx-4">
        <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={motionProfile.tabSwap}
        >
        {/* ── Arrival ── */}
        {step === 'arrival' && (
          <div className="invite-card-breathe bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 text-center space-y-6 border border-gray-700/50">
            {previewOnly && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onComplete}
                  className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-400 hover:text-gray-100"
                >
                  Close Preview
                </button>
              </div>
            )}
            {serverIconUrl && (
              <img src={serverIconUrl} alt="Server" className="w-28 h-28 mx-auto object-contain" />
            )}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-gray-100">
                Arriving at {serverInfo?.name ?? 'this Realm'}
              </h1>
              <p className="text-gray-400">
                {previewOnly
                  ? 'Preview the onboarding flow exactly as users will see it.'
                  : 'This Realm is going to ask you some stuff before entering...'}
              </p>
            </div>
            <button
              onClick={goToNextStep}
              className={`${primaryButtonClass} text-lg`}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Question ── */}
        {currentQuestion && (
          <div className="invite-card-breathe bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 space-y-6 border border-gray-700/50">
            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Question {currentQuestionIndex + 1} of {questions.length}
              </p>
              <h2 className="text-xl font-bold text-gray-100">{currentQuestion.question}</h2>
              {currentQuestion.allow_multiple && (
                <p className="text-xs text-gray-500">Select all that apply</p>
              )}
            </div>

            <div className="space-y-2">
              {currentQuestion.answers.map((a) => {
                const isSelected = (selectedAnswers[currentQuestion.id] ?? []).includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAnswer(currentQuestion.id, a.id, currentQuestion.allow_multiple)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-violet-500 bg-violet-500/20 text-gray-100'
                        : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                    }`}
                  >
                    {a.emoji && (
                      a.emoji.includes(':')
                        ? (
                          <MessageFormatter
                            text={a.emoji}
                            className="shrink-0 leading-none"
                            inlineEmoteSizePxOverride={24}
                          />
                        )
                        : <span className="text-xl shrink-0">{a.emoji}</span>
                    )}
                    <span className="font-medium">{a.text}</span>
                    {isSelected && (
                      <span className="ml-auto shrink-0 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs"><Check className="h-3 w-3" /></span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              {!currentQuestion.required && (
                <button
                  onClick={goToNextStep}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 font-medium transition-colors"
                >
                  Skip
                </button>
              )}
              <button
                onClick={goToNextStep}
                disabled={!canNext}
                className={secondaryButtonClass}
              >
                {currentQuestionIndex < questions.length - 1 ? 'Next' : 'Finish'}
              </button>
            </div>
          </div>
        )}

        {/* ── Rules ── */}
        {step === 'rules' && (
          <div className="invite-card-breathe bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-700/50 flex flex-col max-h-[85vh]">
            <div className="p-8 pb-4 shrink-0">
              <h2 className="text-2xl font-bold text-gray-100">Realm Rules</h2>
              <p className="text-gray-400 text-sm mt-1">Please read and accept the rules before entering</p>
            </div>

            <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-3">
              {settings.rulesMode === 'structured' ? (
                settings.rules.map((r, idx) => (
                  <div key={r.id} className="flex gap-3 text-gray-300 text-sm">
                    <span className="font-bold text-violet-400 shrink-0">{idx + 1}.</span>
                    <p>{r.content}</p>
                  </div>
                ))
              ) : (
                <div className="max-w-none text-sm leading-relaxed text-gray-300">
                  <MessageFormatter
                    text={settings.rulesMarkdown}
                    className="text-sm leading-relaxed text-gray-300 [&_a]:text-violet-300 [&_a:hover]:text-violet-200 [&_code]:text-violet-200 [&_.text-accent]:text-violet-300"
                    allowLinks
                  />
                </div>
              )}
            </div>

            <div className="p-8 pt-4 border-t border-gray-700 space-y-4 shrink-0">
              {error && (
                <div className="text-red-400 text-sm">{error}</div>
              )}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rulesAccepted}
                  onChange={(e) => setRulesAccepted(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-300 text-sm">I have read and agree to the rules</span>
              </label>
              <button
                onClick={goToNextStep}
                disabled={!rulesAccepted}
                className={primaryButtonClass}
              >
                {previewOnly ? 'Finish Preview' : 'Enter the Realm'}
              </button>
            </div>
          </div>
        )}

        {/* ── Completing ── */}
        {step === 'completing' && (
          <div className="invite-card-breathe bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 text-center space-y-4 border border-gray-700/50">
            <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-300 font-medium">Entering the Realm...</p>
          </div>
        )}
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
