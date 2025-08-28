import { useCallback, useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { DefaultService, OpenAPI, TelemetryDataPoint } from '../api'

// Configure API base URL
OpenAPI.BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

interface ChartDataPoint {
  timestamp: number
  urine_tank_level: number
  formattedTime: string
}

interface TelemetryChartProps {
  timeRange: number // hours
  refreshInterval?: number // seconds
}

const TelemetryChart = ({ timeRange, refreshInterval = 30 }: TelemetryChartProps) => {
  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const response = await DefaultService.getTelemetryTelemetryGet(
        undefined, // start_time
        undefined, // end_time
        timeRange, // hours
        1000       // limit
      )

      const chartData: ChartDataPoint[] = response.data.map((point: TelemetryDataPoint) => {
        // Backend sends UTC timestamps, parse and treat as UTC
        // If timestamp doesn't end with Z, treat it as UTC
        const timestampString = point.timestamp.endsWith('Z') ? point.timestamp : point.timestamp + 'Z'
        const utcTimestamp = parseISO(timestampString)

        return {
          timestamp: utcTimestamp.getTime(), // milliseconds since epoch (browser displays in local time)
          urine_tank_level: point.urine_tank_level,
          formattedTime: format(utcTimestamp, 'HH:mm:ss'), // formats in local browser time
        }
      })

      setData(chartData)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval * 1000)
      return () => clearInterval(interval)
    }
  }, [fetchData, refreshInterval])

  const formatTooltipLabel = (timestamp: number) => {
    // Format timestamp in user's local timezone with timezone indicator
    const date = new Date(timestamp)
    const timezoneShort = new Intl.DateTimeFormat('en', {
      timeZoneName: 'short'
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'Local'

    return `${format(date, 'MMM dd, HH:mm:ss')} ${timezoneShort}`
  }

  const getLineColor = (level: number) => {
    if (level >= 80) return '#ef4444' // red - very full
    if (level >= 60) return '#f59e0b' // amber - getting full
    if (level >= 40) return '#3b82f6' // blue - moderate
    if (level >= 20) return '#06b6d4' // cyan - low
    return '#10b981' // green - very low
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-600">Loading telemetry data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <div className="text-red-600">Error: {error}</div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-600">No telemetry data available</div>
      </div>
    )
  }

  const currentLevel = data[data.length - 1]?.urine_tank_level || 0

  const currentTimezone = new Intl.DateTimeFormat('en', {
    timeZoneName: 'short'
  }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || 'Local'

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">
          ISS Urine Tank Level ({timeRange}h view)
        </h2>
        <div className="text-sm text-gray-500">
          {lastUpdate && `Last updated: ${format(lastUpdate, 'HH:mm:ss')} ${currentTimezone}`}
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="mb-4">
          <div className="text-3xl font-bold" style={{ color: getLineColor(currentLevel) }}>
            {currentLevel.toFixed(1)}%
          </div>
          <div className="text-sm text-gray-500">Current Level</div>
        </div>

        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(timestamp) => format(new Date(timestamp), 'HH:mm')}
                stroke="#666"
              />
              <YAxis
                domain={[0, 100]}
                label={{ value: 'Level (%)', angle: -90, position: 'insideLeft' }}
                stroke="#666"
              />
              <Tooltip
                labelFormatter={formatTooltipLabel}
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Urine Tank Level']}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                }}
              />

              {/* Warning lines */}
              <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="5 5" />
              <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="5 5" />
              <ReferenceLine y={20} stroke="#10b981" strokeDasharray="5 5" />

              <Line
                type="stepAfter"
                dataKey="urine_tank_level"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-px bg-red-500"></div>
            <span>Critical (80%+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-px bg-amber-500"></div>
            <span>High (60-80%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-px bg-green-500"></div>
            <span>Low (0-20%)</span>
          </div>
          <div className="ml-auto text-gray-400">
            Times shown in {currentTimezone}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TelemetryChart
