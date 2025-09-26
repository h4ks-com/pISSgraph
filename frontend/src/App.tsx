import { useState } from 'react'
import TelemetryChart from './components/TelemetryChart'
import './App.css'

const TIME_RANGES = [
  { label: '1 Hour', value: 1 },
  { label: '6 Hours', value: 6 },
  { label: '24 Hours', value: 24 },
  { label: '3 Days', value: 72 },
  { label: '1 Week', value: 168 },
  { label: '1 Month', value: 720 },
  { label: '1 Year', value: 8760 },
]

function App() {
  const [selectedTimeRange, setSelectedTimeRange] = useState(24)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚽 pISSgraph
          </h1>
          <p className="text-gray-600">Live ISS Urine Tank Telemetry Data</p>
        </header>

        <div className="mb-6">
          <div className="flex flex-wrap justify-center gap-2">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setSelectedTimeRange(range.value)}
                className={`px-4 py-2 rounded-md transition-colors ${
                  selectedTimeRange === range.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <main>
          <TelemetryChart timeRange={selectedTimeRange} refreshInterval={30} />
        </main>

        <footer className="text-center mt-8 text-sm text-gray-500">
          <p>
            Data sourced from NASA's live ISS telemetry stream via{' '}
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
