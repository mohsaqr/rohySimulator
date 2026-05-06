// renderWithProviders mounts a component inside the same provider stack
// App.jsx uses (AuthProvider, ToastProvider, VoiceProvider,
// NotificationProvider, optional PatientRecordProvider).
//
// Each provider can be opted out by passing `withX: false`, or replaced
// with a custom wrapper for advanced tests. The default stack mirrors what
// `<App>` mounts so tests of leaf components don't have to know about
// every context the tree depends on.
//
// Returns RTL's render result. Future iterations may attach refs to the
// provider state so tests can read context values directly without
// rendering an inspector component.

import React from 'react';
import { render } from '@testing-library/react';
import { AuthProvider } from '../../src/contexts/AuthContext.jsx';
import { ToastProvider } from '../../src/contexts/ToastContext.jsx';
import { VoiceProvider } from '../../src/contexts/VoiceContext.jsx';
import { NotificationProvider } from '../../src/notifications/NotificationContext.jsx';
import { PatientRecordProvider } from '../../src/services/PatientRecord/PatientRecordContext.jsx';

// Cheap identity wrapper used when a provider is opted out.
function Pass({ children }) { return children; }

/**
 * Mount `ui` inside a configurable provider stack.
 *
 * @param {React.ReactNode} ui
 * @param {object} [opts]
 * @param {boolean} [opts.withAuth=true]
 * @param {boolean} [opts.withToast=true]
 * @param {boolean} [opts.withVoice=true]
 * @param {boolean} [opts.withNotifications=true]
 * @param {boolean} [opts.withPatientRecord=false]   // opt-in (needs a sessionId/caseId)
 * @param {object}  [opts.patientRecord]             // { sessionId, caseId, patientInfo }
 * @param {React.ComponentType} [opts.ExtraWrapper]  // additional outermost wrapper
 * @param {import('@testing-library/react').RenderOptions} [opts.renderOptions]
 * @returns {import('@testing-library/react').RenderResult}
 */
export function renderWithProviders(ui, opts = {}) {
    const {
        withAuth = true,
        withToast = true,
        withVoice = true,
        withNotifications = true,
        withPatientRecord = false,
        patientRecord = {},
        ExtraWrapper = Pass,
        renderOptions = {},
    } = opts;

    const Auth = withAuth ? AuthProvider : Pass;
    const Notifications = withNotifications ? NotificationProvider : Pass;
    const Toast = withToast ? ToastProvider : Pass;
    const Voice = withVoice ? VoiceProvider : Pass;
    // PatientRecord requires a sessionId/caseId/patientInfo; only mount if
    // explicitly requested. Tests that don't touch the record can leave it
    // out.
    const PR = withPatientRecord
        ? ({ children }) => (
            <PatientRecordProvider
                sessionId={patientRecord.sessionId ?? null}
                caseId={patientRecord.caseId ?? null}
                patientInfo={patientRecord.patientInfo ?? null}
            >
                {children}
            </PatientRecordProvider>
        )
        : Pass;

    function Wrapper({ children }) {
        return (
            <ExtraWrapper>
                <Auth>
                    <Notifications>
                        <Toast>
                            <Voice>
                                <PR>{children}</PR>
                            </Voice>
                        </Toast>
                    </Notifications>
                </Auth>
            </ExtraWrapper>
        );
    }

    return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export default renderWithProviders;
