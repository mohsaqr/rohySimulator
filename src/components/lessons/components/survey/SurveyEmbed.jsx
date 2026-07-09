import { useState, useEffect } from 'react';
import { surveysApi } from '../../api/surveys';
import { SurveyRenderer } from './SurveyRenderer';
import { SurveyCompletedCard } from './SurveyCompletedCard';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Loading } from '../common/Loading';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme';

/**
 * SurveyEmbed - Drop-in component for embedding surveys anywhere
 *
 * Usage:
 * <SurveyEmbed surveyId={123} />
 * <SurveyEmbed surveyId={123} context="lecture" contextId={456} />
 * <SurveyEmbed surveyId={123} compact onComplete={() => console.log('done!')} />
 */
export const SurveyEmbed = ({
  surveyId,
  context = 'standalone',
  contextId,
  moduleId,
  courseId,
  onComplete,
  compact = false,
  showTitle = true,
}) => {
  const { isDark } = useTheme();
  const { user } = useAuthStore();
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [checkingCompletion, setCheckingCompletion] = useState(false);

  useEffect(() => {
    const fetchSurvey = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch survey data
        const surveyData = await surveysApi.getSurveyById(surveyId);
        setSurvey(surveyData);

        // Check if user has already completed this survey (if logged in)
        if (user && !surveyData.isAnonymous) {
          setCheckingCompletion(true);
          try {
            const { completed: isCompleted } = await surveysApi.checkIfCompleted(surveyId, moduleId);
            setCompleted(isCompleted);
          } catch {
            // If check fails, assume not completed
          }
          setCheckingCompletion(false);
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load survey');
      } finally {
        setLoading(false);
      }
    };

    fetchSurvey();
  }, [surveyId, user]);

  const handleComplete = () => {
    setCompleted(true);
    onComplete?.();
  };

  if (loading || checkingCompletion) {
    return compact ? (
      <div className="flex items-center justify-center py-4">
        <Loading size="sm" />
      </div>
    ) : (
      <Card>
        <CardBody className="flex items-center justify-center py-8">
          <Loading />
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return compact ? (
      <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
        {error}
      </div>
    ) : (
      <Card>
        <CardBody className="text-center py-8">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </CardBody>
      </Card>
    );
  }

  if (!survey) {
    return null;
  }

  if (completed) {
    return <SurveyCompletedCard compact={compact} />;
  }

  if (compact) {
    return (
      <div
        className="p-4 rounded-lg border"
        style={{
          backgroundColor: isDark ? '#1e293b' : '#ffffff',
          borderColor: isDark ? '#334155' : '#e2e8f0',
        }}
      >
        {showTitle && (
          <h3
            className="font-semibold mb-3"
            style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
          >
            {survey.title}
          </h3>
        )}
        <SurveyRenderer
          survey={survey}
          context={context}
          contextId={contextId}
          moduleId={moduleId}
          courseId={courseId}
          onComplete={handleComplete}
          compact
        />
      </div>
    );
  }

  return (
    <Card>
      {showTitle && (
        <CardHeader>
          <h2
            className="text-xl font-semibold"
            style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
          >
            {survey.title}
          </h2>
          {survey.description && (
            <p
              className="mt-1 text-sm"
              style={{ color: isDark ? '#94a3b8' : '#64748b' }}
            >
              {survey.description}
            </p>
          )}
        </CardHeader>
      )}
      <CardBody>
        <SurveyRenderer
          survey={survey}
          context={context}
          contextId={contextId}
          moduleId={moduleId}
          courseId={courseId}
          onComplete={handleComplete}
        />
      </CardBody>
    </Card>
  );
};
