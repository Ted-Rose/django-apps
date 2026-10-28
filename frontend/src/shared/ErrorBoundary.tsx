/* eslint-disable i18next/no-literal-string -- last-resort
   fallback UI: it must render even when the crash being shown
   is i18n itself failing to initialize. */
import { Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { reportError } from './errorReporter';

interface Props {
  children: ReactNode;
  /** When this value changes while the boundary is in the error
   *  state, the boundary recovers. Healthy children are never
   *  remounted — the check only fires post-error. Pass the
   *  current pathname so intra-app navigation clears a stuck
   *  fallback. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

/** Builds a markdown error report for pasting into an issue. */
function buildErrorDetails(error: Error, context: string): string {
  return [
    `**Error (${context}):** ${error.name}: ${error.message}`,
    `**URL:** ${window.location.href}`,
    `**Time:** ${new Date().toISOString()}`,
    `**User agent:** ${navigator.userAgent}`,
    '',
    '```',
    error.stack || 'No stack trace available',
    '```',
  ].join('\n');
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copied: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Sent before reportError's own captureException so the
    // event that survives Sentry's dedupe carries the React
    // component stack — and the `context` tag, which the deduped
    // second capture would otherwise lose. No-op when Sentry is
    // not initialized.
    Sentry.captureException(error, {
      tags: { context: 'React render error' },
      extra: { componentStack: errorInfo.componentStack },
    });
    reportError(error, 'React render error');
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, copied: false });
    }
  }

  private copyDetails = () => {
    const { error } = this.state;
    if (!error) return;
    void navigator.clipboard
      .writeText(buildErrorDetails(error, 'React render error'))
      .then(() => this.setState({ copied: true }))
      .catch(() => this.setState({ copied: false }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mt-5" style={{ maxWidth: '32rem' }}>
          <div className="alert alert-danger" role="alert">
            <h4 className="alert-heading">Something went wrong</h4>
            <p>
              {this.state.error?.message ||
                'An unexpected error occurred. Please try again.'}
            </p>
            <hr />
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={this.copyDetails}
              >
                {this.state.copied ? 'Copied!' : 'Copy error details'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
