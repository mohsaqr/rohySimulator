import { useTheme } from '../../hooks/useTheme';

export const SurveyQuestion = ({
  question,
  value,
  onChange,
  error,
  questionNumber,
}) => {
  const { isDark } = useTheme();

  const handleSingleChoiceChange = (option) => {
    onChange(option);
  };

  const handleMultipleChoiceChange = (option, checked) => {
    const currentValue = Array.isArray(value) ? value : [];
    if (checked) {
      onChange([...currentValue, option]);
    } else {
      onChange(currentValue.filter(v => v !== option));
    }
  };

  const handleFreeTextChange = (text) => {
    onChange(text);
  };

  return (
    <div className="mb-5">
      <div className="mb-2">
        <p
          className="font-medium"
          style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
        >
          {questionNumber}. {question.questionText}
          {question.isRequired && (
            <span className="text-red-500 ml-1">*</span>
          )}
        </p>
      </div>

      {question.questionType === 'single_choice' && question.options && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {question.options.map((option, index) => (
            <label
              key={index}
              className="flex items-center gap-2 py-1 cursor-pointer"
            >
              <input
                type="radio"
                name={`question-${question.id}`}
                value={option}
                checked={value === option}
                onChange={() => handleSingleChoiceChange(option)}
                className="w-4 h-4 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm" style={{ color: isDark ? '#e2e8f0' : '#334155' }}>
                {option}
              </span>
            </label>
          ))}
        </div>
      )}

      {question.questionType === 'multiple_choice' && question.options && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {question.options.map((option, index) => {
            const currentValues = Array.isArray(value) ? value : [];
            const isChecked = currentValues.includes(option);
            return (
              <label
                key={index}
                className="flex items-center gap-2 py-1 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={e =>
                    handleMultipleChoiceChange(option, e.target.checked)
                  }
                  className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                />
                <span className="text-sm" style={{ color: isDark ? '#e2e8f0' : '#334155' }}>
                  {option}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {question.questionType === 'free_text' && (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={e => handleFreeTextChange(e.target.value)}
          placeholder="Enter your response..."
          rows={4}
          className="w-full px-4 py-3 rounded-lg border focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors resize-none"
          style={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            borderColor: isDark ? '#334155' : '#cbd5e1',
            color: isDark ? '#f1f5f9' : '#0f172a',
          }}
        />
      )}

      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
};
