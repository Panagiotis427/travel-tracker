import { Component } from 'react';
import type { ReactNode } from 'react';
import { webglAvailable } from '../lib/webgl';

type Props = { children: ReactNode; onUseFlat: () => void };
type State = { failed: boolean; webgl: boolean };

// The 3D globe runs third-party WebGL code (globe.gl on three.js). Without a boundary, an
// error thrown while it loads, renders or updates (or a browser with no WebGL, where three.js
// throws creating its renderer) unmounts the whole app and leaves a blank page. This keeps the
// failure inside the map area: the sidebar and the marks stay, and the 2D map, which needs no
// WebGL, is one tap away.
export default class GlobeBoundary extends Component<Props, State> {
  state: State = { failed: false, webgl: true };

  static getDerivedStateFromError(): State {
    return { failed: true, webgl: webglAvailable() };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="globe-error" role="alert">
        <p>
          {this.state.webgl
            ? 'The 3D globe stopped with an error. Your marks are safe.'
            : "This browser can't show the 3D globe: WebGL is off or not supported. Your marks are safe, and the 2D map works without it."}
        </p>
        <div className="io-row">
          {this.state.webgl && <button className="io" onClick={() => this.setState({ failed: false })}>Try again</button>}
          <button className="io" onClick={this.props.onUseFlat}>Use the 2D map</button>
        </div>
      </div>
    );
  }
}
