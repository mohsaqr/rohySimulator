// courseTutor — chatoyon adaptation of LAILA-v3 client/src/api/courseTutor.ts.
// LAILA's CourseTutor rows (per-course tutor assignments with custom* overrides)
// map to chatoyon's ClassroomAgent rows (the class's assigned agents). The
// return shape mirrors LAILA's so SectionListEditor's picker code reads it
// unchanged, plus `agentConfigId` — the reference a chatbot section stores so
// its chat runs through a real Conversation with the class-assigned agent.
import apiClient from './client';

// classroomId is chatoyon's class uuid (LAILA passed a numeric course id).
export const getCourseTutors = async (classroomId) => {
  const [assignedRes, agentsRes] = await Promise.all([
    apiClient.get(`/classrooms/${classroomId}/agents`),
    apiClient.get(`/agents`),
  ]);
  const detailById = new Map((agentsRes.data.agents ?? []).map((a) => [a.id, a]));
  return (assignedRes.data.agents ?? []).map((row) => {
    const detail = detailById.get(row.id);
    return {
      id: row.id,
      agentConfigId: row.id,
      isActive: row.isActive,
      customName: null,
      customDescription: null,
      customSystemPrompt: null,
      customWelcomeMessage: null,
      chatbot: {
        displayName: row.displayName,
        description: detail?.persona ?? null,
        systemPrompt: null,
        welcomeMessage: detail?.welcomeMessage ?? null,
        avatarUrl: detail?.avatarUrl ?? null,
      },
    };
  });
};
