import { useState } from 'react';
import { surveysApi } from '../../api/surveys';
import { SurveyQuestion } from './SurveyQuestion';
import { Button } from '../common/Button';
import { useTheme } from '../../hooks/useTheme';
import { activityLogger } from '../../services/activityLogger';

export const SurveyRenderer = ({
  survey,
  context = 'standalone',
  contextId,
  moduleId,
  courseId,
  onComplete,
  compact = false,
}) => {
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
          newErrors[question.id] = 'This question is required';
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
      setSubmitError(error.response?.data?.message || 'Failed to submit survey');
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
          Submit Survey
        </Button>
      </div>
    </div>
  );
};
