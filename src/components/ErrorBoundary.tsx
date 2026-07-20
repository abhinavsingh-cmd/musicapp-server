import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  level?: 'page' | 'section' | 'app';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error.message, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Use React Router navigation instead of full page reload to avoid infinite reload in Capacitor
    try {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { level = 'section' } = this.props;
      const { error } = this.state;

      if (level === 'app') {
        return (
          <div className="h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
                <p className="text-gray-400 text-sm">
                  The app encountered an unexpected error. You can try reloading or go back to the home page.
                </p>
                {error && (
                  <p className="mt-3 text-xs text-red-400/80 font-mono bg-red-500/5 rounded-lg p-3 text-left overflow-auto max-h-24">
                    {error.message}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={this.handleReset}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try again
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--color-accent)] hover:brightness-110 text-white text-sm font-medium transition-all"
                >
                  <Home className="w-4 h-4" />
                  Go home
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center justify-center py-12 px-4">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Failed to load</h3>
              <p className="text-gray-400 text-sm">
                This section couldn't be displayed.
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
