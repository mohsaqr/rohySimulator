// Client-side entry point for the persona dos/donts block. The canonical
// module lives at server/shared/personaBlocks.js because the server assembles
// team-agent personas too, and the Docker runtime image ships server/ but not
// src/.
export { buildPersonaBlocks } from '../../server/shared/personaBlocks.js';
