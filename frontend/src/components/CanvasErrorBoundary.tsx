import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Unable to initialize 3D WebGL scene.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D Scene ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="canvas-fallback" role="alert">
          <h3>3D Viewport Unavailable</h3>
          <p>{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
