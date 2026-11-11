import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../i18n';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="empty">
          <h3>{t('app.error')}</h3>
          <p className="muted">{this.state.error.message}</p>
          <button className="btn btn--soft" onClick={() => this.setState({ error: null })}>{t('app.retry')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
