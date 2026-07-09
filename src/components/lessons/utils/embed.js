/** Convert a YouTube/Vimeo share link to its embeddable form (or return the
 *  input unchanged for any other URL). Shared by the lesson-section and
 *  course-topic editors. */
export const toEmbedUrl = (raw) => {
  const u = raw.trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return u;
};
