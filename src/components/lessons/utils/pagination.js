/**
 * Return the set of page numbers to show in a pagination bar. For short
 * lists every page is shown; for longer ones the middle is collapsed
 * with ellipses so the footer never grows wider than the container.
 *
 * Shared between CourseStudents.tsx and the DataTable component.
 */
export const getPageNumbers = (current, total) => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('dots');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('dots');
  pages.push(total);
  return pages;
};
