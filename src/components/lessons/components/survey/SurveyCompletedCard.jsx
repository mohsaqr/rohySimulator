import { CheckCircle } from 'lucide-react';
import { Card, CardBody } from '../common/Card';

export const SurveyCompletedCard = ({
  title = 'Survey Completed',
  message = 'Thank you for your feedback!',
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
        <CheckCircle className="w-5 h-5" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    );
  }

  return (
    <Card>
      <CardBody className="text-center py-8">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {title}
        </h3>
        <p className="text-slate-600 dark:text-slate-400">{message}</p>
      </CardBody>
    </Card>
  );
};
