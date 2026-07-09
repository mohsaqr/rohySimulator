// surveysApi — LAILA-v3 client/src/api/surveys.ts, function bodies verbatim.
// Contract aliases: courseId/moduleId params carry a chatoyon classroom uuid
// (string); AI generation dropped (no /surveys/generate endpoint here).
import apiClient from './client';

export const surveysApi = {
  // =============================================================================
  // SURVEY CRUD (Instructor)
  // =============================================================================

  getSurveys: async (courseId) => {
    const params = courseId ? `?courseId=${courseId}` : '';
    const response = await apiClient.get(`/surveys${params}`);
    return response.data.data;
  },

  getSurveyById: async (id) => {
    const response = await apiClient.get(`/surveys/${id}`);
    return response.data.data;
  },

  createSurvey: async (data) => {
    const response = await apiClient.post('/surveys', data);
    return response.data.data;
  },

  updateSurvey: async (id, data) => {
    const response = await apiClient.put(`/surveys/${id}`, data);
    return response.data.data;
  },

  deleteSurvey: async (id) => {
    const response = await apiClient.delete(`/surveys/${id}`);
    return response.data;
  },

  publishSurvey: async (id) => {
    const response = await apiClient.post(`/surveys/${id}/publish`);
    return response.data.data;
  },

  // =============================================================================
  // QUESTIONS
  // =============================================================================

  addQuestion: async (surveyId, data) => {
    const response = await apiClient.post(
      `/surveys/${surveyId}/questions`,
      data
    );
    return response.data.data;
  },

  updateQuestion: async (
    surveyId,
    questionId,
    data
  ) => {
    const response = await apiClient.put(
      `/surveys/${surveyId}/questions/${questionId}`,
      data
    );
    return response.data.data;
  },

  deleteQuestion: async (surveyId, questionId) => {
    const response = await apiClient.delete(
      `/surveys/${surveyId}/questions/${questionId}`
    );
    return response.data;
  },

  reorderQuestions: async (surveyId, questionIds) => {
    const response = await apiClient.post(
      `/surveys/${surveyId}/questions/reorder`,
      { questionIds }
    );
    return response.data;
  },

  // =============================================================================
  // RESPONSES (Student)
  // =============================================================================

  submitResponse: async (surveyId, data) => {
    const response = await apiClient.post(
      `/surveys/${surveyId}/submit`,
      data
    );
    return response.data.data;
  },

  checkIfCompleted: async (surveyId, moduleId) => {
    const params = moduleId ? `?moduleId=${moduleId}` : '';
    const response = await apiClient.get(
      `/surveys/${surveyId}/my-response${params}`
    );
    return response.data.data;
  },

  // =============================================================================
  // ANALYTICS (Instructor)
  // =============================================================================

  getResponses: async (surveyId, moduleId) => {
    const params = moduleId !== undefined ? `?moduleId=${moduleId}` : '';
    const response = await apiClient.get(
      `/surveys/${surveyId}/responses${params}`
    );
    return response.data.data;
  },

  exportResponses: async (surveyId) => {
    // Binary download — apiClient always JSON-parses, so use raw fetch but
    // carry the same Bearer token rohy's apiFetch sends (cookie-only auth is
    // not guaranteed in every deployment).
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`/api/surveys/${surveyId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },

  // Class surveys (LAILA module surveys — moduleId carries a classroom uuid)
  getModuleSurveys: async (moduleId) => {
    const response = await apiClient.get(`/surveys/module/${moduleId}`);
    return response.data.data;
  },

  addSurveyToModule: async (_courseId, moduleId, surveyId) => {
    const response = await apiClient.post(`/surveys/module/${moduleId}`, { surveyId });
    return response.data.data;
  },

  removeSurveyFromModule: async (moduleId, surveyId) => {
    const response = await apiClient.delete(`/surveys/module/${moduleId}/${surveyId}`);
    return response.data;
  },

  // =============================================================================
  // POLL — a single-question multiple-choice vote built on the survey backend.
  // A poll is just a one-`single_choice`-question survey attached to a module;
  // results come back through the standard survey analytics (optionCounts), so
  // no new model/migration is needed.
  // =============================================================================

  /**
   * Create a quick poll: a one-question (single_choice) survey, publish it, add
   * the choices, and attach it to a module so students see it on the course
   * page. Returns the created survey.
   */
  createPoll: async (params) => {
    const survey = await surveysApi.createSurvey({
      title: params.title,
      description: params.description,
      isPublished: params.isPublished ?? true,
      isAnonymous: params.isAnonymous ?? false,
    });
    await surveysApi.addQuestion(survey.id, {
      questionText: params.question,
      questionType: 'single_choice',
      options: params.options,
      isRequired: true,
      orderIndex: 0,
    });
    await surveysApi.addSurveyToModule(params.courseId, params.moduleId, survey.id);
    return survey;
  },
};
