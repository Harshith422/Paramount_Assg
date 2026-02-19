import { useState, useEffect, useRef } from 'react'

function App() {
  const [taskDescription, setTaskDescription] = useState('')
  const [taskId, setTaskId] = useState('')
  const [taskStatus, setTaskStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const wsRef = useRef(null)

  const submitTask = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('http://localhost:8000/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: taskDescription })
      })
      if (response.ok) {
        const data = await response.json()
        setTaskId(data.task_id)
        connectWebSocket(data.task_id)
      } else {
        const errorData = await response.json()
        setError(`Error: ${response.status} - ${errorData.detail || response.statusText}`)
      }
    } catch (err) {
      setError(`Network error: ${err.message}`)
    }
    setLoading(false)
  }

  const connectWebSocket = (id: string) => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    
    const ws = new WebSocket(`ws://localhost:8000/ws/tasks/${id}`)
    
    ws.onopen = () => {
      console.log('WebSocket connected')
    }
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setTaskStatus(data)
        if (data.status === 'completed' || data.status === 'failed') {
          ws.close()
        }
      } catch (err) {
        console.error('WebSocket message error:', err)
      }
    }
    
    ws.onclose = () => {
      console.log('WebSocket disconnected')
    }
    
    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      setError('Real-time connection failed. Using manual refresh.')
    }
    
    wsRef.current = ws
  }

  const processTask = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`http://localhost:8000/tasks/${taskId}/process`, { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json()
        setError(`Error: ${response.status} - ${errorData.detail || errorData.error || response.statusText}`)
      }
    } catch (err) {
      setError(`Network error: ${err.message}`)
    }
    setLoading(false)
  }

  const checkStatus = async () => {
    setError('')
    try {
      const response = await fetch(`http://localhost:8000/tasks/${taskId}`)
      if (response.ok) {
        const data = await response.json()
        setTaskStatus(data)
      } else {
        const errorData = await response.json()
        setError(`Error: ${response.status} - ${errorData.error || response.statusText}`)
      }
    } catch (err) {
      setError(`Network error: ${err.message}`)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-800'
      case 'planning': return 'bg-blue-100 text-blue-800'
      case 'researching': return 'bg-yellow-100 text-yellow-800'
      case 'writing': return 'bg-purple-100 text-purple-800'
      case 'reviewing': return 'bg-orange-100 text-orange-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'failed': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'Planner': return '🗂️'
      case 'Researcher': return '🔍'
      case 'Writer': return '✍️'
      case 'Reviewer': return '✅'
      default: return '🤖'
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">🤖 Multi-Agent Task Orchestration</h1>
          <p className="text-gray-600">Watch AI agents collaborate in real-time</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Task Input Section */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">📝 Submit Task</h2>
            
            {!taskId ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Task Description
                  </label>
                  <textarea
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    rows={4}
                    placeholder="Example: Research the pros and cons of microservices vs. monoliths and produce a summary report"
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                  />
                </div>
                
                <button
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  onClick={submitTask}
                  disabled={loading || !taskDescription.trim()}
                >
                  {loading ? '🚀 Submitting...' : '📤 Submit Task'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Task ID:</p>
                  <p className="font-mono text-lg font-semibold text-gray-800">{taskId}</p>
                </div>
                
                <button
                  className="w-full bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  onClick={processTask}
                  disabled={loading || taskStatus?.status === 'completed'}
                >
                  {loading ? '⚙️ Processing...' : '▶️ Start Processing'}
                </button>
                
                <button
                  className="w-full bg-gray-600 text-white py-3 px-6 rounded-lg hover:bg-gray-700 transition-colors font-medium"
                  onClick={checkStatus}
                >
                  🔄 Refresh Status
                </button>
              </div>
            )}
            
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm">❌ {error}</p>
              </div>
            )}
          </div>

          {/* Status & Results Section */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">📊 Task Status</h2>
            
            {taskStatus ? (
              <div className="space-y-6">
                {/* Status Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">Status:</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(taskStatus.status)}`}>
                    {taskStatus.status.toUpperCase()}
                  </span>
                </div>

                {/* Current Agent */}
                {taskStatus.current_agent && (
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm font-medium text-blue-800 mb-2">Currently Active:</p>
                    <div className="flex items-center space-x-2">
                      <span className="text-2xl">{getAgentIcon(taskStatus.current_agent)}</span>
                      <span className="font-semibold text-blue-900">{taskStatus.current_agent} Agent</span>
                    </div>
                  </div>
                )}

                {/* Progress Visualization */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 text-gray-800">Progress Pipeline</h3>
                  <div className="space-y-2">
                    {['planning', 'researching', 'writing', 'reviewing', 'completed'].map((stage, index) => {
                      const isActive = taskStatus.status === stage
                      const isCompleted = ['planning', 'researching', 'writing', 'reviewing', 'completed'].indexOf(taskStatus.status) > index
                      
                      return (
                        <div key={stage} className="flex items-center space-x-3">
                          <div className={`w-4 h-4 rounded-full ${isCompleted ? 'bg-green-500' : isActive ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}></div>
                          <span className={`capitalize ${isActive ? 'font-semibold text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'}`}>
                            {stage}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Results */}
                {taskStatus.report && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 text-gray-800">📄 Final Report</h3>
                    <div className="bg-gray-50 p-4 rounded-lg max-h-64 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">{taskStatus.report}</pre>
                    </div>
                  </div>
                )}

                {/* Feedback */}
                {taskStatus.feedback && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 text-gray-800">💬 Reviewer Feedback</h3>
                    <div className="bg-yellow-50 p-4 rounded-lg">
                      <p className="text-yellow-800">{taskStatus.feedback}</p>
                    </div>
                  </div>
                )}

                {/* Agent History */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 text-gray-800">📚 Agent Activity</h3>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {taskStatus.history.map((item, index) => (
                      <div key={index} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-lg">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-lg">{getAgentIcon(item.agent)}</span>
                          <span className="font-semibold text-gray-800">{item.agent} Agent</span>
                          <span className={`px-2 py-1 rounded text-xs ${item.output.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.output.status}
                          </span>
                        </div>
                        {item.output.subtasks && (
                          <ul className="text-sm text-gray-600 ml-6">
                            {item.output.subtasks.map((st, i) => (
                              <li key={i}>• {st.description}</li>
                            ))}
                          </ul>
                        )}
                        {item.output.research && (
                          <p className="text-sm text-gray-600 ml-6 italic">"{item.output.research}"</p>
                        )}
                        {item.output.report && (
                          <p className="text-sm text-gray-600 ml-6">Report generated ({item.output.report.length} chars)</p>
                        )}
                        {item.output.feedback && (
                          <p className="text-sm text-gray-600 ml-6">Feedback: {item.output.feedback}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <div className="text-6xl mb-4">⏳</div>
                <p>Submit and process a task to see real-time updates</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App