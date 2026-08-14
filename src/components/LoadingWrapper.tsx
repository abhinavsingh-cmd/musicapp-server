import React, { useState, useEffect, useCallback, useRef } from 'react';

interface LoadingState {
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isTimeout: boolean;
  errorMessage?: string;
  retryCount: number;
}

interface LoadingWrapperProps {
  children: React.ReactNode;
  onLoad: () => Promise<any>;
  timeout?: number;
  maxRetries?: number;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onTimeout?: () => void;
  className?: string;
  loader?: React.ReactNode;
  errorComponent?: React.ReactNode;
  timeoutComponent?: React.ReactNode;
}

export function LoadingWrapper({
  children,
  onLoad,
  timeout = 10000,
  maxRetries = 3,
  onSuccess,
  onError,
  onTimeout,
  className = '',
  loader,
  errorComponent,
  timeoutComponent,
}: LoadingWrapperProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: true,
    isSuccess: false,
    isError: false,
    isTimeout: false,
    retryCount: 0,
  });

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const handleSuccess = useCallback(() => {
    if (!mountedRef.current) return;
    setLoadingState(prev => ({ ...prev, isLoading: false, isSuccess: true }));
    onSuccess?.();
  }, [onSuccess]);

  const handleError = useCallback((error: string) => {
    if (!mountedRef.current) return;
    setLoadingState(prev => ({
      ...prev,
      isLoading: false,
      isError: true,
      errorMessage: error,
    }));
    onError?.(error);
  }, [onError]);

  const handleTimeout = useCallback(() => {
    if (!mountedRef.current) return;
    setLoadingState(prev => ({ ...prev, isLoading: false, isTimeout: true }));
    onTimeout?.();
  }, [onTimeout]);

  const onLoadRef = useRef(onLoad);
  const maxRetriesRef = useRef(maxRetries);
  const timeoutRef = useRef(timeout);
  const handleSuccessRef = useRef(handleSuccess);
  const handleErrorRef = useRef(handleError);
  const handleTimeoutRef = useRef(handleTimeout);

  useEffect(() => {
    onLoadRef.current = onLoad;
    maxRetriesRef.current = maxRetries;
    timeoutRef.current = timeout;
    handleSuccessRef.current = handleSuccess;
    handleErrorRef.current = handleError;
    handleTimeoutRef.current = handleTimeout;
  });

  useEffect(() => {
    mountedRef.current = true;

    const runLoad = async (attempt: number) => {
      if (!mountedRef.current) return;
      setLoadingState(prev => ({
        ...prev,
        isLoading: true,
        isError: false,
        isTimeout: false,
        errorMessage: undefined,
        retryCount: attempt,
      }));

      try {
        await onLoadRef.current();
        if (mountedRef.current) handleSuccessRef.current();
      } catch (err) {
        if (!mountedRef.current) return;
        if (attempt < maxRetriesRef.current) {
          retryTimerRef.current = setTimeout(() => runLoad(attempt + 1), 1000);
        } else {
          handleErrorRef.current(String(err) || 'Failed to load');
        }
      }
    };

    runLoad(0);

    if (timeoutRef.current > 0) {
      timeoutTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setLoadingState(prev => {
            if (prev.isLoading) {
              handleTimeoutRef.current();
              return { ...prev, isLoading: false, isTimeout: true };
            }
            return prev;
          });
        }
      }, timeoutRef.current);
    }

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    };
  }, []);

  if (loadingState.isLoading) {
    return loader ? (
      <div className={className}>{loader}</div>
    ) : (
      <div className={`w-full flex items-center justify-center py-16 ${className}`}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-violet-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-gray-400">Loading... (Attempt {loadingState.retryCount + 1})</p>
        </div>
      </div>
    );
  }

  if (loadingState.isError && errorComponent) {
    return <>{errorComponent}</>;
  }

  if (loadingState.isTimeout && timeoutComponent) {
    return <>{timeoutComponent}</>;
  }

  if (loadingState.isSuccess) {
    return <div className={className}>{children}</div>;
  }

  return null;
}
