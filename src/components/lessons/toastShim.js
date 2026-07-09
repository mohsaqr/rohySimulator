// toastShim — dependency-free stand-in for react-hot-toast. A later step wires
// rohy's ToastContext; for now these are thin, non-throwing console wrappers.
function base(msg) {
  // eslint-disable-next-line no-console
  console.log('[toast]', msg);
}

base.success = (msg) => {
  // eslint-disable-next-line no-console
  console.log('[toast:success]', msg);
};
base.error = (msg) => {
  // eslint-disable-next-line no-console
  console.error('[toast:error]', msg);
};
base.loading = (msg) => {
  // eslint-disable-next-line no-console
  console.log('[toast:loading]', msg);
};
base.dismiss = () => {};

export const toast = base;

// No-op Toaster so any <Toaster/> usage keeps rendering nothing.
export function Toaster() {
  return null;
}

export default toast;
