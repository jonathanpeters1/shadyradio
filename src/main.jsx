import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class Catch extends React.Component {
  state = { err: null }
  static getDerivedStateFromError(e) { return { err: e } }
  render() {
    if (this.state.err) return (
      <pre style={{color:'red',padding:20,whiteSpace:'pre-wrap'}}>
        {this.state.err?.message}{'\n\n'}{this.state.err?.stack}
      </pre>
    )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Catch><App /></Catch>
  </React.StrictMode>,
)