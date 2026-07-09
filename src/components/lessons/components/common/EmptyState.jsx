import { Button } from './Button';

export const EmptyState = ({ icon: Icon, title, description, action }) => {
  return (
    <div className="text-center py-12">
      <div className="mx-auto w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-medium text-slate-900 mb-2">{title}</h3>
      {description && <p className="text-slate-500 mb-4 max-w-sm mx-auto">{description}</p>}
      {action && (
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
};
