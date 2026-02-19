import { useState, useEffect } from 'react'

function App() {
  const [taskDescription, setTaskDescription] = useState('')
  const [taskId, setTaskId] = useState('')
  const [taskStatus, setTaskStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)

  const submitTask = async () => {
    setLoading(true)
    try {
      const response = await fetch('http://localhost:8000/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: taskDescription })
      })
      const data = await response.json()
      setTaskId(data.task_id)
    } catch (error) {
      alert('Error submitting task')
    }
    setLoading(false)
  }

  const processTask = async () => {
    setLoading(true)
    try {
      await fetch(`http://localhost:8000/tasks/${taskId}/process`, { method: 'POST' })
      setPolling(true)
    } catch (error) {
      alert('Error processing task')
    }
    setLoading(false)
  }

  const checkStatus = async () => {
    try {
      const response = await fetch(`http://localhost:8000/tasks/${taskId}`)
      const data = await response.json()
      setTaskStatus(data)
      if (data.status === 'completed') {
        setPolling(false)
      }
    } catch (error) {
      console.error('Error checking status')
    }
  }

  useEffect(() => {
    let interval
    if (polling) {
      interval = setInterval(checkStatus, 2000)
    }
    return () => clearInterval(interval)
  }, [polling, taskId])

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded shadow">
        <h1 className="text-3xl font-bold mb-6 text-center">Multi-Agent Task Orchestration</h1>
        {!taskId ? (
          <div>
            <label className="block text-sm font-medium mb-2">Task Description</label>
            <textarea
              className="w-full p-3 border rounded mb-4 h-24"
              placeholder="Enter your task, e.g., Research the pros and cons of microservices vs. monoliths and produce a summary report."
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
            />
            <button
              className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
              onClick={submitTask}
              disabled={loading || !taskDescription.trim()}
            >
              {loading ? 'Submitting...' : 'Submit Task'}
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <p className="text-sm text-gray-600">Task ID: <span className="font-mono">{taskId}</span></p>
            </div>
            <div className="mb-4">
              <button
                className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600 mr-2"
                onClick={processTask}
                disabled={loading || polling}
              >
                {loading ? 'Processing...' : polling ? 'Processing...' : 'Start Processing'}
              </button>
              <button
                className="bg-gray-500 text-white px-6 py-2 rounded hover:bg-gray-600"
                onClick={checkStatus}
                disabled={polling}
              >
                Refresh Status
              </button>
            </div>
            {taskStatus && (
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded">
                  <h2 className="text-xl font-semibold mb-2">Current Status: <span className="capitalize">{taskStatus.status}</span></h2>
                  {taskStatus.status === 'completed' && <p className="text-green-600">Task completed successfully!</p>}
                </div>
                {taskStatus.report && (
                  <div className="bg-blue-50 p-4 rounded">
                    <h3 className="text-lg font-semibold mb-2">Final Report</h3>
                    <pre className="whitespace-pre-wrap text-sm bg-white p-2 rounded border">{taskStatus.report}</pre>
                  </div>
                )}
                {taskStatus.feedback && (
                  <div className="bg-yellow-50 p-4 rounded">
                    <h3 className="text-lg font-semibold mb-2">Reviewer Feedback</h3>
                    <p className="text-sm">{taskStatus.feedback}</p>
                  </div>
                )}
                <div className="bg-gray-50 p-4 rounded">
                  <h3 className="text-lg font-semibold mb-2">Agent Execution History</h3>
                  <div className="space-y-2">
                    {taskStatus.history.map((item, index) => (
                      <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                        <p className="font-medium">{item.agent} Agent</p>
                        <p className="text-sm text-gray-600">Status: {item.output.status}</p>
                        {item.output.subtasks && (
                          <ul className="text-sm mt-1">
                            {item.output.subtasks.map((st, i) => (
                              <li key={i}>- {st.description}</li>
                            ))}
                          </ul>
                        )}
                        {item.output.research && <p className="text-sm mt-1">{item.output.research}</p>}
                        {item.output.report && <p className="text-sm mt-1">Report generated</p>}
                        {item.output.feedback && <p className="text-sm mt-1">Feedback: {item.output.feedback}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App