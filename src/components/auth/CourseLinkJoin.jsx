import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotifications } from '../../notifications/useNotifications';
import { SOURCES, SEVERITY } from '../../notifications/types';
import { joinCohort } from '../../services/cohortsService';
import { previewInvite } from '../../services/registrationService';
import { clearInviteParam, readInviteParam, takeCourseCode } from '../../services/courseLink';

/**
 * Redeem a course registration link for someone who is signed in (PRV-67).
 *
 * Mounted once in the signed-in app. It looks for a course code in two
 * places: the address bar (the student was already signed in when they opened
 * the teacher's link) and the hand-off AuthGate left when they chose to sign in
 * rather than register (services/courseLink.js). Either way the code is joined
 * with POST /cohorts/join, which is tenant-scoped to the signed-in student.
 *
 * A registration invite (an admin's, for NEW accounts) opened while signed in
 * is not joined: the person is told the link is for creating an account.
 *
 * Renders nothing; the outcome is a notification.
 */
export default function CourseLinkJoin() {
    const { t } = useTranslation('auth');
    const { notify } = useNotifications();

    useEffect(() => {
        const fromUrl = readInviteParam();
        if (fromUrl) clearInviteParam();
        const code = fromUrl || takeCourseCode();
        if (!code) return;

        // Deliberately not cancelled on unmount: StrictMode's mount→unmount→mount
        // would otherwise drop the one join this link was opened for (the code
        // has already left the URL and the hand-off by then).
        (async () => {
            let preview = null;
            try {
                preview = await previewInvite(code);
            } catch {
                // The preview is only a hint; the join below is the real answer.
            }
            if (preview?.valid && preview.kind !== 'course') {
                notify({
                    source: SOURCES.USER, severity: SEVERITY.INFO, key: 'course-link',
                    message: t('course_link_invite_signed_in'),
                });
                return;
            }
            try {
                const data = await joinCohort(code);
                notify({
                    source: SOURCES.USER, severity: SEVERITY.SUCCESS, key: 'course-link',
                    message: t('course_link_joined', { course: data?.cohort?.name || '' }),
                });
            } catch (err) {
                notify({
                    source: SOURCES.SYSTEM, severity: SEVERITY.ERROR, key: 'course-link',
                    message: err?.code === 'COHORT_DELETED'
                        ? t('course_link_closed')
                        : t('course_link_not_found'),
                });
            }
        })();
        // Mount only: the link is read once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
}
