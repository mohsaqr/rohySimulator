import { initialsOf, isImageAvatar } from './onCallModel';

// The prototype's avatar: an initials disc tinted with the specialty colour
// (or a 2D photo when the agent has one), with a presence dot. The name is
// announced by the surrounding row, so the disc is decorative.
//
// presence: 'online' (green dot) | 'away' (amber dot: must be paged) | null
export default function OnCallAvatar({ agent, big = false, presence = null }) {
    const classes = [
        'avatar',
        `spec-${agent?.agent_type || 'other'}`,
        big ? 'big' : '',
        presence === 'online' ? 'online' : presence === 'away' ? 'away' : '',
    ].filter(Boolean).join(' ');
    return (
        <span className={classes} aria-hidden="true">
            {isImageAvatar(agent?.avatar_url)
                ? <img src={agent.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : initialsOf(agent?.name)}
        </span>
    );
}
