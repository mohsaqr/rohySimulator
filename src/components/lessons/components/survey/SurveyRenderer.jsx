import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { surveysApi } from '../../api/surveys';
import { SurveyQuestion } from './SurveyQuestion';
import { Button } from '../common/Button';
import { useTheme } from '../../hooks/useTheme';
import { activityLogger } from '../../services/activityLogger';

// The learner-facing reason a submission was refused, from the server's
// machine-readable `code` / HTTP status — never the raw server text, which is
// English and written for the log.
export function submitErrorMessage(t, error) {
  const status = error?.status;
  const code = error?.code ?? error?.body?.code ?? error?.response?.data?.code;
  if (status === 409) {
    return t('survey_error_already_answered', { defaultValue: 'You have already answered this survey.' });
  }
  if (code === 'survey_answer_required') {
    return t('survey_error_required', { defaultValue: 'Answer every required question.' });
  }
  if (code === 'survey_answer_too_long') {
    return t('survey_error_too_long', { defaultValue: 'One of your answers is too long. Shorten it and try again.' });
  }
  if (typeof code === 'string' && code.startsWith('survey_answer')) {
    return t('survey_error_invalid_answer', { defaultValue: 'One of your answers is not an option in this survey. Reload the page and try again.' });
  }
  if (status === 403) {
    return t('survey_error_not_enrolled', { defaultValue: 'You are not enrolled in this course.' });
  }
  return t('survey_error_submit_failed', { defaultValue: 'The survey could not be sent. Try again.' });
}

export const SurveyRenderer = ({
  survey,
  context = 'standalone',
  contextId,
  moduleId,
  courseId,
  onComplete,
  compact = false,
}) => {
  const { t } = useTranslation(['teaching', 'common']);
  const { isDark } = useTheme();
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    // Clear error when user starts answering
    if (errors[questionId]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[questionId];
        return newErrors;
      });
    }
  };

  const validateAnswers = () => {
    const newErrors = {};

    survey.questions?.forEach(question => {
      if (question.isRequired) {
        const answer = answers[question.id];
        if (!answer || (Array.isArray(answer) && answer.length === 0)) {
          newErrors[question.id] = t('survey_question_required', { defaultValue: 'Answer this question.' });
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateAnswers()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const formattedAnswers = Object.entries(answers)
        .filter(([_, value]) => value && (typeof value === 'string' ? value.trim() : value.length > 0))
        .map(([questionId, answerValue]) => ({
          questionId: parseInt(questionId),
          answerValue,
        }));

      await surveysApi.submitResponse(survey.id, {
        context,
        contextId,
        // chatoyon contract alias: the module context is the classroom uuid.
        classroomId: moduleId != null ? String(moduleId) : null,
        answers: formattedAnswers,
      });

      activityLogger.logSurveySubmitted(survey.id, survey.title, courseId, { context, contextId, questionCount: survey.questions?.length });
      onComplete?.();
    } catch (error) {
      setSubmitError(submitErrorMessage(t, error));
    } finally {
      setSubmitting(false);
    }
  };

  const questions = survey.questions || [];

  return (
    <div>
      {compact && survey.description && (
        <p
          className="text-sm mb-4"
          style={{ color: isDark ? '#94a3b8' : '#64748b' }}
        >
          {survey.description}
        </p>
      )}

      <div className={compact ? '' : 'space-y-6'}>
        {questions.map((question, index) => (
          <SurveyQuestion
            key={question.id}
            question={question}
            value={answers[question.id] || (question.questionType === 'multiple_choice' ? [] : '')}
            onChange={value => handleAnswerChange(question.id, value)}
            error={errors[question.id]}
            questionNumber={index + 1}
          />
        ))}
      </div>

      {submitError && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          {submitError}
        </div>
      )}

      <div className={`mt-6 ${compact ? '' : ''}`}>
        <Button
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting}
          className={compact ? 'w-full' : ''}
        >
          {t('survey_submit', { defaultValue: 'Submit survey' })}
        </Button>
      </div>
    </div>
  );
};
