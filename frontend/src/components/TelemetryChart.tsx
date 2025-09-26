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
  timeRange: number | 'all' // hours or 'all' for all time mode
  refreshInterval?: number // seconds
}

const TelemetryChart = ({ timeRange, refreshInterval = 30 }: TelemetryChartProps) => {
  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [timeWindow, setTimeWindow] = useState({ start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end: new Date() }) // Default 30-day window
  const [hasEarlierData, setHasEarlierData] = useState(true) // Track if there's data before current window

  // Navigation functions for All Time mode
  const moveTimeWindow = async (direction: 'left' | 'right') => {
    if (timeRange !== 'all') return

    const windowSize = timeWindow.end.getTime() - timeWindow.start.getTime()
    const moveAmount = windowSize * 0.5 // Move by half window size

    const newWindow = {
      start: new Date(timeWindow.start.getTime() + (direction === 'left' ? -moveAmount : moveAmount)),
      end: new Date(timeWindow.end.getTime() + (direction === 'left' ? -moveAmount : moveAmount))
    }

    // If going left (earlier), check if there's data before the new window
    if (direction === 'left') {
      try {
        const checkResponse = await DefaultService.getTelemetryTelemetryGet(
          newWindow.start.toISOString(),
          newWindow.end.toISOString(),
          undefined,
          1 // Just check if any data exists
        )

        if (checkResponse.data.length === 0) {
          // No data in this window, try to find the earliest available data
          const earliestAttemptStart = new Date('2020-01-01')
          const attemptResponse = await DefaultService.getTelemetryTelemetryGet(
            earliestAttemptStart.toISOString(),
            new Date().toISOString(),
            undefined,
            10
          )

          if (attemptResponse.data.length > 0) {
            const earliestTimestamp = parseISO(attemptResponse.data[0].timestamp.endsWith('Z') ? attemptResponse.data[0].timestamp : attemptResponse.data[0].timestamp + 'Z')
            setTimeWindow({
              start: earliestTimestamp,
              end: new Date(earliestTimestamp.getTime() + windowSize)
            })
            setHasEarlierData(false)
            return
          }
        }
      } catch (err) {
        console.warn('Failed to check for earlier data:', err)
      }
    }

    setTimeWindow(newWindow)
    setHasEarlierData(true) // Reset this when moving normally
  }

  const resetToNow = () => {
    if (timeRange !== 'all') return

    const windowSize = timeWindow.end.getTime() - timeWindow.start.getTime()
    const now = new Date()
    setTimeWindow({
      start: new Date(now.getTime() - windowSize),
      end: now
    })
  }

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      let response
      if (timeRange === 'all') {
        // All Time mode: use time window with start/end dates
        response = await DefaultService.getTelemetryTelemetryGet(
          timeWindow.start.toISOString(),
          timeWindow.end.toISOString(),
          undefined, // hours
          1000       // limit
        )
      } else {
        // Fixed time range mode: use hours parameter
        response = await DefaultService.getTelemetryTelemetryGet(
          undefined, // start_time
          undefined, // end_time
          timeRange, // hours
          1000       // limit
        )
      }

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

      // Handle empty response in All Time mode - try to find earliest data
      if (chartData.length === 0 && timeRange === 'all') {
        // Try to get data from a much later time window to find the earliest available data
        const now = new Date()
        const earliestAttemptStart = new Date('2020-01-01') // Go back to a reasonable earliest date
        const attemptResponse = await DefaultService.getTelemetryTelemetryGet(
          earliestAttemptStart.toISOString(),
          now.toISOString(),
          undefined,
          10 // Just get a few points to find the earliest
        )

        if (attemptResponse.data.length > 0) {
          // Found some data, adjust time window to show the earliest data
          const earliestTimestamp = parseISO(attemptResponse.data[0].timestamp.endsWith('Z') ? attemptResponse.data[0].timestamp : attemptResponse.data[0].timestamp + 'Z')
          const windowSize = timeWindow.end.getTime() - timeWindow.start.getTime()

          setTimeWindow({
            start: earliestTimestamp,
            end: new Date(earliestTimestamp.getTime() + windowSize)
          })

          // Don't set empty data, let the effect re-run with new time window
          return
        }
      }

      setData(chartData)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [timeRange, timeWindow])

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
          ISS Urine Tank Level ({timeRange === 'all' ? 'All Time' : `${timeRange}h`} view)
        </h2>
        <div className="text-sm text-gray-500">
          {lastUpdate && `Last updated: ${format(lastUpdate, 'HH:mm:ss')} ${currentTimezone}`}
        </div>
      </div>

      {timeRange === 'all' && (
        <div className="flex justify-center items-center gap-4 bg-gray-100 p-3 rounded-lg">
          <button
            onClick={() => moveTimeWindow('left')}
            disabled={!hasEarlierData}
            className={`px-3 py-1 rounded text-sm ${
              hasEarlierData
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            ← Earlier
          </button>
          <div className="text-sm text-gray-600">
            {format(timeWindow.start, 'MMM dd, yyyy HH:mm')} - {format(timeWindow.end, 'MMM dd, yyyy HH:mm')}
          </div>
          <button
            onClick={() => moveTimeWindow('right')}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
          >
            Later →
          </button>
          <button
            onClick={resetToNow}
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
          >
            Now
          </button>
        </div>
      )}

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
