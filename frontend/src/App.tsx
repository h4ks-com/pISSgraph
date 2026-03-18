import TelemetryChart from './components/TelemetryChart'
import './App.css'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚽 pISSgraph
          </h1>
          <p className="text-gray-600">Live ISS Urine Tank Telemetry Data</p>
          <p className="text-sm text-gray-400 mt-2">
            Scroll to zoom • Drag to pan • Double-click to reset view
          </p>
        </header>

        <main>
          <TelemetryChart refreshInterval={30} />
        </main>

        <footer className="text-center mt-8 text-sm text-gray-500">
          <p>
            Data sourced from NASA&apos;s live ISS telemetry stream via{' '}
            <a
              href="https://iss-mimic.github.io/Mimic/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              ISS Mimic
            </a>
          </p>
        </footer>
      </div>
    </div>
  )
}

export default App
