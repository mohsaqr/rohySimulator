import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingTour from './OnboardingTour.jsx';
import { isTourDone } from './useOnboarding.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

describe('OnboardingTour', () => {
  it('does not show once the tour is already done', () => {
    const s = fakeStorage();
    s.setItem('rohy.onboarding.student.v1', 'done');
    const { container } = render(<OnboardingTour role="student" storage={s} />);
    expect(container.textContent).toBe('');
  });

  it('shows first-run, advances with Next, and persists on completion', () => {
    const s = fakeStorage();
    render(<OnboardingTour role="student" storage={s} />);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Done')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(isTourDone(s, 'student')).toBe(true);
  });

  it('Skip persists completion and hides', () => {
    const s = fakeStorage();
    const { container } = render(<OnboardingTour role="educator" storage={s} />);
    expect(screen.getByText(/Welcome, Teacher/)).toBeTruthy();
    fireEvent.click(screen.getByText('Skip'));
    expect(container.textContent).toBe('');
    expect(isTourDone(s, 'educator')).toBe(true);
  });

  it('respects enabled=false', () => {
    const { container } = render(
      <OnboardingTour role="student" enabled={false} storage={fakeStorage()} />,
    );
    expect(container.textContent).toBe('');
  });
});
