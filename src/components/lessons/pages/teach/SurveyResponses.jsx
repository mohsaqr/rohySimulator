// Survey responses — copied from LAILA-v3 client/src/pages/teach/SurveyResponses.tsx.
// Page seam adapted: react-router params → props (surveyId + optional
// classroomId), navigation → next/navigation; the course/module breadcrumb
// queries dropped (chatoyon surveys are class activities).
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Users, FileText } from 'lucide-react';
import { surveysApi } from '../../api/surveys';
import { Card, CardHeader, CardBody } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Breadcrumb } from '../../components/common/Breadcrumb';
import { useTheme } from '../../hooks/useTheme';
import activityLogger from '../../services/activityLogger';

// TODO(mount): onBack (was router.back) is injected by the mounting layer to
// perform real navigation.
export const SurveyResponses = ({ surveyId: surveyIdProp, classroomId, onBack = () => {} }) => {
  const { t } = useTranslation(['teaching', 'common', 'navigation']);
  const surveyId = String(surveyIdProp);
  const courseId = classroomId;
  const moduleId = classroomId;
  const { isDark } = useTheme();


  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['surveyResponses', surveyId, moduleId],
    queryFn: () => surveysApi.getResponses(parseInt(surveyId), moduleId),
    enabled: !!surveyId,
  });

  useEffect(() => {
    if (surveyId) {
      activityLogger.logSurveyResponsesViewed(parseInt(surveyId), courseId);
    }
  }, [surveyId, courseId]);

  const error = queryError ? (queryError.response?.data?.message || 'Failed to load responses') : null;
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState('summary');

  const handleExport = async () => {
    if (!surveyId) return;
    setExporting(true);
    try {
      const blob = await surveysApi.exportResponses(parseInt(surveyId));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `survey-${surveyId}-responses.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export responses:', err.response?.data?.message || err.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loading />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 mb-4">{error || 'No data found'}</p>
            <Button onClick={() => onBack()}>{t('common:go_back', { defaultValue: 'Go back' })}</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <div className="mb-6">
        <Breadcrumb
          homeHref="/"
          items={[
            { label: t('navigation:courses', { defaultValue: 'Classes' }), href: '/classes' },
            ...(courseId ? [{ label: 'Class', href: `/classes/${courseId}` }] : []),
            { label: data.survey.title },
          ]}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <h1
            className="text-xl sm:text-2xl font-bold"
            style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
          >
            {data.survey.title} - {t('responses')}
          </h1>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2">
            <span
              className="flex items-center gap-1"
              style={{ color: isDark ? '#94a3b8' : '#64748b' }}
            >
              <Users className="w-4 h-4" />
              {t('responses_stat', { count: data.totalResponses })}
            </span>
            {data.survey.isAnonymous && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                {t('anonymous_badge')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: isDark ? '#334155' : '#e2e8f0' }}
          >
            <button
              onClick={() => setViewMode('summary')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'summary'
                  ? 'bg-teal-600 text-white'
                  : isDark
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {t('summary_view')}
            </button>
            <button
              onClick={() => setViewMode('individual')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'individual'
                  ? 'bg-teal-600 text-white'
                  : isDark
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {t('individual_view')}
            </button>
          </div>
          <Button onClick={handleExport} loading={exporting} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            {t('export_csv')}
          </Button>
        </div>
      </div>

      {data.totalResponses === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto mb-4 text-slate-400" />
            <p
              className="text-lg"
              style={{ color: isDark ? '#94a3b8' : '#64748b' }}
            >
              {t('no_responses_yet')}
            </p>
          </CardBody>
        </Card>
      ) : viewMode === 'summary' ? (
        <div className="space-y-6">
          {data.questionStats.map((stat, index) => (
            <Card key={stat.questionId}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className="text-sm font-medium"
                      style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                    >
                      {t('question_number', { number: index + 1 })}
                    </span>
                    <h3
                      className="font-semibold mt-1"
                      style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
                    >
                      {stat.questionText}
                    </h3>
                  </div>
                  <span
                    className="text-sm"
                    style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                  >
                    {t('responses_stat', { count: stat.totalResponses })}
                  </span>
                </div>
              </CardHeader>
              <CardBody>
                {stat.questionType === 'free_text' ? (
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {stat.responses?.map((response, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg"
                        style={{
                          backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                        }}
                      >
                        <p style={{ color: isDark ? '#e2e8f0' : '#334155' }}>
                          {response}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {stat.optionCounts &&
                      (stat.options || Object.keys(stat.optionCounts)).map((option) => {
                        const count = stat.optionCounts?.[option] || 0;
                        const percentage =
                          stat.totalResponses > 0
                            ? Math.round((count / stat.totalResponses) * 100)
                            : 0;
                        return (
                          <div key={option}>
                            <div className="flex items-center justify-between mb-1">
                              <span style={{ color: isDark ? '#e2e8f0' : '#334155' }}>
                                {option}
                              </span>
                              <span
                                className="text-sm"
                                style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                              >
                                {count} ({percentage}%)
                              </span>
                            </div>
                            <div
                              className="h-3 rounded-full overflow-hidden"
                              style={{
                                backgroundColor: isDark ? '#334155' : '#e2e8f0',
                              }}
                            >
                              <div
                                className="h-full bg-teal-600 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {data.responses.map((response, index) => (
            <Card key={response.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <span
                      className="text-sm font-medium"
                      style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                    >
                      Response #{index + 1}
                    </span>
                    {!data.survey.isAnonymous && response.user && (
                      <p
                        className="font-medium mt-1"
                        style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
                      >
                        {response.user.displayName}
                        <span
                          className="text-sm font-normal ml-2"
                          style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                        >
                          {response.user.email}
                        </span>
                      </p>
                    )}
                  </div>
                  <span
                    className="text-sm"
                    style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                  >
                    {new Date(response.completedAt).toLocaleString()}
                  </span>
                </div>
              </CardHeader>
              <CardBody>
                <div className="space-y-4">
                  {response.answers.map((answer, answerIndex) => (
                    <div key={answer.id}>
                      <p
                        className="text-sm font-medium mb-1"
                        style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                      >
                        {answer.question?.questionText || `Question ${answerIndex + 1}`}
                      </p>
                      <p style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}>
                        {Array.isArray(answer.answerValue)
                          ? answer.answerValue.join(', ')
                          : answer.answerValue}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
