// Survey manager — copied from LAILA-v3 client/src/pages/teach/SurveyManager.tsx.
// Page seams adapted: react-router params → an optional classroomId prop; the
// course breadcrumb query dropped; the AI SurveyGenerator modal not copied
// (it rides LAILA's llmService — chatoyon can wire its own provider later).
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  EyeOff,
  GripVertical,
  ListChecks,
  Plus,
  Trash2,
} from 'lucide-react';
import { surveysApi } from '../../api/surveys';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { Breadcrumb } from '../../components/common/Breadcrumb';
import { DataTable } from '../../components/common/DataTable';
import { RowMenu } from '../../components/common/RowMenu';
import { useTheme } from '../../hooks/useTheme';
import activityLogger from '../../services/activityLogger';

export const SurveyManager = ({ classroomId, onViewResponses } = {}) => {
  const { t } = useTranslation(['teaching', 'common', 'navigation']);
  const courseId = classroomId;
  const { isDark } = useTheme();

  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [expandedSurveyId, setExpandedSurveyId] = useState(null);

  // Form states
  const [surveyForm, setSurveyForm] = useState({
    title: '',
    description: '',
    isAnonymous: false,
  });
  const [questionForm, setQuestionForm] = useState({
    questionText: '',
    questionType: 'single_choice',
    options: [''],
    isRequired: true,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    activityLogger.logSurveyManagerViewed(courseId);
  }, [courseId]);

  const fetchSurveys = async () => {
    try {
      setLoading(true);
      const data = await surveysApi.getSurveys(courseId);
      setSurveys(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load surveys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSurveys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const handleCreateSurvey = async () => {
    if (!surveyForm.title.trim()) return;
    setSubmitting(true);
    try {
      const newSurvey = await surveysApi.createSurvey(surveyForm);
      // This manager is class-scoped (list = /surveys?courseId=): a survey
      // created here must be attached to the class or it vanishes from the
      // list on refresh and never reaches students.
      if (courseId != null) {
        await surveysApi.addSurveyToModule(courseId, courseId, newSurvey.id);
      }
      activityLogger.logSurveyCreated(newSurvey.id, newSurvey.title, courseId);
      setSurveys(prev => [newSurvey, ...prev]);
      setShowCreateModal(false);
      setSurveyForm({ title: '', description: '', isAnonymous: false });
      setExpandedSurveyId(newSurvey.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create survey');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSurvey = async () => {
    if (!selectedSurvey || !surveyForm.title.trim()) return;
    setSubmitting(true);
    try {
      const updated = await surveysApi.updateSurvey(selectedSurvey.id, surveyForm);
      setSurveys(prev =>
        prev.map(s => (s.id === updated.id ? { ...s, ...updated } : s))
      );
      setShowEditModal(false);
      setSelectedSurvey(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update survey');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSurvey = async () => {
    if (!selectedSurvey) return;
    setSubmitting(true);
    try {
      await surveysApi.deleteSurvey(selectedSurvey.id);
      setSurveys(prev => prev.filter(s => s.id !== selectedSurvey.id));
      setShowDeleteModal(false);
      setSelectedSurvey(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete survey');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishSurvey = async (survey) => {
    try {
      await surveysApi.publishSurvey(survey.id);
      setSurveys(prev =>
        prev.map(s => (s.id === survey.id ? { ...s, isPublished: true } : s))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to publish survey');
    }
  };

  const handleTogglePublish = async (survey) => {
    if (!survey.isPublished) {
      return handlePublishSurvey(survey);
    }
    try {
      const updated = await surveysApi.updateSurvey(survey.id, { isPublished: false });
      setSurveys(prev =>
        prev.map(s => (s.id === survey.id ? { ...s, ...updated } : s))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to unpublish survey');
    }
  };

  const handleAddQuestion = async () => {
    if (!selectedSurvey || !questionForm.questionText.trim()) return;
    setSubmitting(true);
    try {
      const filteredOptions =
        questionForm.questionType !== 'free_text'
          ? questionForm.options?.filter(o => o.trim()) || []
          : undefined;

      const newQuestion = await surveysApi.addQuestion(selectedSurvey.id, {
        ...questionForm,
        options: filteredOptions,
      });

      // Update local state
      setSurveys(prev =>
        prev.map(s => {
          if (s.id === selectedSurvey.id) {
            return {
              ...s,
              questions: [...(s.questions || []), newQuestion],
              _count: { ...s._count, questions: (s._count?.questions || 0) + 1 },
            };
          }
          return s;
        })
      );

      setShowQuestionModal(false);
      setQuestionForm({
        questionText: '',
        questionType: 'single_choice',
        options: [''],
        isRequired: true,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add question');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateQuestion = async () => {
    if (!selectedSurvey || !editingQuestion || !questionForm.questionText.trim()) return;
    setSubmitting(true);
    try {
      const filteredOptions =
        questionForm.questionType !== 'free_text'
          ? questionForm.options?.filter(o => o.trim()) || []
          : undefined;

      const updated = await surveysApi.updateQuestion(
        selectedSurvey.id,
        editingQuestion.id,
        {
          ...questionForm,
          options: filteredOptions,
        }
      );

      setSurveys(prev =>
        prev.map(s => {
          if (s.id === selectedSurvey.id) {
            return {
              ...s,
              questions: s.questions?.map(q =>
                q.id === updated.id ? updated : q
              ),
            };
          }
          return s;
        })
      );

      setShowQuestionModal(false);
      setEditingQuestion(null);
      setQuestionForm({
        questionText: '',
        questionType: 'single_choice',
        options: [''],
        isRequired: true,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update question');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteQuestion = async (survey, questionId) => {
    try {
      await surveysApi.deleteQuestion(survey.id, questionId);
      setSurveys(prev =>
        prev.map(s => {
          if (s.id === survey.id) {
            return {
              ...s,
              questions: s.questions?.filter(q => q.id !== questionId),
              _count: { ...s._count, questions: (s._count?.questions || 1) - 1 },
            };
          }
          return s;
        })
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete question');
    }
  };

  const openEditModal = (survey) => {
    setSelectedSurvey(survey);
    setSurveyForm({
      title: survey.title,
      description: survey.description || '',
      isAnonymous: survey.isAnonymous,
    });
    setShowEditModal(true);
  };

  const openQuestionModal = (survey, question) => {
    setSelectedSurvey(survey);
    if (question) {
      setEditingQuestion(question);
      setQuestionForm({
        questionText: question.questionText,
        questionType: question.questionType,
        options: question.options || [''],
        isRequired: question.isRequired,
      });
    } else {
      setEditingQuestion(null);
      setQuestionForm({
        questionText: '',
        questionType: 'single_choice',
        options: [''],
        isRequired: true,
      });
    }
    setShowQuestionModal(true);
  };

  const toggleSurveyExpand = async (survey) => {
    if (expandedSurveyId === survey.id) {
      setExpandedSurveyId(null);
    } else {
      // Fetch full survey with questions if not already loaded
      if (!survey.questions) {
        try {
          const fullSurvey = await surveysApi.getSurveyById(survey.id);
          setSurveys(prev =>
            prev.map(s => (s.id === fullSurvey.id ? fullSurvey : s))
          );
        } catch (err) {
          console.error('Failed to fetch survey questions:', err);
        }
      }
      setExpandedSurveyId(survey.id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loading />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <div className="mb-6">
        <Breadcrumb
          homeHref="/"
          items={[
            ...(courseId
              ? [
                  { label: t('navigation:courses', { defaultValue: 'Classes' }), href: '/classes' },
                  { label: 'Class', href: `/classes/${courseId}` },
                ]
              : []),
            { label: t('surveys', { defaultValue: 'Surveys' }) },
          ]}
        />
      </div>


      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            {t('common:dismiss')}
          </button>
        </div>
      )}

      <SurveysTable
        surveys={surveys}
        courseId={courseId}
        onOpenEdit={openEditModal}
        onTogglePublish={handleTogglePublish}
        onAskDelete={s => {
          setSelectedSurvey(s);
          setShowDeleteModal(true);
        }}
        onToggleExpand={toggleSurveyExpand}
        expandedSurveyId={expandedSurveyId}
        onCreate={() => setShowCreateModal(true)}
      />

      {/* Question editor panel — shown below the table for the
          currently expanded survey. Triggered by the "Manage questions"
          row action. */}
      {expandedSurveyId != null && (
        (() => {
          const survey = surveys.find(s => s.id === expandedSurveyId);
          if (!survey) return null;
          return (
            <Card className="mt-4">
              <div
                className="p-4 border-b flex items-center justify-between"
                style={{ borderColor: isDark ? '#334155' : '#e2e8f0' }}
              >
                <div className="min-w-0">
                  <p
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                  >
                    {t('survey_questions', { defaultValue: 'Questions' })}
                  </p>
                  <p
                    className="text-sm font-semibold truncate mt-0.5"
                    style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
                  >
                    {survey.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedSurveyId(null)}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                  aria-label={t('common:close', { defaultValue: 'Close' })}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                {survey.questions && survey.questions.length > 0 ? (
                  <div className="space-y-3">
                    {survey.questions.map((question, index) => (
                      <div
                        key={question.id}
                        className="flex items-start gap-3 p-3 rounded-lg"
                        style={{ backgroundColor: isDark ? '#0f172a' : '#f8fafc' }}
                      >
                        <GripVertical
                          className="w-4 h-4 mt-1 cursor-grab"
                          style={{ color: isDark ? '#64748b' : '#94a3b8' }}
                        />
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <span
                                className="text-sm font-medium"
                                style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                              >
                                Q{index + 1}
                              </span>
                              <p
                                className="font-medium"
                                style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
                              >
                                {question.questionText}
                                {question.isRequired && (
                                  <span className="text-red-500 ml-1">*</span>
                                )}
                              </p>
                              <span
                                className="text-xs"
                                style={{ color: isDark ? '#64748b' : '#94a3b8' }}
                              >
                                {question.questionType.replace('_', ' ')}
                              </span>
                              {question.options && question.options.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {question.options.map((opt, i) => (
                                    <span
                                      key={i}
                                      className="text-xs px-2 py-0.5 rounded"
                                      style={{
                                        backgroundColor: isDark ? '#334155' : '#e2e8f0',
                                        color: isDark ? '#cbd5e1' : '#475569',
                                      }}
                                    >
                                      {opt}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openQuestionModal(survey, question)}
                              >
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteQuestion(survey, question.id)}
                              >
                                <Trash2 className="w-3 h-3 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p
                    className="text-sm text-center py-4"
                    style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                  >
                    {t('no_questions_yet')}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => openQuestionModal(survey)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {t('add_question')}
                </Button>
              </div>
            </Card>
          );
        })()
      )}

      {/* Create Survey Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('create_survey')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('title_label')}</label>
            <input
              type="text"
              value={surveyForm.title}
              onChange={e => setSurveyForm(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
              placeholder={t('survey_title_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('description_label')}</label>
            <textarea
              value={surveyForm.description}
              onChange={e => setSurveyForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
              rows={3}
              placeholder={t('optional_description')}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={surveyForm.isAnonymous}
              onChange={e => setSurveyForm(prev => ({ ...prev, isAnonymous: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">{t('anonymous_responses_desc')}</span>
          </label>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleCreateSurvey} loading={submitting}>
              {t('common:create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Survey Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={t('edit_survey')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('title_label')}</label>
            <input
              type="text"
              value={surveyForm.title}
              onChange={e => setSurveyForm(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('description_label')}</label>
            <textarea
              value={surveyForm.description}
              onChange={e => setSurveyForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
              rows={3}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={surveyForm.isAnonymous}
              onChange={e => setSurveyForm(prev => ({ ...prev, isAnonymous: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">{t('anonymous_responses')}</span>
          </label>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setShowEditModal(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleUpdateSurvey} loading={submitting}>
              {t('common:save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('delete_survey')}
        size="sm"
      >
        <p className="mb-4">
          {t('delete_survey_confirm', { title: selectedSurvey?.title })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="danger" onClick={handleDeleteSurvey} loading={submitting}>
            {t('common:delete')}
          </Button>
        </div>
      </Modal>

      {/* Question Modal */}
      <Modal
        isOpen={showQuestionModal}
        onClose={() => {
          setShowQuestionModal(false);
          setEditingQuestion(null);
        }}
        title={editingQuestion ? t('edit_question') : t('add_question')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('question_label')}</label>
            <input
              type="text"
              value={questionForm.questionText}
              onChange={e =>
                setQuestionForm(prev => ({ ...prev, questionText: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
              placeholder={t('enter_question_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('question_type_label')}</label>
            <select
              value={questionForm.questionType}
              onChange={e =>
                setQuestionForm(prev => ({
                  ...prev,
                  questionType: e.target.value,
                }))
              }
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
              style={{
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#cbd5e1',
                color: isDark ? '#f1f5f9' : '#0f172a',
              }}
            >
              <option value="single_choice">{t('single_choice_radio')}</option>
              <option value="multiple_choice">{t('multiple_choice_checkbox')}</option>
              <option value="free_text">{t('free_text')}</option>
            </select>
          </div>

          {questionForm.questionType !== 'free_text' && (
            <div>
              <label className="block text-sm font-medium mb-1">{t('options_label')}</label>
              <div className="space-y-2">
                {questionForm.options?.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={e => {
                        const newOptions = [...(questionForm.options || [])];
                        newOptions[index] = e.target.value;
                        setQuestionForm(prev => ({ ...prev, options: newOptions }));
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border focus:ring-2 focus:ring-teal-500"
                      style={{
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        borderColor: isDark ? '#334155' : '#cbd5e1',
                        color: isDark ? '#f1f5f9' : '#0f172a',
                      }}
                      placeholder={t('option_placeholder', { number: index + 1 })}
                    />
                    {(questionForm.options?.length || 0) > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newOptions = questionForm.options?.filter((_, i) => i !== index);
                          setQuestionForm(prev => ({ ...prev, options: newOptions }));
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setQuestionForm(prev => ({
                      ...prev,
                      options: [...(prev.options || []), ''],
                    }))
                  }
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t('add_option')}
                </Button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={questionForm.isRequired}
              onChange={e =>
                setQuestionForm(prev => ({ ...prev, isRequired: e.target.checked }))
              }
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">{t('required_question')}</span>
          </label>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={() => {
                setShowQuestionModal(false);
                setEditingQuestion(null);
              }}
            >
              {t('common:cancel')}
            </Button>
            <Button
              onClick={editingQuestion ? handleUpdateQuestion : handleAddQuestion}
              loading={submitting}
            >
              {editingQuestion ? t('common:save') : t('common:add')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

/**
 * Surveys list rendered with the shared DataTable so it matches the
 * /teach/quizzes design (title-case headers, filter card, 3-dot row
 * menu, paginated). Row actions are mapped to the parent's modals.
 */
const SurveysTable = ({
  surveys,
  courseId,
  onOpenEdit,
  onTogglePublish,
  onAskDelete,
  onToggleExpand,
  expandedSurveyId,
  onCreate,
}) => {
  const { t } = useTranslation(['teaching', 'common']);

  const columns = useMemo(() => [
    {
      id: 'title',
      header: t('teaching:survey_title', { defaultValue: 'Survey' }),
      sortAccessor: s => s.title.toLowerCase(),
      width: '38%',
      cell: s => (
        <button
          type="button"
          onClick={() => onToggleExpand(s)}
          className="block w-full text-left truncate font-normal text-slate-700 dark:text-slate-200 hover:text-teal-600 dark:hover:text-teal-400"
          title={s.title}
        >
          {s.title}
        </button>
      ),
    },
    {
      id: 'anonymous',
      header: t('teaching:anonymous_badge', { defaultValue: 'Anonymous' }),
      sortAccessor: s => (s.isAnonymous ? 1 : 0),
      width: '14%',
      cell: s =>
        s.isAnonymous ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
            {t('teaching:anonymous_badge', { defaultValue: 'Anonymous' })}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      id: 'questions',
      header: t('teaching:quiz_column_questions', { defaultValue: 'Questions' }),
      sortAccessor: s => s._count?.questions ?? 0,
      align: 'right',
      width: '7rem',
      cell: s => (
        <span className="text-slate-600 dark:text-slate-300 tabular-nums">
          {s._count?.questions ?? 0}
        </span>
      ),
    },
    {
      id: 'responses',
      header: t('teaching:responses', { defaultValue: 'Responses' }),
      sortAccessor: s => s._count?.responses ?? 0,
      align: 'right',
      width: '8rem',
      cell: s => (
        <span className="text-slate-600 dark:text-slate-300 tabular-nums">
          {s._count?.responses ?? 0}
        </span>
      ),
    },
  ], [t, onToggleExpand]);

  return (
    <DataTable
      rows={surveys}
      columns={columns}
      rowKey={s => s.id}
      pageSize={20}
      globalSearch={{
        placeholder: t('teaching:search_surveys_placeholder', {
          defaultValue: 'Search surveys…',
        }),
        predicate: (s, q) => s.title.toLowerCase().includes(q.toLowerCase()),
      }}
      createCta={{
        label: t('create_survey'),
        icon: <Plus className="w-4 h-4" />,
        onClick: onCreate,
      }}
      empty={
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
          <ListChecks className="w-4 h-4" />
          <span>{t('teaching:no_surveys_yet')}</span>
        </div>
      }
      rowActions={s => {
        const canPublish = (s._count?.questions ?? 0) > 0;
        return (
          <RowMenu
            items={[
              {
                key: 'questions',
                label:
                  expandedSurveyId === s.id
                    ? t('common:close', { defaultValue: 'Close' })
                    : t('teaching:add_question', { defaultValue: 'Manage questions' }),
                icon: expandedSurveyId === s.id ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                ),
                onClick: () => onToggleExpand(s),
              },
              {
                key: 'edit',
                label: t('common:edit', { defaultValue: 'Edit' }),
                icon: <Edit2 className="w-3.5 h-3.5" />,
                onClick: () => onOpenEdit(s),
              },
              {
                key: 'publish',
                label: s.isPublished
                  ? t('teaching:unpublish', { defaultValue: 'Unpublish' })
                  : t('teaching:publish', { defaultValue: 'Publish' }),
                icon: s.isPublished ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                ),
                onClick: () => onTogglePublish(s),
                disabled: !s.isPublished && !canPublish,
              },
              {
                key: 'responses',
                label: t('teaching:survey_responses', { defaultValue: 'Responses' }),
                icon: <BarChart3 className="w-3.5 h-3.5" />,
                onClick: () => {
                  // Mount seam: rohy is an SPA with no /surveys/:id/responses
                  // route — delegate to an injected handler when provided,
                  // else fall back to the LAILA URL.
                  if (typeof onViewResponses === 'function') onViewResponses(s.id);
                  else window.location.href = `/surveys/${s.id}/responses${courseId ? `?classroomId=${courseId}` : ''}`;
                },
              },
              {
                key: 'delete',
                label: t('common:delete', { defaultValue: 'Delete' }),
                icon: <Trash2 className="w-3.5 h-3.5" />,
                onClick: () => onAskDelete(s),
                destructive: true,
              },
            ]}
          />
        );
      }}
    />
  );
};
