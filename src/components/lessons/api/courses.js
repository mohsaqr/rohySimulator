// coursesApi — the lecture + section surface of LAILA-v3 client/src/api/courses.ts,
// function bodies verbatim. Trimmed to the endpoints chatoyon implements (the
// course/module/forum/quiz functions were dropped with the curriculum layer).
// The ONE contract alias: `moduleId` params carry a chatoyon classroom id
// (string uuid), because lessons attach straight to the class.
import apiClient from './client';

export const coursesApi = {
  // Lectures
  getLectures: async (moduleId, { includeSections = false } = {}) => {
    const suffix = includeSections ? '?include=sections' : '';
    const response = await apiClient.get(`/courses/modules/${moduleId}/lectures${suffix}`);
    return response.data.data;
  },

  getLectureById: async (lectureId) => {
    const response = await apiClient.get(`/courses/lectures/${lectureId}`);
    return response.data.data;
  },

  createLecture: async (moduleId, data) => {
    const response = await apiClient.post(`/courses/modules/${moduleId}/lectures`, data);
    return response.data.data;
  },

  updateLecture: async (lectureId, data) => {
    const response = await apiClient.put(`/courses/lectures/${lectureId}`, data);
    return response.data.data;
  },

  deleteLecture: async (lectureId) => {
    const response = await apiClient.delete(`/courses/lectures/${lectureId}`);
    return response.data;
  },

  duplicateLecture: async (lectureId) => {
    const response = await apiClient.post(`/courses/lectures/${lectureId}/duplicate`);
    return response.data.data;
  },

  reorderLectures: async (moduleId, lectureIds) => {
    const response = await apiClient.put(
      `/courses/modules/${moduleId}/lectures/reorder`,
      { lectureIds }
    );
    return response.data;
  },

  // Sections
  getSections: async (lectureId) => {
    const response = await apiClient.get(
      `/courses/lectures/${lectureId}/sections`
    );
    return response.data.data;
  },

  createSection: async (lectureId, data) => {
    const response = await apiClient.post(
      `/courses/lectures/${lectureId}/sections`,
      data
    );
    return response.data.data;
  },

  updateSection: async (sectionId, data) => {
    const response = await apiClient.put(
      `/courses/sections/${sectionId}`,
      data
    );
    return response.data.data;
  },

  deleteSection: async (sectionId) => {
    const response = await apiClient.delete(
      `/courses/sections/${sectionId}`
    );
    return response.data;
  },

  reorderSections: async (lectureId, sectionIds) => {
    const response = await apiClient.put(
      `/courses/lectures/${lectureId}/sections/reorder`,
      { sectionIds }
    );
    return response.data;
  },

  // Progress (chatoyon: LAILA exposed this via enrollmentsApi.markLectureComplete)
  markLectureComplete: async (lectureId) => {
    const response = await apiClient.post(
      `/courses/lectures/${lectureId}/complete`
    );
    return response.data;
  },
};
