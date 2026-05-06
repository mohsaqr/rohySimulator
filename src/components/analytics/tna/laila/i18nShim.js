// Minimal stand-in for react-i18next's `useTranslation` hook used in the
// LAILA TNA components copied verbatim into this tree. rohySimulator is
// English-only today; if/when locales are added, swap this for the real
// library and the call sites stay unchanged.
//
// `t(key)` renders a humanised version of any key it doesn't know about
// (turns 'network_density' → 'Network density'). This means brand-new
// LAILA keys we haven't curated below still display readable text; the
// short list below covers the keys whose default humanisation looks
// awkward in the UI ("Tna network" instead of "Transition network").

const OVERRIDES = {
    activity_tab: 'Activity',
    network: 'Network',
    clusters_title: 'Clusters',
    patterns_title: 'Patterns',
    analytics_settings: 'Settings',
    analytics: 'Analytics',
    course_analytics: 'Course Analytics',
    my_analytics: 'My Analytics',
    loading_analytics: 'Loading analytics…',
    sequences_count: 'Sequences',
    events_count: 'Events',
    states_count: 'States',
    object_types: 'Object types',
    raw_combinations: 'Raw combinations',
    verbs_count: 'Verbs',
    network_density: 'Density',
    edges_count: 'Edges',
    prune_threshold: 'Prune threshold',
    model_type: 'Model',
    model_relative: 'Relative',
    model_frequency: 'Frequency',
    model_cooccurrence: 'Co-occurrence',
    model_attention: 'Attention',
    course: 'Case',
    all_courses: 'All cases',
    select_student: 'Student',
    all_students: 'All students',
    start_date: 'Start',
    end_date: 'End',
    refresh: 'Refresh',
    your_activity: 'Your activity over the selected period.',
    total_activities: 'Total events',
    unique_users: 'Unique users',
    unique_sessions: 'Sessions',
    my_sessions: 'My sessions',
    avg_per_user: 'Avg / user',
    no_data: 'No data',
    patterns_found: 'patterns',
    pattern_lengths: 'Lengths',
    computing_patterns: 'Computing patterns…',
    cluster: 'Cluster',
    sequences: 'Sequences',
    avg_length: 'Avg length',
    in_strength: 'In-strength',
    'sna.layout_circle': 'Circle',
    'sna.layout_force': 'Force',
    'sna.layout_kamada_kawai': 'Kamada–Kawai',
    'sna.layout_spectral': 'Spectral',
    'sna.layout_concentric': 'Concentric',
    'sna.layout_star': 'Star',
    'sna.layout_hierarchical': 'Hierarchical',
    'sna.layout_grid': 'Grid',
    'sna.layout_random': 'Random',
    fixed_size: 'Fixed',
};

function humanise(key) {
    if (!key) return '';
    const last = String(key).split(':').pop();
    return last.replace(/_/g, ' ').replace(/^(\w)/, (m) => m.toUpperCase());
}

export function t(key) {
    if (OVERRIDES[key]) return OVERRIDES[key];
    return humanise(key);
}

// LAILA components call `useTranslation([...namespaces])` and destructure `t`.
// Provide the same shape so the copied code needs no edits beyond the import line.
export function useTranslation(/* _namespaces */) {
    return { t };
}
