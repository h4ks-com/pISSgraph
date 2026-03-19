const { useCallback, useEffect, useRef, useState } from 'react'
const { format, parseISO } from 'date-fns'
const { DefaultService, OpenAPI } from '../api'

// Dynamically determine API base URL based on hostname
const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }
  
  const hostname = window.location.hostname
  
  if (hostname.includes('h4ks.com')) {
    const apiHostname = hostname.replace('piss', 'pissapi')
    return `https://${apiHostname}`
  }
  
  return 'http://localhost:8000'
}

OpenAPI.BASE = getApiBaseUrl()

interface ChartDataPoint {
  time: LightweightCharts.Time
  value: number
}

interface TelemetryChartProps {
  refreshInterval?: number
}

const TelemetryChart = ({ refreshInterval = 30 }: TelemetryChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<LightweightCharts.IChartApi | null>(null)
  const seriesRef = useRef<ReturnType<LightweightCharts.IChartApi['addSeries']> | null>(null)
  const chartInitialized = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [currentLevel, setCurrentLevel] = useState<number>(0)
  const [dataPointCount, setDataPointCount] = useState(0)

  const getLineColor = (level: number): string => {
    if (level >= 80) return '#ef4444'
    if (level >= 60) return '#f59e0b'
    if (level >= 40) return '#3b82f6'
    if (level >= 20) return '#06b6d4'
    return '#10b981'
  }

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const response = await DefaultService.getTelemetryTelemetryGet(undefined, undefined, undefined, 10000)

      const chartData: ChartDataPoint[] = response.data.map((point) => {
        const timestampString = point.timestamp.endsWith('Z') ? point.timestamp : point.timestamp + 'Z'
        const utcTimestamp = parseISO(timestampString)
        return {
          time: (utcTimestamp.getTime() / 1000) as LightweightCharts.Time,
          value: point.urine_tank_level,
        }
      })

      if (seriesRef.current) {
        seriesRef.current.setData(chartData)
      }

      if (chartData.length > 0) {
        setCurrentLevel(chartData[chartData.length - 1].value)
      }

      setDataPointCount(chartData.length)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initialize chart once when component mounts
  useEffect(() => {
    // Prevent double-initialization in React 18 StrictMode
    if (chartInitialized.current) return
    
    const container = chartContainerRef.current
    if (!container) return

    // Create chart with explicit dimensions
    const chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 500,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: 'white' },
        textColor: '#666',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: {
        borderColor: '#ccc',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#ccc',
        timeVisible: true,
        secondsVisible: true,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        borderVisible: true,
        visible: true,
        minBarSpacing: 0.001,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#3b82f6' },
        horzLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#3b82f6' },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    })

    const lineSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceFormat: { type: 'percent', precision: 1 },
      lastValueVisible: true,
      priceLineVisible: true,
    })

    // Add reference price lines
    lineSeries.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Critical' })
    lineSeries.createPriceLine({ price: 60, color: '#f59e0b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Warning' })
    lineSeries.createPriceLine({ price: 20, color: '#10b981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Low' })

    chartRef.current = chart
    seriesRef.current = lineSeries
    chartInitialized.current = true

    chart.timeScale().fitContent()

    return () => {
      // Only cleanup on actual unmount
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        seriesRef.current = null
        chartInitialized.current = false
      }
    }
  }, [])

  // Fetch data on mount
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Refresh interval
  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval * 1000)
      return () => clearInterval(interval)
    }
  }, [fetchData, refreshInterval])

  const currentTimezone = new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
    .formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || 'Local'

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="text-gray-600">Loading telemetry data...</div></div>
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <div className="text-red-600">Error: {error}</div>
        <button onClick={fetchData} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">ISS Urine Tank Level</h2>
        <div className="text-sm text-gray-500">
          {lastUpdate && `Last updated: ${format(lastUpdate, 'HH:mm:ss')} ${currentTimezone}`}
        </div>
      </div>

      <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">
        <strong>Controls:</strong> 🖱️ <strong>Scroll</strong> to zoom · <strong>Drag</strong> to pan · <strong>Double-click</strong> to fit all
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="mb-4 flex justify-between items-center">
          <div>
            <div className="text-3xl font-bold" style={{ color: getLineColor(currentLevel) }}>
              {currentLevel.toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500">Current Level</div>
          </div>
          <div className="text-sm text-gray-500">{dataPointCount.toLocaleString()} data points</div>
        </div>

        <div ref={chartContainerRef} className="w-full" style={{ height: '500px' }} />

        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2"><div className="w-3 h-px bg-red-500"></div><span>Critical (80%+)</span></div>
          <div className="flex items-center gap-2"><div className="w-3 h-px bg-amber-500"></div><span>High (60-80%)</span></div>
          <div className="flex items-center gap-2"><div className="w-3 h-px bg-green-500"></div><span>Low (0-20%)</span></div>
          <div className="ml-auto text-gray-400">Times shown in {currentTimezone}</div>
        </div>
      </div>
    )
  }
}

export default TelemetryChart
