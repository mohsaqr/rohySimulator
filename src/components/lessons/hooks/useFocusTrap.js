import { useEffect, useRef, useCallback } from 'react';

export const useFocusTrap = (isActive) => {
  const containerRef = useRef(null);
  const previousFocusRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab' || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (!firstElement) return;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      // Store the currently focused element
      previousFocusRef.current = document.activeElement;

      // Add keydown listener for Tab trapping
      document.addEventListener('keydown', handleKeyDown);

      // Focus the first focusable element in the container
      const focusableElements = containerRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements && focusableElements.length > 0) {
        // Try to focus the close button or first focusable element
        const closeButton = containerRef.current?.querySelector('[aria-label="Close"]');
        (closeButton || focusableElements[0])?.focus();
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        // Restore focus to the previously focused element
        previousFocusRef.current?.focus();
      };
    }
  }, [isActive, handleKeyDown]);

  return containerRef;
};
