import { useTranslation } from 'react-i18next';
import SessionNotesDrawer from '../common/SessionNotesDrawer';

// Thin wrapper around SessionNotesDrawer with the exam-screen title.
// Kept so existing imports from PhysicalExamScreen don't churn. New
// screens should reach for SessionNotesDrawer directly with their own
// title.
export default function ExamNotesDrawer({ open, onClose, sessionId }) {
    const { t } = useTranslation('examination');
    return (
        <SessionNotesDrawer
            open={open}
            onClose={onClose}
            sessionId={sessionId}
            title={t('exam_notes')}
        />
    );
}
