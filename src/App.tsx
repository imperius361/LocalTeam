import { useEffect, useState } from 'react';
import { initIpc, callSidecar } from './lib/ipc';
import { StatusIndicator } from './components/StatusIndicator';
import './App.css';

function App() {
  const [ready, setReady] = useState(false);
  const [pingResult, setPingResult] = useState<string>('');

  useEffect(() => {
    initIpc().then(() => setReady(true));
  }, []);

  const handlePing = async () => {
    try {
      const result = await callSidecar<{ status: string }>('ping');
      setPingResult(result.status);
    } catch (err) {
      setPingResult(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>LocalTeam</h1>
        <p className="app-subtitle">AI Agent Team Orchestrator</p>
      </header>

      <main className="app-main">
        <StatusIndicator />

        {ready && (
          <div className="ping-section">
            <button onClick={handlePing} className="ping-button">
              Ping Sidecar
            </button>
            {pingResult && (
              <span className="ping-result">Response: {pingResult}</span>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
