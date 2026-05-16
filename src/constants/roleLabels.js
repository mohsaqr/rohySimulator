// Single source of truth for human-readable role labels. The STORED/TRANSMITTED
// role value is unchanged (e.g. `educator`) — this only maps that value to the
// text a human sees. `educator` is surfaced to users as "Teacher" per product
// decision; everything else keeps its existing capitalized label.

export const ROLE_LABELS = {
    guest: 'Guest',
    student: 'Student',
    user: 'User',
    reviewer: 'Reviewer',
    educator: 'Teacher',
    admin: 'Admin',
};

export function roleLabel(role) {
    if (!role) return '';
    return ROLE_LABELS[role] ?? role;
}
