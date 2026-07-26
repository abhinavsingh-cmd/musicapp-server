type ToastType = 'success' | 'error' | 'info' | 'warning';
type ToastFn = (message: string, type?: ToastType) => void;

let _toastFn: ToastFn | null = null;

export function registerToast(fn: ToastFn): void {
  _toastFn = fn;
}

export function showToast(message: string, type: ToastType = 'info'): void {
  if (_toastFn) {
    try { _toastFn(message, type); } catch {}
  }
}
