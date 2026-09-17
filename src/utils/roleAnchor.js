// Client-side entry point for the role anchor. The canonical module lives at
// server/shared/roleAnchor.js because the server builds team-agent personas
// too, and the Docker runtime image ships server/ but not src/.
export { roleAnchor } from '../../server/shared/roleAnchor.js';
